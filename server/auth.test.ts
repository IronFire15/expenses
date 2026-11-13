import { describe, expect, it, vi } from 'vitest'
import { b64url, DRIVE_SCOPE, handleAuth, openSession, parseCookies, safeReturn, sealSession, type Env } from './auth'

const env: Env = {
  GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'shh',
  SESSION_SECRET: 'x'.repeat(40),
  ALLOWED_EMAILS: 'me@gmail.com, Other@Example.com',
}
const ORIGIN = 'https://expenses-io.pages.dev'
const SESSION = '__Host-expenses_session'

const idToken = (claims: object) => `h.${b64url(new TextEncoder().encode(JSON.stringify(claims)))}.s`
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';')
    const i = pair.indexOf('=')
    out[pair.slice(0, i)] = pair.slice(i + 1)
  }
  return out
}

async function start(returnTo = '/budgets') {
  const res = await handleAuth(new Request(`${ORIGIN}/api/auth/start?return=${encodeURIComponent(returnTo)}`), env)
  const google = new URL(res.headers.get('Location')!)
  return { res, google, stateCookie: setCookies(res).expenses_oauth }
}

async function callback(stateCookie: string, state: string, tokens: object, status = 200) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => (String(url).includes('revoke') ? new Response('') : jsonResponse(tokens, status)))
  const res = await handleAuth(
    new Request(`${ORIGIN}/api/auth/callback?code=abc&state=${state}`, { headers: { Cookie: `expenses_oauth=${stateCookie}` } }),
    env,
    fetchImpl as unknown as typeof fetch,
  )
  return { res, fetchImpl }
}

