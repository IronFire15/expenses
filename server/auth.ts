/**
 * Google sign-in for the app, run as Cloudflare Pages Functions under /api/auth/*.
 *
 * Why a server part: a browser-only Google sign-in gets a token that lasts 1 hour, so sync stopped
 * every hour. Here Google's "authorization code" flow gives a long-lived refresh token. It is kept
 * encrypted in an http-only cookie (page scripts can't read it) and only this server can use it,
 * because renewing needs the client secret. The app asks /api/auth/token for a fresh 1-hour token
 * whenever it needs one: no popups, sign in once per device.
 *
 *   GET  /api/auth/start?return=/path   → Google's sign-in page
 *   GET  /api/auth/callback             ← Google sends you back here; checks the allow-list, sets the cookie
 *   GET  /api/auth/token                → { email, accessToken, expiresAt } or 401
 *   POST /api/auth/logout               → revokes the sign-in and clears the cookie
 *
 * Only Google accounts listed in ALLOWED_EMAILS can sign in (fails closed when it's empty).
 */

export interface Env {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** Random string (32+ bytes) that encrypts the session cookie. */
  SESSION_SECRET?: string
  /** Comma-separated Google addresses allowed to sign in. */
  ALLOWED_EMAILS?: string
  /** Public address of the app when it differs from the request (local development behind Vite's proxy). */
  PUBLIC_ORIGIN?: string
}

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const SCOPES = `openid email ${DRIVE_SCOPE}`
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
/** Browsers cap cookie lifetime at 400 days; renewed on every use. */
const SESSION_SECONDS = 400 * 86_400
const STATE_SECONDS = 10 * 60

type Fetch = typeof fetch

// ---------- small helpers ----------

const enc = new TextEncoder()
const dec = new TextDecoder()

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const randomToken = (n = 24) => b64url(crypto.getRandomValues(new Uint8Array(n)))

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

export function allowedEmails(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_EMAILS ?? '')
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isAllowed(email: string | undefined, env: Env): boolean {
  return !!email && allowedEmails(env).has(email.toLowerCase())
}

/** Only same-site paths, never back into the API (prevents open redirects). */
export function safeReturn(path: string | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\') || path.startsWith('/api/')) return '/'
  return path
}

// ---------- session cookie (AES-GCM) ----------

interface Session {
  v: 1
  /** Google refresh token. */
  rt: string
  email: string
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`expenses-session|${secret}`))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function sealSession(session: Session, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sessionKey(secret), enc.encode(JSON.stringify(session))))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return b64url(out)
}

export async function openSession(value: string | undefined, secret: string): Promise<Session | null> {
  if (!value) return null
  try {
    const bytes = fromB64url(value)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await sessionKey(secret), bytes.slice(12))
    const s = JSON.parse(dec.decode(pt)) as Session
    return s.v === 1 && s.rt && s.email ? s : null
  } catch {
    return null // tampered, old secret, or garbage
  }
}

// ---------- cookies ----------

interface Ctx {
  origin: string
  secure: boolean
  sessionName: string
}

function context(request: Request, env: Env): Ctx {
  const origin = (env.PUBLIC_ORIGIN || new URL(request.url).origin).replace(/\/$/, '')
  const secure = origin.startsWith('https://')
  // __Host- cookies can't be set by subdomains or for other paths: the strictest kind. Needs HTTPS.
  return { origin, secure, sessionName: secure ? '__Host-expenses_session' : 'expenses_session' }
}

