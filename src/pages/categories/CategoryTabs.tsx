import { motion } from 'motion/react'
import { NavLink } from 'react-router'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/categories', label: 'Categories' },
  { to: '/categories/rules', label: 'Rules' },
]

/** Categories / Rules switch, shared by both pages (same segmented control as Budgets / Recurring). */
export function CategoryTabs() {
  return (
    <nav aria-label="Categories and rules" className="mb-6 inline-flex w-fit rounded-lg bg-muted p-0.5">
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
                <motion.span layoutId="category-tab-pill" className="absolute inset-0 rounded-md bg-card shadow-card" transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }} />
              )}
              <span className="relative">{t.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
