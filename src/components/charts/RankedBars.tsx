import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { EASE_OUT } from '@/lib/motion'

export interface RankedRow {
  key: string
  label: string
  icon?: ReactNode
  value: number
  detail?: string
  href?: string
}

/**
 * Meter list: name, bar and figure per row, largest first, one hue.
 * Bars on a shared baseline compare more exactly than a donut. Each row links to its transactions.
 */
export function RankedBars({ rows, format, color = 'var(--viz-spend)' }: { rows: RankedRow[]; format: (v: number) => string; color?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  const total = rows.reduce((s, r) => s + r.value, 0)

  return (
    <ul className="space-y-1">
      {rows.map((r, i) => {
        const share = total ? Math.round((r.value / total) * 100) : 0
        const body = (
          <>
            <div className="flex items-center gap-2.5">
              {r.icon}
              <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
              <span className="text-sm font-medium tabular-nums">{format(r.value)}</span>
              <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{share}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: color, width: `${(r.value / max) * 100}%`, originX: 0 }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.05 * i }}
              />
            </div>
          </>
        )
        return (
          <li key={r.key}>
            {r.href ? (
              <Link
                to={r.href}
                className="block rounded-lg px-2 py-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${r.label}: ${format(r.value)}, ${share}% of spending${r.detail ? `, ${r.detail}` : ''}. Show transactions`}
              >
                {body}
              </Link>
            ) : (
              <div className="px-2 py-2">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
