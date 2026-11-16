import { useSyncExternalStore } from 'react'
import { subscribeUpdating, isUpdating } from '@/pwa'

/**
 * The loading screen. Same markup and CSS classes as the one in index.html (styles live there),
 * so going from the page's own copy to this one shows no change. Text switches to
 * "Updating…" while `data-updating` is set on <html>.
 */
export function Splash({ overlay = false }: { overlay?: boolean }) {
  return (
    <div className={overlay ? 'splash splash-overlay' : 'splash'} role="status" aria-live="polite">
      <svg className="splash-logo" viewBox="0 0 512 512" aria-hidden="true">
        <rect width="512" height="512" rx="112" fill="#0f766e" />
        <rect x="104" y="160" width="304" height="208" rx="36" fill="none" stroke="#fff" strokeWidth="32" />
        <path d="M104 216h304" stroke="#fff" strokeWidth="32" />
        <circle cx="340" cy="296" r="22" fill="#fff" />
      </svg>
      <div className="splash-spinner" aria-hidden="true" />
      <p className="splash-title splash-when-loading">Opening Expenses…</p>
      <p className="splash-title splash-when-updating">Updating Expenses…</p>
      <p className="splash-note splash-when-updating">Don’t close the app. This takes a few seconds, and your data is safe.</p>
    </div>
  )
}

/** Covers the app from the moment you tap Reload until the new version has loaded. */
export function UpdateOverlay() {
  const updating = useSyncExternalStore(subscribeUpdating, isUpdating)
  return updating ? <Splash overlay /> : null
}
