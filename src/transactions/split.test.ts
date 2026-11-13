import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { budgetStatuses, levelFor, setBudget, suggestBudget } from '@/budgets/budgets'
import { totals } from '@/dashboard/stats'
import { ExpensesDB } from '@/db/db'
import { listActive, makeRecord } from '@/db/records'
import { seedDefaults } from '@/db/seed'
import type { Transaction } from '@/db/types'
import { undoImport } from '@/import/importer'
import { isCounted, splitTransaction, unsplitTransaction, validateSplit } from './split'
import { addTag, removeTag, tagCounts } from './tags'

let db: ExpensesDB

beforeEach(async () => {
  db = new ExpensesDB(`test-${crypto.randomUUID()}`)
  await db.open()
  await seedDefaults(db)
})
afterEach(async () => {
  await db.delete()
})

const addTx = async (data: Partial<Transaction>) => {
  const t = makeRecord<Transaction>({ accountId: 'a1', date: '2026-10-05', description: 'CONTINENTE', amount: -10000, tags: [], ...data })
  await db.transactions.add(t)
  return t
}

describe('split transactions', () => {
  it('validates parts', () => {
    expect(validateSplit({ amount: -1000 }, [{ amount: -600, categoryId: 'a' }, { amount: -400, categoryId: 'b' }])).toEqual([])
    expect(validateSplit({ amount: -1000 }, [{ amount: -600, categoryId: 'a' }])).toContain('Split into at least 2 parts.')
    expect(validateSplit({ amount: -1000 }, [{ amount: -600, categoryId: 'a' }, { amount: -300, categoryId: 'b' }])).toContain('The parts must add up to the original amount.')
    expect(validateSplit({ amount: -1000 }, [{ amount: -1100, categoryId: 'a' }, { amount: 100, categoryId: 'b' }])).toContain('All parts must go the same way as the original.')
  })

  it('replaces the original with its parts in totals, and undoes cleanly', async () => {
    const parent = await addTx({ importBatchId: 'b1', balanceAfter: 50000, dedupeHash: 'h1', tags: ['Home'] })
    const parts = await splitTransaction(db, parent.id, [
      { amount: -7000, categoryId: 'cat-groceries' },
      { amount: -3000, categoryId: 'cat-shopping', notes: 'Pan' },
    ])
    expect(parts.map((p) => p.categorySource)).toEqual(['manual', 'manual'])
    expect(parts.every((p) => p.splitOf === parent.id && p.importBatchId === 'b1' && !p.dedupeHash && p.tags[0] === 'Home')).toBe(true)

    const live = await listActive(db.transactions)
    expect(live.filter(isCounted)).toHaveLength(2)
    const types = new Map((await db.categories.toArray()).map((c) => [c.id, c.type]))
    expect(totals(live, types, { from: '2026-10-01', to: '2026-10-31', label: '' }).spent).toBe(10000)

    // Splitting again replaces the parts.
    await splitTransaction(db, parent.id, [
      { amount: -5000, categoryId: 'cat-groceries' },
      { amount: -5000, categoryId: 'cat-shopping' },
    ])
    expect((await listActive(db.transactions)).filter((t) => t.splitOf)).toHaveLength(2)

    await unsplitTransaction(db, parent.id)
    const after = await listActive(db.transactions)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: parent.id, split: false, categoryId: 'cat-groceries', categorySource: 'rule' })
  })

  it('undoing the import removes the parts too', async () => {
    const parent = await addTx({ importBatchId: 'b1' })
    await splitTransaction(db, parent.id, [
      { amount: -5000, categoryId: 'cat-groceries' },
      { amount: -5000, categoryId: 'cat-shopping' },
    ])
    await undoImport(db, 'b1')
    expect(await listActive(db.transactions)).toEqual([])
  })

  it('refuses to split a part', async () => {
    const parent = await addTx({})
    const [part] = await splitTransaction(db, parent.id, [
      { amount: -5000, categoryId: 'cat-groceries' },
      { amount: -5000, categoryId: 'cat-shopping' },
    ])
    await expect(splitTransaction(db, part.id, [{ amount: -2500, categoryId: 'a' }, { amount: -2500, categoryId: 'b' }])).rejects.toThrow(/can’t be split/)
  })
})

describe('tags', () => {
  it('adds without duplicates, reuses existing case, removes', async () => {
    const a = await addTx({})
    const b = await addTx({ tags: ['Vacation 2026'] })
    const used = await addTag(db, [a.id, b.id], '  vacation   2026 ', ['Vacation 2026'])
    expect(used).toBe('Vacation 2026')
    const txs = await db.transactions.toArray()
    expect(txs.map((t) => t.tags)).toEqual([['Vacation 2026'], ['Vacation 2026']])
    expect(tagCounts(txs)).toEqual([{ tag: 'Vacation 2026', count: 2 }])
    await removeTag(db, [a.id], 'Vacation 2026')
    expect((await db.transactions.get(a.id))!.tags).toEqual([])
  })
})

describe('budgets', () => {
  it('tracks spending per month with 80% / 100% levels', async () => {
    await addTx({ categoryId: 'cat-groceries', amount: -17000 })
    await addTx({ categoryId: 'cat-groceries', amount: 2000 }) // refund
    await addTx({ categoryId: 'cat-groceries', amount: -9000, date: '2026-09-10' })
    await addTx({ categoryId: 'cat-restaurants', amount: -5000 })
    await setBudget(db, 'cat-groceries', 18000)
    await setBudget(db, 'cat-restaurants', 4000)

    const [txs, cats, budgets] = await Promise.all([db.transactions.toArray(), db.categories.toArray(), db.budgets.toArray()])
    const status = budgetStatuses(budgets, txs, cats, '2026-10')
    expect(status.map((s) => [s.budget.categoryId, s.spent, s.level])).toEqual([
      ['cat-restaurants', 5000, 'over'],
      ['cat-groceries', 15000, 'near'],
    ])
    expect(suggestBudget(txs, 'cat-groceries', cats, ['2026-09', '2026-10'])).toBe(12000)

    await setBudget(db, 'cat-restaurants', 0)
    expect((await listActive(db.budgets)).map((b) => b.id)).toEqual(['budget-cat-groceries'])
  })

  it('levels', () => {
    expect([0.5, 0.8, 0.99, 1, 1.4].map((r) => levelFor(r))).toEqual(['ok', 'near', 'near', 'over', 'over'])
  })
})
