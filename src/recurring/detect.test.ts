import { describe, expect, it } from 'vitest'
import { makeRecord } from '@/db/records'
import type { Category, Transaction } from '@/db/types'
import { detectRecurring, ordinal } from './detect'

const cats: Category[] = [
  makeRecord<Category>({ id: 'cat-fitness', name: 'Fitness', type: 'expense', color: '#000' }),
  makeRecord<Category>({ id: 'cat-subscriptions', name: 'Subscriptions', type: 'expense', color: '#000' }),
  makeRecord<Category>({ id: 'cat-investments', name: 'Investments', type: 'transfer', color: '#000' }),
]

const tx = (date: string, description: string, amount: number, categoryId?: string) =>
  makeRecord<Transaction>({ accountId: 'a1', date, description, amount, tags: [], categoryId })

describe('detectRecurring', () => {
  it('finds a two-weekly debit, even across a missing month', () => {
    // EFIT UNIPE pattern: every 14 days, no August statement.
    const dates = ['2026-06-11', '2026-06-24', '2026-07-08', '2026-07-22', '2026-09-02', '2026-09-16', '2026-09-30', '2026-10-14', '2026-10-28']
    const txs = dates.map((d) => tx(d, 'DD-00019338002-EFIT UNIPE', -1098, 'cat-fitness'))
    const [s] = detectRecurring(txs, cats, '2026-11-13')
    expect(s).toMatchObject({ name: 'Efit Unipe', cadence: 'biweekly', amount: 1098, amountVaries: false, active: true, categoryId: 'cat-fitness' })
    expect(s.monthly).toBe(Math.round((1098 * 26) / 12))
    expect(s.next).toBe('2026-11-25') // 28 Oct + 14 = 11 Nov (past) → 25 Nov
  })

  it('splits two monthly subscriptions from the same merchant by day of month', () => {
    const txs = [
      ...['01', '02', '03', '04', '05', '06', '07', '09', '10'].map((m) => tx(`2026-${m}-17`, 'COMPRA TOGETHER PRICE 5849280', -715)),
      tx('2026-03-31', 'COMPRA TOGETHER PRICE 5849280', -715),
      tx('2026-04-29', 'COMPRA TOGETHER PRICE 5849280', -715),
      tx('2026-05-30', 'COMPRA TOGETHER PRICE 5849280', -715),
      tx('2026-06-29', 'COMPRA TOGETHER PRICE 5849280', -715),
      tx('2026-09-29', 'COMPRA TOGETHER PRICE 5849280', -715),
    ]
    const found = detectRecurring(txs, cats, '2026-11-13')
    expect(found).toHaveLength(2)
    expect(found.map((s) => s.dayOfMonth).sort()).toEqual([17, 29])
    expect(found.every((s) => s.cadence === 'monthly')).toBe(true)
    expect(found.map((s) => s.name).sort()).toEqual(['Together Price (around the 17th)', 'Together Price (around the 29th)'])
    expect(found.find((s) => s.dayOfMonth === 17)!.next).toBe('2026-11-17')
  })

  it('flags varying amounts and ignores irregular payees', () => {
    const rent = ['01-26', '02-25', '03-26', '04-24', '06-25', '07-24'].map((d, i) => tx(`2026-${d}`, 'Trf imediata JOSE SOUSA', -[300, 150, 200, 200, 400, 400][i]))
    const random = ['01-04', '01-14', '03-25', '04-06', '04-13', '04-21'].map((d) => tx(`2026-${d}`, 'Trf imediata ANA', -5000))
    // Monthly-looking dates but wildly different amounts: not a bill.
    const people = ['03-25', '04-21', '05-25', '06-27'].map((d, i) => tx(`2026-${d}`, 'Trf imediata MARIA', -[7064, 4000, 44200, 5000][i]))
    const found = detectRecurring([...rent, ...random, ...people], cats, '2026-11-13', '2026-10-31')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ cadence: 'monthly', amountVaries: true, active: false }) // last seen July, data to October
  })

  it('leaves out investments and transfers, and needs at least 3 occurrences', () => {
    const xtb = ['01-26', '02-25', '03-26', '04-24'].map((d) => tx(`2026-${d}`, 'Trf imediata XTB SA', -15000, 'cat-investments'))
    const twice = ['01-05', '02-05'].map((d) => tx(`2026-${d}`, 'NETFLIX', -999))
    expect(detectRecurring([...xtb, ...twice], cats, '2026-11-13')).toEqual([])
  })

  it('formats ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th'])
  })
})
