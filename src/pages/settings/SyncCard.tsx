import { AlertTriangle, Check, CloudCheck, CloudOff, Eye, EyeOff, KeyRound, Loader2, LogIn, RefreshCw } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatRelative } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { syncEngine, useSyncStatus } from '@/sync'
import { passphraseStrength, WrongPassphraseError } from '@/sync/crypto'
import { SYNC_FILE } from '@/sync/drive'

/** Re-render every 30 s so "synced 2 min ago" stays true. */
function useTick() {
  const [, setN] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong.'
}

function PassphraseForm({ mode }: { mode: 'create' | 'unlock' }) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const strength = passphraseStrength(pass)
  const canSubmit = mode === 'unlock' ? pass.length > 0 : strength.score >= 2 && pass === confirm

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await syncEngine.setPassphrase(pass)
      toast.success(mode === 'create' ? 'Sync is on. Your data is encrypted in Google Drive.' : 'Unlocked. This device is now in sync.')
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? 'That passphrase doesn’t open the sync file. Check for typos.' : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {mode === 'create'
          ? 'Choose a passphrase. It encrypts your data before it leaves this device, so Google can’t read it. You’ll type it once on each device.'
          : 'A sync file already exists in your Drive. Enter the passphrase you chose on your other device.'}
      </p>
      <div className="grid gap-2">
        <Label htmlFor="pass">Passphrase</Label>
        <div className="relative">
          <Input
            id="pass"
            type={show ? 'text' : 'password'}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            className="pr-10"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={show ? 'Hide passphrase' : 'Show passphrase'}
          >
            {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
        {mode === 'create' && pass && (
          <div className="flex items-center gap-2" aria-live="polite">
            <div className="flex flex-1 gap-1" aria-hidden>
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors',
                    strength.score >= i ? (strength.score === 1 ? 'bg-warning' : 'bg-positive') : 'bg-muted',
                  )}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{strength.label}</span>
          </div>
        )}
        {mode === 'create' && <p className="text-xs text-muted-foreground">At least 12 characters. A few random words work well.</p>}
      </div>
      {mode === 'create' && (
        <div className="grid gap-2">
          <Label htmlFor="pass2">Type it again</Label>
          <Input id="pass2" type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={confirm.length > 0 && confirm !== pass} />
          {confirm.length > 0 && confirm !== pass && <p className="text-xs text-destructive">Doesn’t match yet.</p>}
        </div>
      )}
      {mode === 'create' && (
        <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>Save it in your password manager. If it’s lost, the Drive copy can’t be opened, but the data on your devices is not affected.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!canSubmit || busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
          {mode === 'create' ? 'Encrypt and start syncing' : 'Unlock'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void syncEngine.disconnect()} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function SyncCard() {
  const status = useSyncStatus()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  useTick()

  const run = (fn: () => Promise<void>) => () => void fn().catch((err) => toast.error(errorText(err)))

  switch (status.state) {
    case 'starting':
    case 'connecting':
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Looking for your sync file in Google Drive…
        </p>
      )
    case 'disconnected':
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sync is off on this device. Turn it on to keep your phone and computers in sync through one encrypted file in your Google Drive. The app can only see files it creates, never the rest of your Drive.
          </p>
          <Button onClick={run(() => syncEngine.connect())}>
            <RefreshCw aria-hidden /> Turn on sync
          </Button>
        </div>
      )
    case 'needs-passphrase':
      return <PassphraseForm key={status.mode} mode={status.mode} />
  }

  const last = status.lastSyncedAt ? formatRelative(status.lastSyncedAt) : 'not yet'
  const line =
    status.state === 'syncing'
      ? { icon: <Loader2 className="size-4 animate-spin text-primary" aria-hidden />, text: 'Syncing…' }
      : status.state === 'offline'
        ? { icon: <CloudOff className="size-4 text-muted-foreground" aria-hidden />, text: `Offline. Changes sync when you’re back online. Last sync ${last}.` }
        : status.state === 'needs-auth'
          ? { icon: <AlertTriangle className="size-4 text-warning" aria-hidden />, text: 'Google sign-in ended (signed out, or access removed in your Google account). Sign in again to keep syncing.' }
          : status.state === 'error'
            ? { icon: <AlertTriangle className="size-4 text-destructive" aria-hidden />, text: status.message }
            : { icon: <CloudCheck className="size-4 text-positive" aria-hidden />, text: `Synced ${last}` }

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-sm" role="status">
        <span className="mt-0.5">{line.icon}</span>
        <span>{line.text}</span>
      </p>
      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <Check className="size-3.5 text-positive" aria-hidden /> Encrypted with your passphrase (AES-256)
        </li>
        <li className="flex items-center gap-2">
          <Check className="size-3.5 text-positive" aria-hidden /> My Drive › Expenses › {SYNC_FILE}
        </li>
        <li className="flex items-center gap-2">
          <Check className="size-3.5 text-positive" aria-hidden /> Weekly backup in Expenses › backups (last 12 kept)
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        {status.state === 'needs-auth' ? (
          <Button onClick={run(() => syncEngine.signInAgain())}>
            <LogIn aria-hidden /> Sign in again
          </Button>
        ) : (
          <Button variant="outline" onClick={run(() => syncEngine.syncNow())} disabled={status.state === 'syncing'}>
            <RefreshCw className={cn(status.state === 'syncing' && 'animate-spin')} aria-hidden /> Sync now
          </Button>
        )}
        <Button variant="ghost" onClick={() => setConfirmDisconnect(true)}>
          Turn off on this device
        </Button>
      </div>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off sync on this device?</AlertDialogTitle>
            <AlertDialogDescription>
              Your data stays on this device and in Google Drive. This device forgets the passphrase; turn sync on again any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep syncing</AlertDialogCancel>
            <AlertDialogAction onClick={run(() => syncEngine.disconnect())}>Turn off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
