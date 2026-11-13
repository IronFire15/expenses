import type { ExpensesDB } from '@/db/db'
import type { ISODate, Transaction } from '@/db/types'

/** How far apart (in days) a typed entry and the bank's row may be and still match. Card payments often post a few days later. */
export const MATCH_WINDOW_DAYS = 5

const dayNumber = (iso: ISODate) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)

type BankRow = { date: ISODate; postedDate: ISODate; amount: number }
type Typed = Pick<Transaction, 'id' | 'date' | 'amount'>

/**
 * Pair statement rows with transactions you typed by hand: same amount, dates at most
 * MATCH_WINDOW_DAYS apart (value or posting date). Closest dates pair first, each side used once.
 * Returns, per row, the id of the typed transaction it matches (or undefined).
 * The descriptions are not compared: what you type ("Lunch") rarely looks like the bank's text.
 */
export function matchManualEntries(rows: BankRow[], typed: Typed[]): (string | undefined)[] {
  const candidates: { row: number; id: string; gap: number }[] = []
  rows.forEach((r, row) => {
    for (const t of typed) {
      if (t.amount !== r.amount) continue
      const day = dayNumber(t.date)
      const gap = Math.min(Math.abs(dayNumber(r.date) - day), Math.abs(dayNumber(r.postedDate) - day))
      if (gap <= MATCH_WINDOW_DAYS) candidates.push({ row, id: t.id, gap })
    }
  })
  candidates.sort((a, b) => a.gap - b.gap || a.row - b.row)

  const result: (string | undefined)[] = rows.map(() => undefined)
  const used = new Set<string>()
  for (const c of candidates) {
    if (result[c.row] !== undefined || used.has(c.id)) continue
    result[c.row] = c.id
    used.add(c.id)
  }
  return result
}

/** Hand-typed transactions of an account still waiting for a bank statement. */
export async function pendingManual(db: ExpensesDB, accountId: string): Promise<Transaction[]> {
  return (await db.transactions.where('accountId').equals(accountId).toArray()).filter((t) => t.manual && !t.deleted && !t.splitOf)
}
