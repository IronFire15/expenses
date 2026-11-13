import type { ISODate } from '@/db/types'

/** "04-01-2026" or "04/01/2026" (day first) → "2026-01-04". */
export function parseDMY(s: string): ISODate | null {
  const m = /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.exec(s.trim())
  if (!m) return null
  const [, d, mo, y] = m
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null
  return `${y}-${mo}-${d}`
}

const PT_MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** "1 de Janeiro de 2026" → "2026-01-01". */
export function parsePortugueseLongDate(s: string): ISODate | null {
  const m = /(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})/i.exec(s)
  if (!m) return null
  const month = PT_MONTHS.indexOf(m[2].toLowerCase()) + 1
  if (!month) return null
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}
