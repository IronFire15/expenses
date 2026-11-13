import { toast } from 'sonner'
import { registerSW } from 'virtual:pwa-register'

/**
 * Service worker: makes the app work offline and installable.
 * New versions wait for a tap on "Reload" instead of swapping code under you mid-edit.
 */
export function registerServiceWorker() {
  const update = registerSW({
    onNeedRefresh() {
      toast('A new version of Expenses is ready', {
        description: 'Reload to update. Your data is not affected.',
        action: { label: 'Reload', onClick: () => void update(true) },
        duration: Infinity,
      })
    },
    onOfflineReady() {
      toast.success('Ready to work offline')
    },
  })
}

// ---------- Install ----------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

/** Chrome/Edge/Android fire this once, early: capture it at startup so the button can use it later. */
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export type InstallState = 'installed' | 'available' | 'ios' | 'manual'

export function installState(): InstallState {
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  if (standalone) return 'installed'
  if (deferred) return 'available'
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  return 'manual'
}

export function subscribeInstall(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  notify()
  return outcome === 'accepted'
}
