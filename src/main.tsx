import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { AuthGate } from '@/components/AuthGate'
import { ThemeProvider } from '@/components/theme'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { db } from '@/db/db'
import { seedDefaults } from '@/db/seed'
import { recategorizeAll } from '@/rules/engine'
import { captureInstallPrompt, registerServiceWorker } from '@/pwa'
import { router } from '@/router'
import { startSync } from '@/sync'
import './index.css'

// Cloudflare gives each upload its own address (abcd1234.expenses-io.pages.dev). Google sign-in only
// knows the main address, so move there.
const upload = /^[0-9a-f]{8}\.(.+\.pages\.dev)$/.exec(location.hostname)
if (upload) location.replace(`https://${upload[1]}${location.pathname}${location.search}${location.hash}`)

captureInstallPrompt()
registerServiceWorker()

// Add any new default categories/rules, then categorize with them.
const ready = seedDefaults(db).then(() => recategorizeAll(db))

/** Sync starts once you're signed in (or the app opened offline on a device you used before). */
let syncStarted = false
const startSyncOnce = () => {
  if (syncStarted) return
  syncStarted = true
  void ready.finally(startSync)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      {/* "user": follow the OS "reduce motion" setting for every animation. */}
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={300}>
          <AuthGate onReady={startSyncOnce}>
            <RouterProvider router={router} />
          </AuthGate>
          <Toaster position="top-center" richColors closeButton />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  </StrictMode>,
)
