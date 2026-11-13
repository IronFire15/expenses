import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExpensesDB } from '@/db/db'
import { listActive } from '@/db/records'
import { addManualTransaction, deleteTransaction, restoreTransactions } from '@/transactions/manual'
import { commitImport, markCrossFileDuplicates, prepareImport, undoImport } from './importer'
import { matchManualEntries } from './manualMatch'
import type { ParsedStatement } from './types'

const row = (date: string, amount: number, description = 'COMPRA RESTAURANTE ZE 123', balanceAfter = 0) => ({
  date, postedDate: date, description, amount, balanceAfter,
})

describe('matchManualEntries', () => {
  it('pairs same amount within the window, closest date first, each once', () => {
    const typed = [
      { id: 'a', date: '2026-01-10', amount: -1200 },
      { id: 'b', date: '2026-01-12', amount: -1200 },
      { id: 'far', date: '2026-01-01', amount: -500 },
    ]
    const result = matchManualEntries([row('2026-01-12', -1200), row('2026-01-11', -1200), row('2026-01-10', -500), row('2026-01-12', -999)], typed)
    expect(result).toEqual(['b', 'a', undefined, undefined]) // -500 is 9 days away; -999 has no entry
  })
  it('uses the posting date too', () => {
    expect(matchManualEntries([{ date: '2026-01-01', postedDate: '2026-01-09', amount: -100 }], [{ id: 'x', date: '2026-01-12', amount: -100 }])).toEqual(['x'])
  })
})

let db: ExpensesDB
beforeEach(async () => {
  db = new ExpensesDB(`test-${crypto.randomUUID()}`)
  await db.open()
})
afterEach(() => db.delete())

const statement = (rows: ReturnType<typeof row>[]): ParsedStatement => ({
  bank: 'Moey',
  currency: 'EUR',
  periodFrom: '2026-01-01',
  periodTo: '2026-01-31',
  sections: [{ matchKey: 'moey|X|current', name: 'Moey', type: 'bank', transactions: rows, finalBalance: rows.at(-1)?.balanceAfter, check: { ok: true, problems: [] } }],
})

async function accountId() {
  await commitImport(db, await prepareImport(db, statement([row('2026-01-02', -100, 'FIRST')]), 'first.pdf', 'h0'))
  return (await db.accounts.toArray())[0].id
}

describe('importing a statement with transactions typed by hand', () => {
  it('confirms the typed one instead of adding a duplicate, keeping category and notes', async () => {
    const acc = await accountId()
    const typed = await addManualTransaction(db, { accountId: acc, date: '2026-01-10', description: 'Lunch', amount: -1250, categoryId: 'cat-x', notes: 'with Ana' })

    const prep = await prepareImport(db, statement([row('2026-01-11', -1250, 'COMPRA RESTAURANTE ZE'), row('2026-01-11', -300, 'CAFE')]), 'jan.pdf', 'h1')
    expect(prep).toMatchObject({ newCount: 1, matchedCount: 1, duplicateCount: 0 })
    expect(prep.sections[0].rows[0]).toMatchObject({ matchesManual: typed.id, manualDescription: 'Lunch' })

    const batch = await commitImport(db, prep)
    expect(batch).toMatchObject({ rowCount: 1, matchedManual: 1, skippedDuplicates: 0 })
    const all = await listActive(db.transactions)
    expect(all).toHaveLength(3)
    const confirmed = all.find((t) => t.id === typed.id)!
    expect(confirmed).toMatchObject({
      description: 'COMPRA RESTAURANTE ZE',
      date: '2026-01-11',
      categoryId: 'cat-x',
      categorySource: 'manual',
      notes: 'with Ana',
      importBatchId: batch.id,
      manualEntry: { date: '2026-01-10', description: 'Lunch' },
    })
    expect(confirmed.manual).toBeUndefined()

    // Importing the same statement again adds nothing.
    const again = await prepareImport(db, statement([row('2026-01-11', -1250, 'COMPRA RESTAURANTE ZE'), row('2026-01-11', -300, 'CAFE')]), 'jan2.pdf', 'h2')
    expect(again).toMatchObject({ newCount: 0, matchedCount: 0, duplicateCount: 2 })
  })

  it('undoing the import brings back what you typed', async () => {
    const acc = await accountId()
    const typed = await addManualTransaction(db, { accountId: acc, date: '2026-01-10', description: 'Lunch', amount: -1250 })
    const batch = await commitImport(db, await prepareImport(db, statement([row('2026-01-11', -1250, 'COMPRA RESTAURANTE ZE')]), 'jan.pdf', 'h1'))
    expect(await undoImport(db, batch.id)).toBe(0)
    const back = await db.transactions.get(typed.id)
    expect(back).toMatchObject({ deleted: false, manual: true, description: 'Lunch', date: '2026-01-10' })
    expect(back?.importBatchId).toBeUndefined()
    expect(back?.dedupeHash).toBeUndefined()
  })

  it('one typed entry is confirmed by only one of several files', async () => {
    const acc = await accountId()
    await addManualTransaction(db, { accountId: acc, date: '2026-01-10', description: 'Lunch', amount: -1250 })
    const a = await prepareImport(db, statement([row('2026-01-11', -1250, 'A')]), 'a.pdf', 'ha')
    const b = await prepareImport(db, { ...statement([row('2026-01-12', -1250, 'B')]), periodFrom: '2026-01-02' }, 'b.pdf', 'hb')
    const [ma, mb] = markCrossFileDuplicates([a, b])
    expect([ma.matchedCount, mb.matchedCount, mb.newCount]).toEqual([1, 0, 1])
  })

  it('ignores typed entries in other accounts, deleted ones, and amounts that differ', async () => {
    const acc = await accountId()
    await db.accounts.add({ id: 'cash', name: 'Cash', type: 'cash', currency: 'EUR', updatedAt: 0, deleted: false })
    await addManualTransaction(db, { accountId: 'cash', date: '2026-01-10', description: 'Cash lunch', amount: -1250 })
    const gone = await addManualTransaction(db, { accountId: acc, date: '2026-01-10', description: 'Deleted', amount: -1250 })
    await addManualTransaction(db, { accountId: acc, date: '2026-01-10', description: 'Other amount', amount: -1251 })
    const ids = await deleteTransaction(db, gone.id)
    let prep = await prepareImport(db, statement([row('2026-01-11', -1250)]), 'jan.pdf', 'h1')
    expect(prep.matchedCount).toBe(0)
    await restoreTransactions(db, ids)
    prep = await prepareImport(db, statement([row('2026-01-11', -1250)]), 'jan.pdf', 'h1')
    expect(prep.matchedCount).toBe(1)
  })
})
