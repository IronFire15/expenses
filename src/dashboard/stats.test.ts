import { describe, expect, it } from 'vitest'
import { makeRecord } from '@/db/records'
import type { Account, Transaction } from '@/db/types'
import { balanceHistory, endOfDayBalances, monthly, resolvePeriod, spendingByCategory, topPayees, totals, type CategoryTypeMap } from './stats'

const tx = (over: Partial<Transaction>): Transaction =>
  makeRecord<Transaction>({ accountId: 'a', date: '2026-10-10', description: 'x', amount: -100, tags: [], ...over })

const types: CategoryTypeMap = new Map([
  ['cat-groceries', 'expense'],
  ['cat-salary', 'income'],
  ['cat-transfer', 'transfer'],
])

describe('resolvePeriod', () => {
  const months = ['2026-01', '2026-05', '2026-10']
  it('single month with the previous month for comparison', () => {
    const p = resolvePeriod('month:2026-10', months)
    expect(p).toMatchObject({ from: '2026-10-01', to: '2026-10-31', label: 'October 2026' })
    expect(p.previous).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
  })
  it('rolling presets end at the latest month with data', () => {
    const p = resolvePeriod('last-3', months)
    expect(p).toMatchObject({ from: '2026-08-01', to: '2026-10-31' })
    expect(p.months).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(p.previous).toMatchObject({ from: '2026-05-01', to: '2026-07-31' })
  })
  it('all time spans the data; unknown keys fall back to it', () => {
    expect(resolvePeriod('nonsense', months)).toMatchObject({ key: 'all', from: '2026-01-01', to: '2026-10-31' })
  })
})

describe('totals', () => {
  const data = [
    tx({ amount: -5000, categoryId: 'cat-groceries' }),
    tx({ amount: 200000, categoryId: 'cat-salary' }),
    tx({ amount: 30000, categoryId: 'cat-transfer' }), // ignored
    tx({ amount: -1000 }), // uncategorized counts as spending
    tx({ amount: -999, date: '2026-09-30' }), // outside
  ]
  const oct = resolvePeriod('month:2026-10', ['2026-10'])

  it('leaves transfers out', () => {
    expect(totals(data, types, oct)).toEqual({ spent: 6000, income: 200000, net: 194000, count: 3 })
  })
  it('groups spending by category, uncategorized as null', () => {
    expect(spendingByCategory(data, types, oct)).toEqual([
      { categoryId: 'cat-groceries', spent: 5000, count: 1 },
      { categoryId: null, spent: 1000, count: 1 },
    ])
  })
  it('builds monthly points', () => {
    expect(monthly(data, types, ['2026-09', '2026-10'])).toEqual([
      { month: '2026-09', spent: 999, income: 0 },
      { month: '2026-10', spent: 6000, income: 200000 },
    ])
  })
  it('groups payees by cleaned description', () => {
    const p = topPayees(
      [tx({ description: 'COMPRA TOGETHER PRICE 5849280', amount: -715 }), tx({ description: 'COMPRA TOGETHER PRICE 5849280', amount: -715 })],
      types,
      oct,
    )
    expect(p).toEqual([{ name: 'Together Price', spent: 1430, count: 2, categoryId: undefined }])
  })
})

describe('balance', () => {
  it('finds the last row of a day by chaining balances, whatever the stored order', () => {
    // Real order: +100 (122.26 → 222.26), -200 (→ 22.26), +50 (→ 72.26). Stored shuffled.
    const day = [
      tx({ postedDate: '2026-01-06', amount: 5000, balanceAfter: 7226 }),
      tx({ postedDate: '2026-01-06', amount: 10000, balanceAfter: 22226 }),
      tx({ postedDate: '2026-01-06', amount: -20000, balanceAfter: 2226 }),
    ]
    expect(endOfDayBalances(day).get('2026-01-06')).toBe(7226)
  })

  it('a day that ends where it started uses the previous day plus the day total', () => {
    const rows = [
      tx({ postedDate: '2026-01-05', amount: -1000, balanceAfter: 12226 }),
      // 122.26 → +100 → 222.26 → -100 → 122.26 (a cycle)
      tx({ postedDate: '2026-01-06', amount: 10000, balanceAfter: 22226 }),
      tx({ postedDate: '2026-01-06', amount: -10000, balanceAfter: 12226 }),
    ]
    expect(endOfDayBalances(rows).get('2026-01-06')).toBe(12226)
  })

  it('sums accounts and carries each forward', () => {
    const accounts = [makeRecord<Account>({ id: 'a', name: 'A', type: 'bank', currency: 'EUR' }), makeRecord<Account>({ id: 'b', name: 'B', type: 'savings', currency: 'EUR' })]
    const data = [
      tx({ accountId: 'a', date: '2026-01-04', amount: -1000, balanceAfter: 9000 }),
      tx({ accountId: 'b', date: '2026-01-10', amount: 12500, balanceAfter: 12500 }),
      tx({ accountId: 'a', date: '2026-01-10', amount: -12500, balanceAfter: -3500 }),
    ]
    expect(balanceHistory(data, accounts)).toEqual([
      { date: '2026-01-04', balance: 9000 + 0 },
      { date: '2026-01-10', balance: -3500 + 12500 },
    ])
  })
})

describe('coveredMonths', () => {
  it('uses statement periods, so a gap stays a gap even with a stray dated row', async () => {
    const { coveredMonths } = await import('./stats')
    const batches = [
      { periodFrom: '2026-07-01', periodTo: '2026-07-31', deleted: false },
      { periodFrom: '2026-09-01', periodTo: '2026-09-30', deleted: false },
      { periodFrom: '2026-10-01', periodTo: '2026-10-31', deleted: true },
    ]
    expect([...coveredMonths(batches, ['2026-07', '2026-08', '2026-09'])]).toEqual(['2026-07', '2026-09'])
    expect([...coveredMonths([], ['2026-08'])]).toEqual(['2026-08'])
  })
})
