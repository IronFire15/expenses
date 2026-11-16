import { AlertTriangle, Loader2, LogIn, RefreshCw, ShieldCheck, Wallet, WifiOff } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Splash } from '@/components/Splash'
import { Button } from '@/components/ui/button'
import { EASE_OUT } from '@/lib/motion'
import { finishUpdate } from '@/pwa'
import { AUTH_ERRORS, googleAccount, ServerUnavailableError } from '@/sync/account'
import { NeedsAuthError } from '@/sync/drive'

type GateState =
  | { kind: 'checking' }
  | { kind: 'in' }
  | { kind: 'signed-out'; error?: string }
  | { kind: 'offline' } // never signed in on this device, and no connection
  | { kind: 'unavailable'; detail: string }

const DEV_BYPASS = 'expenses.devBypass'

/** `?auth_error=` left by the server after a failed sign-in. Read without changing the address. */
const AUTH_ERROR_CODE = new URL(location.href).searchParams.get('auth_error')
const AUTH_ERROR = AUTH_ERROR_CODE ? (AUTH_ERRORS[AUTH_ERROR_CODE] ?? 'Sign-in didn’t work. Try again.') : undefined

/** Remove `?auth_error=` from the address bar once it's shown. */
function cleanAddress() {
  const url = new URL(location.href)
  if (!url.searchParams.has('auth_error')) return
  url.searchParams.delete('auth_error')
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
}

async function check(): Promise<GateState> {
  const error = AUTH_ERROR
  if (import.meta.env.DEV && sessionStorage.getItem(DEV_BYPASS)) return { kind: 'in' }
  try {
    await googleAccount.refresh()
    return { kind: 'in' }
  } catch (err) {
    // Signed in on this device before: your data is here, so open it (sync catches up later).
    const known = !!googleAccount.email
    if (err instanceof NeedsAuthError) return { kind: 'signed-out', error }
    if (err instanceof TypeError) return known ? { kind: 'in' } : { kind: 'offline' }
    if (known) return { kind: 'in' }
    return { kind: 'unavailable', detail: err instanceof ServerUnavailableError ? err.message : String(err) }
  }
}

/**
 * Sign in with Google before the app opens. Once signed in on a device, it stays signed in for months,
 * and opens offline too. `onReady` runs once, when the app is shown (starts sync).
 */
export function AuthGate({ children, onReady }: { children: ReactNode; onReady: () => void }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' })
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    let alive = true
    void check().then((s) => {
      if (!alive) return
      setState(s)
      cleanAddress()
      finishUpdate()
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (state.kind === 'in') onReady()
  }, [state.kind, onReady])

  if (state.kind === 'in') return children
  if (state.kind === 'checking') return <Splash />

  const signIn = () => {
    setLeaving(true)
    void googleAccount.signIn()
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE_OUT } }}
        className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-card"
      >
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
          <Wallet className="size-7" aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>

        {state.kind === 'offline' ? (
          <>
            <p className="mt-2 text-sm text-pretty text-muted-foreground">You’re offline. Connect to the internet to sign in the first time on this device.</p>
            <Button size="lg" className="mt-6 w-full" onClick={() => location.reload()}>
              <WifiOff aria-hidden /> Try again
            </Button>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-pretty text-muted-foreground">
              Sign in once on this device. Your data stays on your devices and, encrypted, in your own Google Drive.
            </p>

            {state.kind === 'signed-out' && state.error && (
              <p role="alert" className="mt-5 flex gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-left text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                {state.error}
              </p>
            )}
            {state.kind === 'unavailable' && (
              <p role="alert" className="mt-5 flex gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-left text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  {state.detail}
                  {import.meta.env.DEV && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Development: start it with <code className="rounded bg-muted px-1">npm run dev:api</code>.
                    </span>
                  )}
                </span>
              </p>
            )}

            <Button size="lg" className="mt-6 w-full" onClick={signIn} disabled={leaving}>
              {leaving ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
              Sign in with Google
            </Button>
            {state.kind === 'unavailable' && (
              <Button variant="ghost" className="mt-2 w-full" onClick={() => location.reload()}>
                <RefreshCw aria-hidden /> Try again
              </Button>
            )}
            {import.meta.env.DEV && (
              <Button
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => {
                  sessionStorage.setItem(DEV_BYPASS, '1')
                  setState({ kind: 'in' })
                }}
              >
                Continue without sign-in (development only)
              </Button>
            )}

            <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-positive" aria-hidden /> Only approved Google accounts can sign in.
            </p>
          </>
        )}
      </motion.div>
    </main>
  )
}
