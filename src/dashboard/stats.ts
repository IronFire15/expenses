import type { Account, Category, ISODate, Transaction } from '@/db/types'
import { suggestPattern } from '@/rules/engine'
import { isCounted } from '@/transactions/split'

// ---------- Periods ----------

export interface Range {
  from: ISODate
  to: ISODate
  label: string
}

export interface Period extends Range {
  key: string
  /** The equally long period right before, for "vs previous" deltas. */
  previous: Range
  /** Months ("YYYY-MM") covered by the period. */
  months: string[]
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const firstDay = (ym: string): ISODate => `${ym}-01`
const lastDay = (ym: string): ISODate => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`
}
export const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number)
  return ymOf(new Date(y, m - 1 + n, 1))
}
export const monthLabel = (ym: string, style: 'long' | 'short' = 'long') => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' })
}
function monthsBetween(fromYm: string, toYm: string): string[] {
  const out: string[] = []
  for (let ym = fromYm; ym <= toYm; ym = addMonths(ym, 1)) out.push(ym)
  return out
}

function range(fromYm: string, toYm: string, label: string): Range {
  return { from: firstDay(fromYm), to: lastDay(toYm), label }
}

export interface PeriodOption {
  key: string
  label: string
}

/** Presets first (the filter people reach for), then each month that has data. */
export function periodOptions(dataMonths: string[]): { presets: PeriodOption[]; months: PeriodOption[] } {
  return {
    presets: [
      { key: 'last-3', label: 'Last 3 months' },
      { key: 'last-6', label: 'Last 6 months' },
      { key: 'last-12', label: 'Last 12 months' },
      { key: 'ytd', label: 'This year' },
      { key: 'all', label: 'All time' },
    ],
    months: [...dataMonths].sort().reverse().map((ym) => ({ key: `month:${ym}`, label: monthLabel(ym) })),
  }
}

/**
 * Turn a period key into dates. Rolling presets end with the latest month that has data
 * (statements arrive after the month ends, so "last 3 months" means the last 3 you have).
 */
export function resolvePeriod(key: string, dataMonths: string[], today = new Date()): Period {
  const sorted = [...dataMonths].sort()
  const latest = sorted.at(-1) ?? ymOf(today)
  const earliest = sorted[0] ?? latest

  let fromYm: string
  let toYm: string
  let label: string
  const month = /^month:(\d{4}-\d{2})$/.exec(key)?.[1]
  const rolling = /^last-(\d+)$/.exec(key)?.[1]

  if (month) {
    fromYm = toYm = month
    label = monthLabel(month)
  } else if (rolling) {
    toYm = latest
    fromYm = addMonths(latest, -(Number(rolling) - 1))
    label = `${monthLabel(fromYm, 'short')} – ${monthLabel(toYm)}`
  } else if (key === 'ytd') {
    toYm = latest
    fromYm = `${latest.slice(0, 4)}-01`
    label = latest.slice(0, 4)
  } else {
    // 'all' (and anything unknown)
    fromYm = earliest
    toYm = latest
    label = 'All time'
    key = 'all'
  }

  const months = monthsBetween(fromYm, toYm)
  const prevTo = addMonths(fromYm, -1)
  const prevFrom = addMonths(fromYm, -months.length)
  const previous = range(prevFrom, prevTo, months.length === 1 ? monthLabel(prevFrom) : `previous ${months.length} months`)
  return { key, ...range(fromYm, toYm, label), previous, months }
}

// ---------- Totals ----------

export type CategoryTypeMap = Map<string, Category['type']>

/** Transfers and investments ("Not spending") are left out of every total. A split counts through its parts. */
export function counts(t: Transaction, types: CategoryTypeMap): boolean {
  return isCounted(t) && types.get(t.categoryId ?? '') !== 'transfer'
}

const inRange = (t: Transaction, r: Range) => t.date >= r.from && t.date <= r.to

export interface Totals {
  spent: number
  income: number
  net: number
  count: number
}

export function totals(txs: Transaction[], types: CategoryTypeMap, r: Range): Totals {
  let spent = 0
  let income = 0
  let count = 0
  for (const t of txs) {
    if (!inRange(t, r) || !counts(t, types)) continue
    count++
    if (t.amount < 0) spent -= t.amount
    else income += t.amount
  }
  return { spent, income, net: income - spent, count }
}

export interface CategorySpend {
  categoryId: string | null // null = uncategorized
  spent: number
  count: number
}

/** Spending per category, largest first. Refunds inside an expense category reduce it. */
export function spendingByCategory(txs: Transaction[], types: CategoryTypeMap, r: Range): CategorySpend[] {
  const map = new Map<string | null, CategorySpend>()
  for (const t of txs) {
    if (!inRange(t, r) || !counts(t, types)) continue
    const id = t.categoryId ?? null
    if (id && types.get(id) === 'income') continue
    if (!id && t.amount > 0) continue // uncategorized money in isn't spending
    const row = map.get(id) ?? { categoryId: id, spent: 0, count: 0 }
    row.spent -= t.amount
    row.count++
    map.set(id, row)
  }
  return [...map.values()].filter((r) => r.spent > 0).sort((a, b) => b.spent - a.spent)
}

export interface MonthPoint {
  month: string
  spent: number
  income: number
}

export function monthly(txs: Transaction[], types: CategoryTypeMap, months: string[]): MonthPoint[] {
  return months.map((month) => {
    const t = totals(txs, types, range(month, month, month))
    return { month, spent: t.spent, income: t.income }
  })
}

export interface Payee {
  name: string
  spent: number
  count: number
  categoryId?: string
}

/** Who the money went to, grouped by a cleaned-up description ("COMPRA TOGETHER PRICE 5849280" → "Together Price"). */
export function topPayees(txs: Transaction[], types: CategoryTypeMap, r: Range, limit = 5): Payee[] {
  const map = new Map<string, Payee>()
  for (const t of txs) {
    if (!inRange(t, r) || !counts(t, types) || t.amount >= 0) continue
    const key = suggestPattern(t.description)
    const row = map.get(key) ?? { name: titleCase(key), spent: 0, count: 0, categoryId: t.categoryId }
    row.spent -= t.amount
    row.count++
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.spent - a.spent).slice(0, limit)
}

export function titleCase(s: string) {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

// ---------- Balance ----------

export interface BalancePoint {
  date: ISODate
  balance: number
}

/**
 * End-of-day balance per account, rebuilt from each row's "balance after".
 * Rows on the same day are chained (balance before = after − amount) to find the last one,
 * since the order inside a day isn't stored.
 */
export function endOfDayBalances(txs: Transaction[]): Map<ISODate, number> {
  const byDay = new Map<ISODate, Transaction[]>()
  for (const t of txs) {
    if (t.deleted || t.balanceAfter === undefined) continue
    const day = t.postedDate ?? t.date
    byDay.set(day, [...(byDay.get(day) ?? []), t])
  }
  const out = new Map<ISODate, number>()
  let previous: number | undefined
  for (const day of [...byDay.keys()].sort()) {
    const rows = byDay.get(day)!
    const befores = new Set(rows.map((r) => r.balanceAfter! - r.amount))
    // The last row is the one whose "after" isn't any other row's "before".
    const ends = rows.filter((r) => !befores.has(r.balanceAfter!))
    let end: number
    if (rows.length === 1 || ends.length === 1) end = (ends[0] ?? rows[0]).balanceAfter!
    else {
      // The day ends where it started (e.g. +100, -200, +100): ambiguous from balances alone.
      const sum = rows.reduce((s, r) => s + r.amount, 0)
      end = previous !== undefined ? previous + sum : rows[0].balanceAfter!
    }
    out.set(day, end)
    previous = end
  }
  return out
}

/** Opening balance of an account: the balance before its earliest row. */
function openingBalance(txs: Transaction[]): { day: ISODate; balance: number } | null {
  const rows = txs.filter((t) => !t.deleted && t.balanceAfter !== undefined)
  if (!rows.length) return null
  const day = rows.map((t) => t.postedDate ?? t.date).sort()[0]
  const sameDay = rows.filter((t) => (t.postedDate ?? t.date) === day)
  const afters = new Set(sameDay.map((r) => r.balanceAfter!))
  const first = sameDay.find((r) => !afters.has(r.balanceAfter! - r.amount)) ?? sameDay[0]
  return { day, balance: first.balanceAfter! - first.amount }
}

/** Total balance across all accounts, one point per day that changed, carrying each account forward. */
export function balanceHistory(txs: Transaction[], accounts: Account[]): BalancePoint[] {
  const perAccount = accounts
    .filter((a) => !a.deleted)
    .map((a) => {
      const own = txs.filter((t) => t.accountId === a.id)
      return { eod: endOfDayBalances(own), opening: openingBalance(own) }
    })
    .filter((a) => a.opening)

  const days = [...new Set(perAccount.flatMap((a) => [...a.eod.keys()]))].sort()
  const current = perAccount.map((a) => a.opening!.balance)
  return days.map((day) => {
    perAccount.forEach((a, i) => {
      const v = a.eod.get(day)
      if (v !== undefined) current[i] = v
    })
    return { date: day, balance: current.reduce((s, v) => s + v, 0) }
  })
}

// ---------- Coverage ----------

/**
 * Months covered by imported statements (from each import's period), so a missing statement
 * shows as "no data" instead of zero. Falls back to transaction months for imports without a period.
 */
export function coveredMonths(batches: { periodFrom?: ISODate; periodTo?: ISODate; deleted: boolean }[], txMonths: string[]): Set<string> {
  const out = new Set<string>()
  let anyPeriod = false
  for (const b of batches) {
    if (b.deleted || !b.periodFrom || !b.periodTo) continue
    anyPeriod = true
    for (let ym = b.periodFrom.slice(0, 7); ym <= b.periodTo.slice(0, 7); ym = addMonths(ym, 1)) out.add(ym)
  }
  return anyPeriod ? out : new Set(txMonths)
}