function cookie(name: string, value: string, maxAge: number, ctx: Ctx, path = '/'): string {
  return [`${name}=${value}`, `Path=${path}`, `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax', ctx.secure ? 'Secure' : ''].filter(Boolean).join('; ')
}

const STATE_COOKIE = 'expenses_oauth'

// ---------- responses ----------

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers)
  h.set('Content-Type', 'application/json')
  h.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(body), { status, headers: h })
}

function redirect(location: string, cookies: string[] = []): Response {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  for (const c of cookies) h.append('Set-Cookie', c)
  return new Response(null, { status: 302, headers: h })
}

/** Back to the app with a reason the sign-in screen can explain. */
const fail = (ctx: Ctx, reason: string) => redirect(`${ctx.origin}/?auth_error=${reason}`, [cookie(STATE_COOKIE, '', 0, ctx, '/api/auth')])

async function revoke(token: string, fetchImpl: Fetch) {
  await fetchImpl(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => {})
}

/** The ID token comes straight from Google over TLS, so reading its payload is enough (OpenID Connect §3.1.3.7). */
export function idTokenClaims(idToken: string | undefined): { email?: string; email_verified?: boolean } {
  try {
    return JSON.parse(dec.decode(fromB64url(idToken!.split('.')[1]))) as { email?: string; email_verified?: boolean }
  } catch {
    return {}
  }
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  id_token?: string
  scope?: string
  error?: string
}

// ---------- handler ----------

export async function handleAuth(request: Request, env: Env, fetchImpl: Fetch = fetch, now = Date.now): Promise<Response> {
  const missing = (['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET'] as const).filter((k) => !env[k])
  if (missing.length) return json({ error: 'not_configured', missing }, 500)
  const clientId = env.GOOGLE_CLIENT_ID!
  const clientSecret = env.GOOGLE_CLIENT_SECRET!
  const secret = env.SESSION_SECRET!

  const url = new URL(request.url)
  const ctx = context(request, env)
  const action = url.pathname.replace(/^\/api\/auth\/?/, '').replace(/\/$/, '')
  const redirectUri = `${ctx.origin}/api/auth/callback`
  const cookies = parseCookies(request.headers.get('Cookie'))

  if (action === 'start' && request.method === 'GET') {
    const state = randomToken()
    const back = safeReturn(url.searchParams.get('return'))
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      // "consent" makes Google always return a refresh token (it's skipped on repeat sign-ins otherwise).
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    })
    return redirect(`${AUTH_URL}?${params}`, [cookie(STATE_COOKIE, `${state}.${b64url(enc.encode(back))}`, STATE_SECONDS, ctx, '/api/auth')])
  }

  if (action === 'callback' && request.method === 'GET') {
    const [state, backB64] = (cookies[STATE_COOKIE] ?? '').split('.')
    if (url.searchParams.get('error')) return fail(ctx, 'cancelled')
    // The state must match the cookie set in /start: blocks forged sign-in links.
    if (!state || url.searchParams.get('state') !== state) return fail(ctx, 'expired')
    const code = url.searchParams.get('code')
    if (!code) return fail(ctx, 'cancelled')

    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    })
    const tokens = (await res.json().catch(() => ({}))) as TokenResponse
    if (!res.ok || !tokens.access_token) return fail(ctx, 'google_error')

    const claims = idTokenClaims(tokens.id_token)
    const granted = (tokens.scope ?? '').split(' ')
    const cleanup = () => revoke(tokens.refresh_token ?? tokens.access_token!, fetchImpl)
    if (!claims.email || claims.email_verified !== true || !isAllowed(claims.email, env)) {
      await cleanup()
      return fail(ctx, 'not_allowed')
    }
    if (!granted.includes(DRIVE_SCOPE)) {
      await cleanup()
      return fail(ctx, 'drive_permission')
    }
    if (!tokens.refresh_token) return fail(ctx, 'google_error')

    const back = safeReturn(backB64 ? dec.decode(fromB64url(backB64)) : '/')
    const session = await sealSession({ v: 1, rt: tokens.refresh_token, email: claims.email.toLowerCase() }, secret)
    return redirect(`${ctx.origin}${back}`, [cookie(ctx.sessionName, session, SESSION_SECONDS, ctx), cookie(STATE_COOKIE, '', 0, ctx, '/api/auth')])
  }

  if (action === 'token' && request.method === 'GET') {
    const clear = cookie(ctx.sessionName, '', 0, ctx)
    const session = await openSession(cookies[ctx.sessionName], secret)
    if (!session) return json({ error: 'signed_out' }, 401, { 'Set-Cookie': clear })
    // Removed from the allow-list since signing in: end the session.
    if (!isAllowed(session.email, env)) {
      await revoke(session.rt, fetchImpl)
      return json({ error: 'not_allowed' }, 401, { 'Set-Cookie': clear })
    }
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: session.rt, grant_type: 'refresh_token' }),
    }).catch(() => null)
    if (!res) return json({ error: 'google_unreachable' }, 502)
    const tokens = (await res.json().catch(() => ({}))) as TokenResponse
    // invalid_grant: revoked in the Google account, password change, or the 7-day limit of apps in "Testing".
    if (tokens.error === 'invalid_grant') return json({ error: 'signed_out' }, 401, { 'Set-Cookie': clear })
    // Anything else (e.g. invalid_client = wrong secret) is a setup problem: report it, keep the session.
    if (!res.ok || !tokens.access_token) return json({ error: 'google_error', detail: tokens.error }, 502)

    // Keep the cookie alive while the app is used (and store a rotated refresh token if Google sent one).
    const renewed = await sealSession({ ...session, rt: tokens.refresh_token ?? session.rt }, secret)
    return json({ email: session.email, accessToken: tokens.access_token, expiresAt: now() + (tokens.expires_in ?? 3600) * 1000 }, 200, {
      'Set-Cookie': cookie(ctx.sessionName, renewed, SESSION_SECONDS, ctx),
    })
  }

  if (action === 'logout' && request.method === 'POST') {
    // Only from the app's own pages.
    const from = request.headers.get('Origin')
    if (from && from !== ctx.origin) return json({ error: 'forbidden' }, 403)
    const session = await openSession(cookies[ctx.sessionName], secret)
    if (session) await revoke(session.rt, fetchImpl)
    return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(ctx.sessionName, '', 0, ctx), 'Cache-Control': 'no-store' } })
  }

  return json({ error: 'not_found' }, 404)
}
