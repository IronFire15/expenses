import { useEffect, useRef, useState } from 'react'
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '@/lib/money'

/** Width of an element, kept in sync with ResizeObserver. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** Round tick values: 0, 250, 500… covering [min, max] in about `count` steps. Values in cents. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) max = min + 100_00
  const rawStep = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(rawStep))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? 10 * mag
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v))
  if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step)
  return ticks
}

const axisFmt = new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'currency', currency: DEFAULT_CURRENCY, maximumFractionDigits: 0 })
const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** Axis tick: whole euros under 10 000, compact above ("12K €"). One style per axis. */
export function formatAxis(cents: number, compact: boolean): string {
  return compact ? `${compactFmt.format(cents / 100)} €` : axisFmt.format(cents / 100)
}

/** Top-rounded column/bar path: 4px rounded data end, square at the baseline. */
export function columnPath(x: number, yTop: number, width: number, yBase: number, radius = 4): string {
  const h = yBase - yTop
  if (h <= 0 || width <= 0) return ''
  const r = Math.min(radius, width / 2, h)
  return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + width - r}Q${x + width},${yTop} ${x + width},${yTop + r}V${yBase}Z`
}
