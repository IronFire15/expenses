import { NeedsAuthError } from './drive'

/**
 * The Google account this app is signed in with. The long-lived sign-in lives in an http-only cookie
 * held by the server part (server/auth.ts); this asks it for short-lived Drive tokens when needed.
 */

export interface AccountToken {
  email: string
  accessToken: string
  expiresAt: number
}

/** Remembered on this device so the app still opens offline. */
const REMEMBER_KEY = 'expenses.account'

export class ServerUnavailableError extends Error {
  constructor(detail?: string) {
    super(`The sign-in service isn’t answering${detail ? ` (${detail})` : ''}.`)
    this.name = 'ServerUnavailableError'
  }
}

export class GoogleAccount {
  private current: AccountToken | null = null
  private pending: Promise<AccountToken> | null = null

  get valid(): boolean {
    return !!this.current && this.current.expiresAt - Date.now() > 60_000
  }

  /** Signed-in address: live, or remembered from the last time online. */
  get email(): string | null {
    if (this.current) return this.current.email
    try {
      return localStorage.getItem(REMEMBER_KEY)
    } catch {
      return null
    }
  }

  /**
   * Fresh token from the server. Throws NeedsAuthError when signed out, ServerUnavailableError when the
   * server part is missing or failing, and TypeError when offline.
   */
  refresh(): Promise<AccountToken> {
    this.pending ??= (async () => {
      try {
        const res = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' })
        if (res.status === 401) {
          this.current = null
          this.remember(null)
          throw new NeedsAuthError()
        }
        const body = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as Partial<AccountToken> & { error?: string; detail?: string }) : null
        if (!res.ok || !body?.accessToken) throw new ServerUnavailableError(body?.detail ?? body?.error ?? `HTTP ${res.status}`)
        this.current = body as AccountToken
        this.remember(this.current.email)
        return this.current
      } finally {
        this.pending = null
      }
    })()
    return this.pending
  }

  async ensure(): Promise<void> {
    if (!this.valid) await this.refresh()
  }

  async token(): Promise<string> {
    await this.ensure()
    return this.current!.accessToken
  }

  /** Drop the cached Drive token (e.g. Drive said 401); the next call asks the server again. */
  forget() {
    this.current = null
  }

  /** Full-page trip to Google's sign-in, then back to `returnTo`. */
  signIn(returnTo = location.pathname + location.search): Promise<void> {
    location.assign(`/api/auth/start?return=${encodeURIComponent(returnTo)}`)
    return new Promise(() => {}) // the page is leaving
  }

  async signOut(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
    this.current = null
    this.remember(null)
  }

  private remember(email: string | null) {
    try {
      if (email) localStorage.setItem(REMEMBER_KEY, email)
      else localStorage.removeItem(REMEMBER_KEY)
    } catch {
      // private mode: just don't remember
    }
  }
}

export const googleAccount = new GoogleAccount()

/** Why the last sign-in failed, from `?auth_error=` (set by the server), as a sentence. */
export const AUTH_ERRORS: Record<string, string> = {
  not_allowed: 'That Google account isn’t allowed to use this app. Sign in with the account you set up.',
  drive_permission: 'Google Drive access wasn’t allowed. Sign in again and leave the Drive box ticked: the app can only see files it creates itself.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'The sign-in took too long or was opened in another tab. Try again.',
  google_error: 'Google didn’t complete the sign-in. Try again in a moment.',
}
