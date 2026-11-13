import type { Category, Cents, ISODate, Transaction } from '@/db/types'
import { titleCase } from '@/dashboard/stats'
import { suggestPattern } from '@/rules/engine'
import { isCounted } from '@/transactions/split'

export type Cadence = 'weekly' | 'biweekly' | 'monthly'

export interface RecurringSeries {
  /** Stable key, used to hide a series ("not recurring"). */
  key: string
  name: string
  /** Search text that finds its transactions. */
  pattern: string
  accountId: string
  direction: 'in' | 'out'
  cadence: Cadence
  /** Typical amount, always positive. */
  amount: Cents
  amountVaries: boolean
  /** Rough monthly cost (weekly × 52 / 12, …). */
  monthly: Cents
  categoryId?: string
  occurrences: Transaction[]
  last: ISODate
  /** Next expected date on or after `today`. */
  next: ISODate
  /** Still going: seen recently compared with the latest statement. */
  active: boolean
  /** For monthly series: the usual day of the month. */
  dayOfMonth?: number
}

const DAY = 86_400_000
const toDay = (iso: ISODate) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY)
const fromDay = (n: number): ISODate => new Date(n * DAY).toISOString().slice(0, 10)
const pad = (n: number) => String(n).padStart(2, '0')
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** A date in month `y-m` on `day`, clamped to the month's length (31 → 30 Apr). */
function onDay(y: number, m: number, day: number): ISODate {
  const yy = y + Math.floor((m - 1) / 12)
  const mm = ((m - 1) % 12 + 12) % 12 + 1
  return `${yy}-${pad(mm)}-${pad(Math.min(day, daysInMonth(yy, mm)))}`
}

const INTERVAL: Record<Exclude<Cadence, 'monthly'>, { days: number; tol: number }> = {
  weekly: { days: 7, tol: 1 },
  biweekly: { days: 14, tol: 2 },
}

/**
 * Fits a fixed-interval cadence (weekly, every 2 weeks)? Gaps that are whole multiples count too,
 * since a missing statement (or a skipped week) shouldn't break the series.
 */
function fitsInterval(days: number[], c: { days: number; tol: number }): boolean {
  const gaps = days.slice(1).map((d, i) => d - days[i])
  if (gaps.length < 2) return false
  let ok = 0
  let single = 0
  for (const g of gaps) {
    const k = Math.round(g / c.days)
    if (k >= 1 && Math.abs(g - k * c.days) <= c.tol * k) {
      ok++
      if (k === 1) single++
    }
  }
  return ok / gaps.length >= 0.8 && single / gaps.length >= 0.6
}

/** Circular distance between two days of the month (30 and 2 are 3 apart). */
const dayDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 31 - Math.abs(a - b))

/**
 * Monthly series inside one payee: transactions grouped by day of the month, so two subscriptions
 * from the same merchant (one on the 17th, one at the end of the month) come out as two series.
 */
function monthlyClusters(txs: Transaction[]): Transaction[][] {
  const clusters: { center: number; items: Transaction[] }[] = []
  for (const t of txs) {
    const day = Number(t.date.slice(8, 10))
    const near = clusters.find((c) => dayDistance(c.center, day) <= 4)
    if (near) near.items.push(t)
    else clusters.push({ center: day, items: [t] })
  }
  return clusters
    .map((c) => c.items)
    .filter((items) => {
      const months = items.map((t) => t.date.slice(0, 7))
      // At least 3 different months, and mostly one per month.
      return new Set(months).size >= 3 && new Set(months).size >= items.length * 0.8
    })
}

const monthIndex = (iso: ISODate) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1

/** Monthly series also need to be regular: most consecutive occurrences one month apart. */
function regularMonths(items: Transaction[]): boolean {
  const idx = [...new Set(items.map((t) => monthIndex(t.date)))].sort((a, b) => a - b)
  const gaps = idx.slice(1).map((m, i) => m - idx[i])
  return gaps.length >= 2 && gaps.filter((g) => g === 1).length / gaps.length >= 0.6 && gaps.every((g) => g <= 3)
}

