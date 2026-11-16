import { toast } from 'sonner'
import { registerSW } from 'virtual:pwa-register'

/**
 * Service worker: makes the app work offline and installable.
 * New versions wait for a tap on "Reload" instead of swapping code under you mid-edit.
 */
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null
let registration: ServiceWorkerRegistration | undefined
let updateReady = false

function showUpdateToast() {
  toast('A new version of Expenses is ready', {
    id: 'app-update',
    description: 'Reload to update. Your data is not affected.',
    action: { label: 'Reload', onClick: () => startUpdate(() => applyUpdate!(true)) },
    duration: Infinity,
  })
}

export function registerServiceWorker() {
  applyUpdate = registerSW({
    onNeedRefresh() {
      updateReady = true
      showUpdateToast()
    },
    onOfflineReady() {
      toast.success('Ready to work offline')
    },
    onRegisteredSW(_url, reg) {
      registration = reg
    },
  })
}

/**
 * Ask the server for a newer version now (Settings → App version).
 * 'update': one is ready or downloading (the Reload toast shows when it's ready);
 * 'latest': this is the newest; 'unavailable': no service worker here (development, or an old browser).
 */
export async function checkForUpdate(): Promise<'update' | 'latest' | 'unavailable'> {
  if (updateReady) {
    showUpdateToast()
    return 'update'
  }
  if (!registration) return 'unavailable'
  await registration.update()
  return registration.installing || registration.waiting ? 'update' : 'latest'
}

// ---------- Update screen ----------

/** Set while an update is under way; survives the reload so the new page keeps saying "Updating…". */
const UPDATING = 'expenses.updating'
/** If the new version hasn't taken over by then, reload anyway (it's already downloaded). */
const UPDATE_FALLBACK_MS = 15_000

let updating = false
const updatingListeners = new Set<() => void>()

export const isUpdating = () => updating
export function subscribeUpdating(fn: () => void) {
  updatingListeners.add(fn)
  return () => updatingListeners.delete(fn)
}

/** Show the "Updating…" screen right away, then switch to the new version (which reloads the page). */
function startUpdate(apply: () => Promise<void>) {
  try {
    sessionStorage.setItem(UPDATING, '1')
  } catch {}
  document.documentElement.setAttribute('data-updating', '')
  updating = true
  updatingListeners.forEach((l) => l())
  void apply().catch(() => location.reload())
  setTimeout(() => location.reload(), UPDATE_FALLBACK_MS)
}

/** Called once the app has opened: the update (if any) is done, so the loading screen goes back to "Opening…". */
export function finishUpdate() {
  try {
    sessionStorage.removeItem(UPDATING)
  } catch {}
  document.documentElement.removeAttribute('data-updating')
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
