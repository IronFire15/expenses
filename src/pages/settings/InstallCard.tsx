import { Check, Download, Monitor, Share, SquarePlus } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { installState, promptInstall, subscribeInstall } from '@/pwa'

/** Install the app to the home screen / dock, with the right instructions for each browser. */
export function InstallCard() {
  const state = useSyncExternalStore(subscribeInstall, installState)

  if (state === 'installed') {
    return (
      <p className="flex items-center gap-2 text-sm">
        <Check className="size-4 text-positive" aria-hidden /> Installed. You’re using the app version.
      </p>
    )
  }
  if (state === 'available') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Opens in its own window, starts faster and works offline.</p>
        <Button onClick={() => void promptInstall().then((ok) => ok && toast.success('Installed'))}>
          <Download aria-hidden /> Install app
        </Button>
      </div>
    )
  }
  if (state === 'ios') {
    return (
      <ol className="space-y-2 text-sm">
        <li className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">1</span>
          Open this page in Safari, tap <Share className="size-4" aria-label="Share" />
        </li>
        <li className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">2</span>
          Choose <SquarePlus className="size-4" aria-hidden /> <strong className="font-medium">Add to Home Screen</strong>
        </li>
      </ol>
    )
  }
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Monitor className="mt-0.5 size-4 shrink-0" aria-hidden />
      In Chrome or Edge: the install icon at the right of the address bar. In Safari on Mac: File › Add to Dock.
      Phones can install it from the app’s https web address.
    </p>
  )
}
