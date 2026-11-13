import type { ExpensesDB } from '@/db/db'
import { makeRecord } from '@/db/records'
import type { Account, Cents, ISODate, Transaction } from '@/db/types'
import { recategorizeAll } from '@/rules/engine'

export interface ManualInput {
  accountId: string
  date: ISODate
  description: string
  /** Negative = money out. */
  amount: Cents
  /** Empty = let the rules decide. */
  categoryId?: string
  notes?: string
}

const categoryFields = (categoryId?: string) =>
  categoryId
    ? { categoryId, categorySource: 'manual' as const, ruleId: undefined, transferPairId: undefined }
    : { categoryId: undefined, categorySource: undefined, ruleId: undefined }

/** Add a transaction typed by hand. A later bank import confirms it instead of adding it twice. */
export async function addManualTransaction(db: ExpensesDB, input: ManualInput): Promise<Transaction> {
  const tx = makeRecord<Transaction>({
    accountId: input.accountId,
    date: input.date,
    description: input.description.trim(),
    amount: input.amount,
    notes: input.notes?.trim() || undefined,
    tags: [],
    manual: true,
    ...categoryFields(input.categoryId),
  })
  await db.transactions.add(tx)
  await recategorizeAll(db)
  return tx
}

/** Change a hand-typed transaction that no bank import has confirmed yet. */
export async function updateManualTransaction(db: ExpensesDB, id: string, input: ManualInput): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const tx = await db.transactions.get(id)
    if (!tx || tx.deleted) throw new Error('Transaction not found.')
    if (!tx.manual) throw new Error('Only transactions you typed by hand can be edited.')
    if (tx.split && tx.amount !== input.amount) throw new Error('Undo the split before changing the amount.')
    await db.transactions.put({
      ...tx,
      accountId: input.accountId,
      date: input.date,
      description: input.description.trim(),
      amount: input.amount,
      notes: input.notes?.trim() || undefined,
      // Keep the category of a split original as is: its parts carry the real ones.
      ...(tx.split ? {} : categoryFields(input.categoryId)),
      updatedAt: Date.now(),
    })
  })
  await recategorizeAll(db)
}

/**
 * Delete a transaction (and its split parts). Soft delete, so it disappears on every device.
 * Returns the ids it deleted, for `restoreTransactions` (Undo).
 */
export async function deleteTransaction(db: ExpensesDB, id: string): Promise<string[]> {
  const ids = await db.transaction('rw', db.transactions, async () => {
    const now = Date.now()
    const tx = await db.transactions.get(id)
    if (!tx || tx.deleted) return []
    const parts = (await db.transactions.filter((t) => t.splitOf === id && !t.deleted).toArray()).map((t) => ({ ...t, deleted: true, updatedAt: now }))
    await db.transactions.bulkPut([...parts, { ...tx, deleted: true, updatedAt: now }])
    return [tx.id, ...parts.map((p) => p.id)]
  })
  await recategorizeAll(db)
  return ids
}

/** Bring back deleted transactions (the Undo in the toast). */
export async function restoreTransactions(db: ExpensesDB, ids: string[]): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const now = Date.now()
    const txs = (await db.transactions.bulkGet(ids)).filter((t): t is Transaction => !!t)
    await db.transactions.bulkPut(txs.map((t) => ({ ...t, deleted: false, updatedAt: now })))
  })
  await recategorizeAll(db)
}

/** Account used for cash you spend (created the first time you pick it). */
export async function ensureCashAccount(db: ExpensesDB, currency = 'EUR'): Promise<string> {
  const existing = (await db.accounts.toArray()).find((a) => !a.deleted && a.type === 'cash')
  if (existing) return existing.id
  const account = makeRecord<Account>({ name: 'Cash', type: 'cash', currency })
  await db.accounts.add(account)
  return account.id
}
