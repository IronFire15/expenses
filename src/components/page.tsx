import { ArrowDown, ArrowUp, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { AnimatedMoney } from '@/components/motion'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-medium tracking-wide text-primary uppercase">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  )
}

/** Base surface. `interactive` adds hover lift for clickable cards. */
export function Surface({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode
  className?: string
  interactive?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-card',
        interactive &&
          'transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-card-hover motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {children}
    </div>
  )
}

type Tone = 'neutral' | 'positive' | 'brand'

const TONE: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  positive: 'bg-positive/12 text-positive',
  brand: 'bg-brand-soft text-primary',
}

export interface Delta {
  current: number
  previous: number
  /** How much of the previous period your statements cover. */
  coverage: 'none' | 'partial' | 'full'
  /** Is "up" good for this figure? (Income: yes. Spending: no.) */
  upIsGood: boolean
  /** "vs September 2026" */
  versus: string
}

function DeltaLine({ delta }: { delta: Delta }) {
  const name = delta.versus.replace(/^vs /, '')
  const muted = (text: string) => <p className="mt-1 text-xs text-muted-foreground">{text}</p>
  if (delta.coverage === 'none') return muted(`No data for ${name}`)
  if (delta.coverage === 'partial') return muted(`Not enough data for ${name}`)
  if (delta.current === delta.previous) return muted(`Same as ${name}`)
  if (delta.previous === 0) return muted(`${name}: none`)
  const rel = (delta.current - delta.previous) / Math.abs(delta.previous)
  const pct = Math.round(Math.abs(rel) * 100)
  if (pct === 0) return muted(`About the same as ${name}`)
  const up = rel > 0
  const good = up === delta.upIsGood
  const Arrow = up ? ArrowUp : ArrowDown
  return (
    <p className="mt-1 flex items-center gap-1 text-xs">
      <span className={cn('inline-flex items-center gap-0.5 font-medium', good ? 'text-positive' : 'text-negative')}>
        <Arrow className="size-3" aria-hidden />
        <span className="sr-only">{up ? 'Up' : 'Down'}</span>
        {pct}%
      </span>
      <span className="text-muted-foreground">{delta.versus}</span>
    </p>
  )
}

export function StatCard({
  label,
  cents,
  icon: Icon,
  tone = 'neutral',
  hint,
  delta,
}: {
  label: string
  cents: number | undefined
  icon: LucideIcon
  tone?: Tone
  hint?: string
  delta?: Delta
}) {
  return (
    <Surface className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn('grid size-8 place-items-center rounded-lg', TONE[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      {/* Proportional figures for a standalone value; tabular-nums only for aligned columns. */}
      <div className="mt-3 h-9 text-2xl font-semibold tracking-tight md:text-[1.75rem]">
        {cents === undefined ? <Skeleton className="h-8 w-32" /> : <AnimatedMoney cents={cents} />}
      </div>
      {delta && cents !== undefined ? <DeltaLine delta={delta} /> : hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Surface>
  )
}

/** Friendly placeholder with a softly floating icon. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  badge,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  actions?: ReactNode
  badge?: ReactNode
}) {
  return (
    <Surface className="flex flex-col items-center px-6 py-14 text-center md:py-20">
      <div className="relative mb-6 grid place-items-center">
        <span className="absolute size-24 rounded-full bg-brand-soft opacity-50" aria-hidden />
        <span className="absolute size-16 rounded-full bg-brand-soft" aria-hidden />
        <motion.span
          className="relative grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Icon className="size-6" aria-hidden />
        </motion.span>
      </div>
      {badge && <div className="mb-3">{badge}</div>}
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children && <div className="mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
    </Surface>
  )
}
