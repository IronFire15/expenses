import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
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
import { syncEngine, useSyncStatus } from '@/sync'

const CONFIRM_WORD = 'DELETE'

/** Erase everything, here and (with sync on) in Google Drive and on your other devices. */
export function ClearDataCard() {
  const status = useSyncStatus()
  const syncOn = !['disconnected', 'starting', 'connecting', 'needs-passphrase'].includes(status.state)
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  const clear = async () => {
    setBusy(true)
    try {
      const result = await syncEngine.clearAllData()
      toast.dismiss() // older "Undo" toasts point at records that no longer exist
      toast.success('All data deleted', {
        description:
          result === 'synced'
            ? 'Erased here and in Google Drive. Your other devices erase theirs the next time they sync.'
            : result === 'pending'
              ? 'Erased here. Google Drive is erased the next time this device syncs.'
              : 'Erased on this device. Turn sync on again to erase the Google Drive copy too.',
      })
      setOpen(false)
    } catch (err) {
      toast.error('Couldn’t delete everything', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Delete all transactions, accounts, budgets, imports and your own categories and rules. Starts the app over with the default categories.
      </p>
      <Button
        variant="destructive"
        className="shrink-0"
        onClick={() => {
          setTyped('')
          setOpen(true)
        }}
      >
        <Trash2 aria-hidden /> Clear all data
      </Button>

      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all your data?</AlertDialogTitle>
            <AlertDialogDescription>
              {syncOn
                ? 'Everything is erased on this device, in your Google Drive sync file and its backups, and on your other devices the next time they sync.'
                : 'Everything is erased on this device. Sync is off here: your Google Drive copy is erased too if you turn sync on again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div role="alert" className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <strong className="font-semibold">This can’t be undone.</strong> Old data can’t be restored afterwards. Only a backup file you downloaded
              yourself (Backup and export, above) keeps a copy.
            </p>
          </div>

          <form
            id="clear-data-form"
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (typed === CONFIRM_WORD) void clear()
            }}
          >
            <Label htmlFor="clear-confirm">
              Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
            </Label>
            <Input
              id="clear-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
            />
          </form>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep my data</AlertDialogCancel>
            <Button type="submit" form="clear-data-form" variant="destructive" disabled={typed !== CONFIRM_WORD || busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />} Delete everything
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