const goodTokens = {
  access_token: 'at1',
  expires_in: 3599,
  refresh_token: 'rt1',
  id_token: idToken({ email: 'Me@Gmail.com', email_verified: true }),
  scope: `openid ${DRIVE_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
}

describe('auth helpers', () => {
  it('only returns to same-site app paths', () => {
    expect(['/budgets?month=2026-10', '//evil.com', '/\\evil.com', 'https://evil.com', '/api/auth/logout', null].map(safeReturn)).toEqual([
      '/budgets?month=2026-10',
      '/',
      '/',
      '/',
      '/',
      '/',
    ])
  })

  it('seals sessions so they cannot be read or forged without the secret', async () => {
    const sealed = await sealSession({ v: 1, rt: 'refresh', email: 'me@gmail.com' }, 'secret-1')
    expect(sealed).not.toContain('refresh')
    expect(await openSession(sealed, 'secret-1')).toEqual({ v: 1, rt: 'refresh', email: 'me@gmail.com' })
    expect(await openSession(sealed, 'secret-2')).toBeNull()
    expect(await openSession(`${sealed.slice(0, -2)}AA`, 'secret-1')).toBeNull()
    expect(await openSession('garbage', 'secret-1')).toBeNull()
  })

  it('parses cookies', () => {
    expect(parseCookies('a=1; b=x=y ;c=')).toEqual({ a: '1', b: 'x=y', c: '' })
  })
})

describe('sign-in flow', () => {
  it('refuses to run without configuration', async () => {
    const res = await handleAuth(new Request(`${ORIGIN}/api/auth/token`), { ALLOWED_EMAILS: 'a@b.c' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'not_configured', missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET'] })
  })

  it('start sends you to Google with offline access, consent and a state cookie', async () => {
    const { res, google, stateCookie } = await start()
    expect(res.status).toBe(302)
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(google.searchParams)).toMatchObject({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${ORIGIN}/api/auth/callback`,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
    })
    expect(google.searchParams.get('scope')).toContain(DRIVE_SCOPE)
    expect(stateCookie.startsWith(`${google.searchParams.get('state')}.`)).toBe(true)
    const raw = res.headers.getSetCookie()[0]
    expect(raw).toMatch(/HttpOnly/)
    expect(raw).toMatch(/Secure/)
    expect(raw).toMatch(/Path=\/api\/auth/)
  })

  it('callback signs in an allowed account and returns to the page you were on', async () => {
    const { google, stateCookie } = await start('/budgets')
    const { res, fetchImpl } = await callback(stateCookie, google.searchParams.get('state')!, goodTokens)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe(`${ORIGIN}/budgets`)
    const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith(SESSION))!
    expect(sessionCookie).toMatch(/HttpOnly/)
    expect(sessionCookie).toMatch(/Secure/)
    expect(sessionCookie).not.toContain('rt1') // refresh token is encrypted
    const body = new URLSearchParams(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.get('client_secret')).toBe('shh')
    expect(body.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`)
  })

  it('callback rejects a wrong state, an account not on the list, and a missing Drive permission', async () => {
    const { google, stateCookie } = await start()
    const state = google.searchParams.get('state')!

    expect((await callback(stateCookie, 'forged', goodTokens)).res.headers.get('Location')).toBe(`${ORIGIN}/?auth_error=expired`)

    const stranger = await callback(stateCookie, state, { ...goodTokens, id_token: idToken({ email: 'x@gmail.com', email_verified: true }) })
    expect(stranger.res.headers.get('Location')).toBe(`${ORIGIN}/?auth_error=not_allowed`)
    expect(String(stranger.fetchImpl.mock.calls[1][0])).toContain('revoke')
    expect(stranger.res.headers.getSetCookie().some((c) => c.startsWith(SESSION))).toBe(false)

    const unverified = await callback(stateCookie, state, { ...goodTokens, id_token: idToken({ email: 'me@gmail.com', email_verified: false }) })
    expect(unverified.res.headers.get('Location')).toBe(`${ORIGIN}/?auth_error=not_allowed`)

    const noDrive = await callback(stateCookie, state, { ...goodTokens, scope: 'openid email' })
    expect(noDrive.res.headers.get('Location')).toBe(`${ORIGIN}/?auth_error=drive_permission`)
  })

  it('token gives a fresh access token from the cookie, and signs out when Google revoked it', async () => {
    const cookieValue = await sealSession({ v: 1, rt: 'rt1', email: 'me@gmail.com' }, env.SESSION_SECRET!)
    const req = () => new Request(`${ORIGIN}/api/auth/token`, { headers: { Cookie: `${SESSION}=${cookieValue}` } })

    const ok = await handleAuth(req(), env, (async () => jsonResponse({ access_token: 'at2', expires_in: 3600 })) as unknown as typeof fetch, () => 1000)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ email: 'me@gmail.com', accessToken: 'at2', expiresAt: 1000 + 3600_000 })
    expect(ok.headers.get('Cache-Control')).toBe('no-store')
    expect(setCookies(ok)[SESSION]).toBeTruthy() // renewed

    const revoked = await handleAuth(req(), env, (async () => jsonResponse({ error: 'invalid_grant' }, 400)) as unknown as typeof fetch)
    expect(revoked.status).toBe(401)
    expect(revoked.headers.getSetCookie()[0]).toMatch(/Max-Age=0/)

    const badSecret = await handleAuth(req(), env, (async () => jsonResponse({ error: 'invalid_client' }, 401)) as unknown as typeof fetch)
    expect(badSecret.status).toBe(502)
    expect(badSecret.headers.getSetCookie()).toEqual([]) // keeps the session

    const removed = await handleAuth(req(), { ...env, ALLOWED_EMAILS: 'someone@else.com' }, (async () => new Response('')) as unknown as typeof fetch)
    expect(removed.status).toBe(401)

    const none = await handleAuth(new Request(`${ORIGIN}/api/auth/token`), env)
    expect(none.status).toBe(401)
  })

  it('logout revokes and clears, but only when asked by the app itself', async () => {
    const cookieValue = await sealSession({ v: 1, rt: 'rt1', email: 'me@gmail.com' }, env.SESSION_SECRET!)
    const fetchImpl = vi.fn(async () => new Response(''))
    const cross = await handleAuth(
      new Request(`${ORIGIN}/api/auth/logout`, { method: 'POST', headers: { Origin: 'https://evil.com', Cookie: `${SESSION}=${cookieValue}` } }),
      env,
      fetchImpl as unknown as typeof fetch,
    )
    expect(cross.status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()

    const res = await handleAuth(
      new Request(`${ORIGIN}/api/auth/logout`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: `${SESSION}=${cookieValue}` } }),
      env,
      fetchImpl as unknown as typeof fetch,
    )
    expect(res.status).toBe(204)
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain('revoke')
    expect(res.headers.get('Set-Cookie')).toMatch(/Max-Age=0/)
  })

  it('uses plain cookies on http://localhost (development)', async () => {
    const res = await handleAuth(new Request('http://localhost:8788/api/auth/start'), { ...env, PUBLIC_ORIGIN: 'http://localhost:5173' })
    expect(new URL(res.headers.get('Location')!).searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/callback')
    expect(res.headers.getSetCookie()[0]).not.toMatch(/Secure/)
  })
})