function nextDate(cadence: Cadence, last: ISODate, today: ISODate, dayOfMonth?: number): ISODate {
  const t = toDay(today)
  if (cadence === 'monthly') {
    let y = Number(last.slice(0, 4))
    let m = Number(last.slice(5, 7)) + 1
    let d = onDay(y, m, dayOfMonth ?? Number(last.slice(8, 10)))
    while (toDay(d) < t) d = onDay(y, ++m, dayOfMonth ?? 1)
    return d
  }
  const step = INTERVAL[cadence].days
  let n = toDay(last) + step
  while (n < t) n += step
  return fromDay(n)
}

const PER_MONTH: Record<Cadence, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 }

/**
 * Find subscriptions, bills and regular income in past transactions.
 * Groups by account + cleaned-up payee + direction, then looks for a weekly, two-weekly or monthly rhythm.
 * Transfers between own accounts and investments are left out.
 *
 * `latest` is the newest date with data (statements lag behind today): a series is active when it
 * was seen within about two periods of it.
 */
export function detectRecurring(
  all: Transaction[],
  categories: Category[],
  today: ISODate,
  latest: ISODate = all.reduce((m, t) => (t.date > m ? t.date : m), ''),
): RecurringSeries[] {
  const types = new Map(categories.map((c) => [c.id, c.type]))
  const groups = new Map<string, Transaction[]>()
  for (const t of all) {
    if (!isCounted(t) || t.amount === 0 || types.get(t.categoryId ?? '') === 'transfer') continue
    const key = `${t.accountId}|${suggestPattern(t.description)}|${t.amount < 0 ? 'out' : 'in'}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }

  const out: RecurringSeries[] = []
  for (const [groupKey, txs] of groups) {
    if (txs.length < 3) continue
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date))
    const series: { cadence: Cadence; items: Transaction[]; dayOfMonth?: number }[] = []

    const days = sorted.map((t) => toDay(t.date))
    const fixed = (['weekly', 'biweekly'] as const).find((c) => fitsInterval(days, INTERVAL[c]))
    if (fixed) series.push({ cadence: fixed, items: sorted })
    else {
      for (const items of monthlyClusters(sorted)) {
        if (regularMonths(items)) series.push({ cadence: 'monthly', items, dayOfMonth: median(items.map((t) => Number(t.date.slice(8, 10)))) })
      }
    }

    const [accountId, pattern, direction] = groupKey.split('|') as [string, string, 'in' | 'out']
    for (const s of series) {
      const amounts = s.items.map((t) => Math.abs(t.amount))
      // A bill can vary (electricity), but not tenfold: that's a person you pay now and then.
      if (Math.max(...amounts) > Math.min(...amounts) * 3) continue
      const amount = median(amounts)
      const last = s.items.at(-1)!.date
      const periodDays = s.cadence === 'monthly' ? 31 : INTERVAL[s.cadence].days
      // Most common category among the occurrences.
      const catCount = new Map<string, number>()
      for (const t of s.items) if (t.categoryId) catCount.set(t.categoryId, (catCount.get(t.categoryId) ?? 0) + 1)
      const categoryId = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      out.push({
        key: `${groupKey}|${s.cadence}${s.dayOfMonth ? `|${s.dayOfMonth}` : ''}`,
        name: titleCase(pattern),
        pattern,
        accountId,
        direction,
        cadence: s.cadence,
        amount,
        amountVaries: (Math.max(...amounts) - Math.min(...amounts)) / amount > 0.1,
        monthly: Math.round(amount * PER_MONTH[s.cadence]),
        categoryId,
        occurrences: s.items,
        last,
        next: nextDate(s.cadence, last, today, s.dayOfMonth),
        active: toDay(latest) - toDay(last) <= periodDays * 2 + 3,
        dayOfMonth: s.dayOfMonth,
      })
    }
  }

  // Same name twice (two subscriptions from one merchant): tell them apart by day.
  const names = new Map<string, number>()
  for (const s of out) names.set(s.name, (names.get(s.name) ?? 0) + 1)
  for (const s of out) if ((names.get(s.name) ?? 0) > 1 && s.dayOfMonth) s.name = `${s.name} (around the ${ordinal(s.dayOfMonth)})`

  return out.sort((a, b) => a.next.localeCompare(b.next) || b.amount - a.amount)
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${s}`
}

export const CADENCE_LABEL: Record<Cadence, string> = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' }
