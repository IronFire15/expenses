import { BarChart3, Table2 } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Surface } from '@/components/page'
import { Button } from '@/components/ui/button'

export interface LegendItem {
  label: string
  color: string // CSS color / var()
  shape?: 'rect' | 'line'
}

/**
 * Card for one chart: title, legend, and a Chart/Table toggle.
 * The table is the accessible twin of the chart: every value is readable without hovering.
 */
export function ChartCard({
  title,
  description,
  legend,
  table,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  legend?: LegendItem[]
  table?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  const [showTable, setShowTable] = useState(false)
  const id = useId()

  return (
    <Surface className={className}>
      <figure aria-labelledby={`${id}-title`} className="flex h-full flex-col p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="font-semibold tracking-tight">
              {title}
            </h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <div className="flex items-center gap-1">
            {action}
            {table && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTable((v) => !v)}
                aria-pressed={showTable}
                aria-label={showTable ? `Show ${title} as chart` : `Show ${title} as table`}
              >
                {showTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
                {showTable ? 'Chart' : 'Table'}
              </Button>
            )}
          </div>
        </div>
        {legend && legend.length > 1 && !showTable && (
          <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
            {legend.map((l) => (
              <li key={l.label} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={l.shape === 'line' ? 'h-0.5 w-3.5 rounded-full' : 'size-2.5 rounded-[3px]'}
                  style={{ backgroundColor: l.color }}
                />
                {l.label}
              </li>
            ))}
          </ul>
        )}
        <div className="min-h-0 flex-1">{showTable && table ? <div className="max-h-96 overflow-auto">{table}</div> : children}</div>
      </figure>
    </Surface>
  )
}

/** Small table used by every chart's table view. */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-card">
        <tr className="border-b text-left text-xs text-muted-foreground">
          {head.map((h, i) => (
            <th key={h} scope="col" className={`py-2 font-medium ${i > 0 ? 'text-right' : ''}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b last:border-0">
            {r.map((c, i) =>
              i === 0 ? (
                <th key={i} scope="row" className="py-2 text-left font-normal">
                  {c}
                </th>
              ) : (
                <td key={i} className="py-2 text-right tabular-nums">
                  {c}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Tooltip: values lead (strong), series names follow; series keyed with a short line. */
export function ChartTooltip({
  x,
  y,
  title,
  rows,
  containerWidth,
}: {
  x: number
  y: number
  title: string
  rows: { label: string; value: string; color?: string }[]
  containerWidth: number
}) {
  const w = 180
  const left = Math.max(0, Math.min(x - w / 2, containerWidth - w))
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-card-hover"
      style={{ left, top: y, width: w }}
    >
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-sm">
          {r.color && <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />}
          <span className="font-semibold whitespace-nowrap tabular-nums">{r.value}</span>
          {r.label && <span className="truncate text-xs text-muted-foreground">{r.label}</span>}
        </p>
      ))}
    </div>
  )
}
