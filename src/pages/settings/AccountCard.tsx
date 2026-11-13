import { LogOut, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
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
import { googleAccount } from '@/sync/account'

/** The Google account this device is signed in with, and Sign out. */
export function AccountCard() {
  const [confirm, setConfirm] = useState(false)
  const email = googleAccount.email

  if (!email) {
    return <p className="text-sm text-muted-foreground">Not signed in (development mode without the sign-in service).</p>
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
          {email.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{email}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0 text-positive" aria-hidden /> Signed in with Google on this device
          </p>
        </div>
      </div>
      <Button variant="outline" onClick={() => setConfirm(true)}>
        <LogOut aria-hidden /> Sign out
      </Button>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out on this device?</AlertDialogTitle>
            <AlertDialogDescription>
              Sync stops and the app asks you to sign in next time. Your data stays on this device and in Google Drive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay signed in</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void googleAccount.signOut().then(() => {
                  sessionStorage.clear()
                  location.assign('/')
                })
              }
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
