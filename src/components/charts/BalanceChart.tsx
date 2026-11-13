import { motion, useReducedMotion } from 'motion/react'
import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { BalancePoint } from '@/dashboard/stats'
import { formatDate } from '@/lib/dates'
import { EASE_OUT } from '@/lib/motion'
import { ChartTooltip } from './ChartCard'
import { formatAxis, niceTicks, useWidth } from './utils'

const M = { top: 12, right: 64, bottom: 26, left: 52 }
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000

/**
 * Balance over time as a step line (a balance holds until the next transaction),
 * with a 10% area wash, a crosshair that snaps to the nearest day, and keyboard arrows.
 */
export function BalanceChart({
  points,
  shade,
  height = 220,
  format,
  color = 'var(--viz-spend)',
}: {
  points: BalancePoint[]
  shade?: { from: string; to: string }
  height?: number
  format: (cents: number) => string
  color?: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const reduce = useReducedMotion()

  if (points.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No balance data in your statements yet.</p>

  const values = points.map((p) => p.balance)
  const ticks = niceTicks(Math.min(0, ...values), Math.max(...values), 4)
  const lo = ticks[0]
  const hi = ticks.at(-1)!
  const compact = Math.max(Math.abs(lo), Math.abs(hi)) >= 10_000_00
  const d0 = day(points[0].date)
  const d1 = Math.max(day(points.at(-1)!.date), d0 + 1)
  const plotW = Math.max(0, width - M.left - M.right)
  const plotH = height - M.top - M.bottom
  const x = (iso: string) => M.left + ((day(iso) - d0) / (d1 - d0)) * plotW
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH

  // Step-after path: horizontal to the next day, then vertical.
  let line = `M${x(points[0].date)},${y(points[0].balance)}`
  for (let i = 1; i < points.length; i++) line += `H${x(points[i].date)}V${y(points[i].balance)}`
  const base = y(Math.max(lo, Math.min(0, hi)))
  const area = `${line}H${x(points.at(-1)!.date)}V${base}H${x(points[0].date)}Z`

  // Month ticks along the bottom.
  const monthTicks: string[] = []
  const start = new Date(`${points[0].date}T00:00:00Z`)
  for (let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)); day(m.toISOString().slice(0, 10)) <= d1; m.setUTCMonth(m.getUTCMonth() + 1)) {
    monthTicks.push(m.toISOString().slice(0, 10))
  }
  const every = Math.ceil(monthTicks.length / Math.max(1, Math.floor(plotW / 48)))

  const nearest = (px: number) => {
    let best = 0
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].date) - px) < Math.abs(x(points[best].date) - px)) best = i
    return best
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => setActive(nearest(e.clientX - e.currentTarget.getBoundingClientRect().left))
  const onKey = (e: KeyboardEvent) => {
    const i = active ?? points.length - 1
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: points.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    setActive(Math.max(0, Math.min(points.length - 1, next)))
  }

  const last = points.at(-1)!
  const a = active !== null ? points[active] : null

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-md"
          tabIndex={0}
          role="img"
          aria-label={`Balance from ${formatDate(points[0].date)} to ${formatDate(last.date)}. Latest ${format(last.balance)}. Use arrow keys to read each day.`}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onFocus={() => setActive((v) => v ?? points.length - 1)}
          onBlur={() => setActive(null)}
        >
          {shade && (
            <rect
              x={Math.max(M.left, x(shade.from))}
              width={Math.max(0, Math.min(x(shade.to), M.left + plotW) - Math.max(M.left, x(shade.from)))}
              y={M.top}
              height={plotH}
              className="fill-muted"
              opacity={0.7}
            />
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-viz-axis' : 'stroke-viz-grid'} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {formatAxis(t, compact)}
              </text>
            </g>
          ))}
          {monthTicks.map((m, i) =>
            i % every === 0 ? (
              <text key={m} x={x(m)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {formatDate(m, { month: 'short' })}
              </text>
            ) : null,
          )}

          <motion.path d={area} fill={color} fillOpacity={0.1} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.3 }} />
          <motion.path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: EASE_OUT }}
          />

          {/* Selective direct label: the latest value at the line's end. */}
          <circle cx={x(last.date)} cy={y(last.balance)} r={4} fill={color} className="stroke-card" strokeWidth={2} />
          <text x={x(last.date) + 8} y={y(last.balance)} dy="0.32em" className="fill-foreground text-xs font-medium tabular-nums">
            {formatAxis(last.balance, compact)}
          </text>

          {a && (
            <g pointerEvents="none">
              <line x1={x(a.date)} x2={x(a.date)} y1={M.top} y2={M.top + plotH} className="stroke-muted-foreground" strokeWidth={1} opacity={0.5} />
              <circle cx={x(a.date)} cy={y(a.balance)} r={5} fill={color} className="stroke-card" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {a && (
        <ChartTooltip
          x={x(a.date)}
          y={Math.max(0, y(a.balance) - 70)}
          containerWidth={width}
          title={formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          rows={[{ label: 'Balance, all accounts', value: format(a.balance), color }]}
        />
      )}
      {width === 0 && <div style={{ height }} />}
    </div>
  )
}
