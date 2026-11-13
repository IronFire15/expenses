import { motion } from 'motion/react'
import { NavLink } from 'react-router'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/budgets', label: 'Budgets' },
  { to: '/budgets/recurring', label: 'Recurring' },
]

/** Budgets / Recurring switch, shared by both pages (a segmented control made of links). */
export function PlanTabs() {
  return (
    <nav aria-label="Budgets and recurring" className="mb-6 inline-flex w-fit rounded-lg bg-muted p-0.5">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            cn(
              'relative rounded-md px-4 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:py-2.5',
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span layoutId="plan-tab-pill" className="absolute inset-0 rounded-md bg-card shadow-card" transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }} />
              )}
              <span className="relative">{t.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

/** Progress bar drawn with scaleX (cheap to animate). Values above 1 fill the bar. */
export function Meter({ ratio, tone, label }: { ratio: number; tone: 'ok' | 'near' | 'over'; label: string }) {
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} className="h-2 overflow-hidden rounded-full bg-muted">
      <motion.div
        className={cn('h-full origin-left rounded-full', tone === 'over' ? 'bg-negative' : tone === 'near' ? 'bg-warning' : 'bg-primary')}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: Math.min(1, ratio) }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  )
}
