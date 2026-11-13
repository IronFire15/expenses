import { AlertTriangle, ArrowLeftRight, CloudCheck, CloudOff, LayoutDashboard, Loader2, PiggyBank, Settings, Tags, Upload, Wallet, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { ThemeSwitcher } from '@/components/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatRelative } from '@/lib/dates'
import { pageVariants, SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useSyncStatus } from '@/sync'

const NAV: { to: string; label: string; short?: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', short: 'Activity', icon: ArrowLeftRight },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank },
  { to: '/import', label: 'Import', icon: Upload },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/30">
        <Wallet className="size-4.5" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Expenses</span>
    </div>
  )
}

function SyncStatus() {
  const status = useSyncStatus()
  const view =
    status.state === 'syncing'
      ? { icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />, label: 'Syncing', tip: 'Syncing with Google Drive…', tone: '' }
      : status.state === 'idle'
        ? { icon: <CloudCheck className="size-3.5 text-positive" aria-hidden />, label: 'Synced', tip: status.lastSyncedAt ? `Synced with Google Drive ${formatRelative(status.lastSyncedAt)}` : 'Synced', tone: '' }
        : status.state === 'offline'
          ? { icon: <CloudOff className="size-3.5" aria-hidden />, label: 'Offline', tip: 'Changes are saved here and sync when you’re back online.', tone: '' }
          : status.state === 'needs-auth' || status.state === 'needs-passphrase' || status.state === 'error'
            ? { icon: <AlertTriangle className="size-3.5" aria-hidden />, label: 'Sync paused', tip: 'Open Settings to fix Google Drive sync.', tone: 'bg-warning/15 text-warning' }
            : { icon: <CloudOff className="size-3.5" aria-hidden />, label: 'Local only', tip: 'Data is saved on this device. Turn on Google Drive sync in Settings.', tone: '' }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/settings"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            view.tone,
          )}
          aria-label={`${view.label}. ${view.tip}`}
        >
          {view.icon}
          {view.label}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{view.tip}</TooltipContent>
    </Tooltip>
  )
}

export function Layout() {
  const { pathname } = useLocation()

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-5 md:flex">
        <div className="mb-8 px-2">
          <Logo />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="sidebar-pill" className="absolute inset-0 rounded-lg bg-sidebar-accent" transition={SPRING} />
                  )}
                  <Icon className="relative size-4" aria-hidden />
                  <span className="relative">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-start gap-3 px-2">
          <SyncStatus />
          <ThemeSwitcher compact id="sidebar-theme" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-lg md:hidden">
          <div className="flex h-14 items-center">
            <Logo />
          </div>
          <SyncStatus />
        </header>

        <main id="main" tabIndex={-1} className="flex-1 px-4 pt-6 pb-28 outline-none md:px-10 md:pt-10 md:pb-12">
          <motion.div key={pathname} variants={pageVariants} initial="initial" animate="animate" className="mx-auto max-w-6xl">
            <Outlet />
          </motion.div>
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
      >
        {NAV.map(({ to, label, short, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                'flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none transition-colors focus-visible:bg-muted',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative grid h-7 w-14 place-items-center">
                  {isActive && (
                    <motion.span layoutId="tabbar-pill" className="absolute inset-0 rounded-full bg-brand-soft" transition={SPRING} />
                  )}
                  <motion.span whileTap={{ scale: 0.85 }} className="relative">
                    <Icon className="size-5" aria-hidden />
                  </motion.span>
                </span>
                <span className="max-w-full truncate px-1" aria-hidden>
                  {short ?? label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <ScrollRestoration />
    </div>
  )
}
