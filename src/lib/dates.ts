import type { ISODate } from '@/db/types'

const UI_LOCALE = 'en-GB'

const toDate = (iso: ISODate) => new Date(`${iso}T00:00:00`)

/** "2026-01-04" → "4 Jan 2026" */
export function formatDate(iso: ISODate, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return toDate(iso).toLocaleDateString(UI_LOCALE, opts)
}

/** A whole calendar month → "January 2026"; otherwise "4 Jan – 3 Feb 2026". */
export function formatPeriod(from?: ISODate, to?: ISODate): string {
  if (!from || !to) return 'Unknown period'
  const f = toDate(from)
  const t = toDate(to)
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()
  if (f.getDate() === 1 && t.getDate() === lastDay && f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
    return f.toLocaleDateString(UI_LOCALE, { month: 'long', year: 'numeric' })
  }
  return `${formatDate(from, { day: 'numeric', month: 'short' })} – ${formatDate(to)}`
}

/** "just now", "5 min ago", "yesterday", "3 days ago", or a date. */
export function formatRelative(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const days = Math.floor(s / 86400)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(ms).toLocaleDateString(UI_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
}
