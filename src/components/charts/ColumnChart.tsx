import { motion } from 'motion/react'
import { useState } from 'react'
import { EASE_OUT } from '@/lib/motion'
import { ChartTooltip } from './ChartCard'
import { columnPath, formatAxis, niceTicks, useWidth } from './utils'

export interface ColumnDatum {
  key: string
  label: string // full, for tooltips: "October 2026"
  short: string // axis: "Oct"
  values: number[] // one per series, cents
  /** No statement covers this month: shown as "no data", never as zero. */
  noData?: boolean
}

export interface ColumnSeries {
  name: string
  color: string
}

const M = { top: 8, right: 4, bottom: 26, left: 52 }
const BAR_MAX = 24
const GAP = 2 // surface gap between touching bars

/**
 * Grouped columns. Months outside `highlight` are faded (emphasis on the selected period).
 * Each month is one hover/focus target covering its whole band.
 */
export function ColumnChart({
  data,
  series,
  highlight,
  height = 220,
  format,
}: {
  data: ColumnDatum[]
  series: ColumnSeries[]
  highlight?: Set<string>
  height?: number
  format: (cents: number) => string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const max = Math.max(0, ...data.flatMap((d) => d.values))
  const ticks = niceTicks(0, max || 100_00, 4)
  const top = ticks.at(-1)!
  const compact = top >= 10_000_00
  const plotW = Math.max(0, width - M.left - M.right)
  const plotH = height - M.top - M.bottom
  const band = data.length ? plotW / data.length : 0
  const barW = Math.max(2, Math.min(BAR_MAX, (band * 0.7 - GAP * (series.length - 1)) / series.length))
  const groupW = barW * series.length + GAP * (series.length - 1)
  const y = (v: number) => M.top + plotH - (v / top) * plotH
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44)))

  return (
    <div ref={ref} className="relative" onPointerLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" role="group" aria-label="Columns by month">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-viz-axis' : 'stroke-viz-grid'} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {formatAxis(t, compact)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const x0 = M.left + i * band + (band - groupW) / 2
            const dim = highlight && !highlight.has(d.key)
            return (
              <g key={d.key}>
                {active === i && <rect x={M.left + i * band} y={M.top} width={band} height={plotH} className="fill-muted" opacity={0.6} rx={6} />}
                {d.noData && (
                  <text x={M.left + i * band + band / 2} y={y(0) - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {band >= 44 ? 'no data' : '–'}
                  </text>
                )}
                {!d.noData && d.values.map((v, s) => (
                  <motion.path
                    key={s}
                    d={columnPath(x0 + s * (barW + GAP), y(v), barW, y(0))}
                    fill={series[s].color}
                    fillOpacity={dim ? 0.28 : 1}
                    style={{ transformBox: 'fill-box', originY: 1 }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.5, ease: EASE_OUT, delay: i * 0.03 }}
                  />
                ))}
                {i % labelEvery === 0 && (
                  <text x={M.left + i * band + band / 2} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                    {d.short}
                  </text>
                )}
                {/* Hit target: the whole band, bigger than the marks; keyboard focusable. */}
                <rect
                  x={M.left + i * band}
                  y={M.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={d.noData ? `${d.label}: no statement imported` : `${d.label}: ${series.map((s, si) => `${s.name} ${format(d.values[si])}`).join(', ')}`}
                  className="outline-none focus-visible:stroke-ring focus-visible:stroke-2"
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            )
          })}
        </svg>
      )}
      {active !== null && data[active] && (
        <ChartTooltip
          x={M.left + active * band + band / 2}
          y={Math.max(0, y(Math.max(...data[active].values)) - 76)}
          containerWidth={width}
          title={data[active].label}
          rows={
            data[active].noData
              ? [{ label: '', value: 'No statement imported' }]
              : series.map((s, si) => ({ label: s.name, value: format(data[active].values[si]), color: s.color }))
          }
        />
      )}
      {width === 0 && <div style={{ height }} />}
    </div>
  )
}
