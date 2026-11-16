import { Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { checkForUpdate } from '@/pwa'

const builtAt = new Date(__APP_BUILT_AT__).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Which version this device runs, and a manual check for a newer one. */
export function VersionCard() {
  const [busy, setBusy] = useState(false)

  const check = async () => {
    setBusy(true)
    try {
      const result = await checkForUpdate()
      if (result === 'latest') toast.success('You have the latest version')
      else if (result === 'update') toast('A new version is on its way', { description: 'Tap Reload when it appears to update.' })
      else toast('Updates can’t be checked here', { description: 'This only works in the installed app or on the live site.' })
    } catch {
      toast.error('Couldn’t check for updates', { description: 'Check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <dl>
        <div className="flex items-center justify-between gap-4 py-3 text-sm">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono font-medium">
            {__APP_COMMIT__}
            {__APP_DIRTY__ && <span className="ml-1.5 font-sans text-xs text-muted-foreground">(plus uncommitted changes)</span>}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t py-3 text-sm">
          <dt className="text-muted-foreground">Released</dt>
          <dd className="font-medium">{builtAt}</dd>
        </div>
      </dl>
      <Button variant="outline" onClick={() => void check()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Check for updates
      </Button>
    </div>
  )
}
