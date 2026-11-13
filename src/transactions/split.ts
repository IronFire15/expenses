import type { ExpensesDB } from '@/db/db'
import { makeRecord } from '@/db/records'
import type { Cents, Transaction } from '@/db/types'
import { recategorizeAll } from '@/rules/engine'

/**
 * What lists, totals, budgets and exports work with: live transactions, with a split original
 * replaced by its parts. The original stays in the database (balance, dedupe) but isn't counted.
 */
export function isCounted(t: Transaction): boolean {
  return !t.deleted && !t.split
}

export interface SplitPart {
  amount: Cents
  categoryId: string
  notes?: string
}

/** Problems with a proposed split, or an empty list when it can be saved. */
export function validateSplit(parent: Pick<Transaction, 'amount'>, parts: SplitPart[]): string[] {
  const problems: string[] = []
  if (parts.length < 2) problems.push('Split into at least 2 parts.')
  if (parts.some((p) => !p.categoryId)) problems.push('Every part needs a category.')
  if (parts.some((p) => p.amount === 0)) problems.push('Every part needs an amount.')
  if (parts.some((p) => Math.sign(p.amount) !== Math.sign(parent.amount))) problems.push('All parts must go the same way as the original.')
  const sum = parts.reduce((s, p) => s + p.amount, 0)
  if (sum !== parent.amount) problems.push('The parts must add up to the original amount.')
  return problems
}

/** Live parts of a split original. */
export async function splitParts(db: ExpensesDB, parentId: string): Promise<Transaction[]> {
  return (await db.transactions.filter((t) => t.splitOf === parentId && !t.deleted).toArray()).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

/**
 * Split a transaction into parts with their own category (e.g. one supermarket receipt = groceries + home).
 * Splitting again replaces the previous parts. Parts copy the import batch, so undoing the import removes them too.
 */
export async function splitTransaction(db: ExpensesDB, parentId: string, parts: SplitPart[]): Promise<Transaction[]> {
  return db.transaction('rw', db.transactions, async () => {
    const parent = await db.transactions.get(parentId)
    if (!parent || parent.deleted) throw new Error('Transaction not found.')
    if (parent.splitOf) throw new Error('A part of a split can’t be split again. Edit the original split instead.')
    const problems = validateSplit(parent, parts)
    if (problems.length) throw new Error(problems[0])

    const now = Date.now()
    const old = (await db.transactions.filter((t) => t.splitOf === parentId && !t.deleted).toArray()).map((t) => ({ ...t, deleted: true, updatedAt: now }))
    const children = parts.map((p) =>
      makeRecord<Transaction>(
        {
          accountId: parent.accountId,
          date: parent.date,
          postedDate: parent.postedDate,
          description: parent.description,
          amount: p.amount,
          categoryId: p.categoryId,
          categorySource: 'manual',
          tags: [...parent.tags],
          notes: p.notes?.trim() || undefined,
          // A confirmed hand-typed entry survives undoing its import, so its parts must too.
          importBatchId: parent.manualEntry ? undefined : parent.importBatchId,
          splitOf: parent.id,
        },
        now,
      ),
    )
    await db.transactions.bulkPut([...old, ...children, { ...parent, split: true, transferPairId: undefined, updatedAt: now }])
    return children
  })
}

/** Undo a split: removes the parts and brings back the original, categorized by rules again. */
export async function unsplitTransaction(db: ExpensesDB, parentId: string): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const parent = await db.transactions.get(parentId)
    if (!parent) return
    const now = Date.now()
    const parts = (await db.transactions.filter((t) => t.splitOf === parentId && !t.deleted).toArray()).map((t) => ({ ...t, deleted: true, updatedAt: now }))
    await db.transactions.bulkPut([...parts, { ...parent, split: false, updatedAt: now }])
  })
  await recategorizeAll(db)
}
