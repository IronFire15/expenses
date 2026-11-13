import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExpensesDB } from '@/db/db'
import { listActive } from '@/db/records'
import { commitImport, dedupeKeys, markCrossFileDuplicates, prepareImport, undoImport } from './importer'
import type { ParsedStatement } from './types'

let db: ExpensesDB
beforeEach(async () => {
  db = new ExpensesDB(`test-${crypto.randomUUID()}`)
  await db.open()
})
afterEach(() => db.delete())

const row = (postedDate: string, amount: number, balanceAfter: number, description = 'COMPRA SHOP') => ({
  date: postedDate, postedDate, description, amount, balanceAfter,
})

function statement(rows = [row('2026-01-04', -1000, 9000), row('2026-01-05', -500, 8500)]): ParsedStatement {
  return {
    bank: 'Moey',
    currency: 'EUR',
    periodFrom: '2026-01-01',
    periodTo: '2026-01-31',
    sections: [
      { matchKey: 'moey|X|current', name: 'Moey', type: 'bank', transactions: rows, finalBalance: rows.at(-1)?.balanceAfter, check: { ok: true, problems: [] } },
      { matchKey: 'moey|X|savings', name: 'Moey Savings', type: 'savings', transactions: [], finalBalance: 0, check: { ok: true, problems: [] } },
    ],
  }
}

describe('dedupeKeys', () => {
  it('numbers identical rows so both are kept', () => {
    const keys = dedupeKeys('k', [row('2026-01-04', -100, 0), row('2026-01-04', -100, 0)])
    expect(keys[0]).not.toBe(keys[1])
  })
  it('ignores case, accents and spacing', () => {
    const [a] = dedupeKeys('k', [row('2026-01-04', -100, 0, 'Trf  CRÉDITO')])
    const [b] = dedupeKeys('k', [row('2026-01-04', -100, 0, 'trf credito')])
    expect(a).toBe(b)
  })
})

describe('import flow', () => {
  it('creates accounts, skips empty sections, then detects duplicates on re-import', async () => {
    const first = await prepareImport(db, statement(), 'Janeiro.pdf', 'hash-1')
    expect(first.sections).toHaveLength(1) // empty savings at 0,00 is skipped
    expect(first).toMatchObject({ newCount: 2, duplicateCount: 0 })

    const batch = await commitImport(db, first)
    expect(batch).toMatchObject({ rowCount: 2, skippedDuplicates: 0 })
    expect(await db.accounts.count()).toBe(1)

    // Overlapping second file: one old row + one new row.
    const second = await prepareImport(db, statement([row('2026-01-05', -500, 8500), row('2026-01-06', -200, 8300)]), 'b.pdf', 'hash-2')
    expect(second).toMatchObject({ newCount: 1, duplicateCount: 1 })
    expect(second.sections[0].accountId).toBeDefined()
    await commitImport(db, second)
    expect(await listActive(db.transactions)).toHaveLength(3)
    expect(await db.accounts.count()).toBe(1)
  })

  it('warns when the exact same file was imported before', async () => {
    await commitImport(db, await prepareImport(db, statement(), 'Janeiro.pdf', 'same'))
    const again = await prepareImport(db, statement(), 'Janeiro.pdf', 'same')
    expect(again.previouslyImportedAt).toBeTypeOf('number')
    expect(again.newCount).toBe(0)
  })

  it('marks overlaps between files reviewed together', async () => {
    const jan = await prepareImport(db, statement(), 'jan.pdf', 'h1')
    const overlap = await prepareImport(db, statement([row('2026-01-05', -500, 8500), row('2026-01-06', -200, 8300)]), 'b.pdf', 'h2')
    const sameAgain = await prepareImport(db, statement(), 'jan copy.pdf', 'h1')
    const [a, b, c] = markCrossFileDuplicates([jan, overlap, sameAgain])
    expect([a.newCount, b.newCount, c.newCount]).toEqual([2, 1, 0])
  })

  it('undo removes the rows and allows importing the file again', async () => {
    const batch = await commitImport(db, await prepareImport(db, statement(), 'Janeiro.pdf', 'h'))
    expect(await undoImport(db, batch.id)).toBe(2)
    expect(await listActive(db.transactions)).toHaveLength(0)

    const again = await prepareImport(db, statement(), 'Janeiro.pdf', 'h')
    expect(again).toMatchObject({ newCount: 2, previouslyImportedAt: undefined })
  })
})
