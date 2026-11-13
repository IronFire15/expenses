import { describe, expect, it } from 'vitest'
import { makeRecord } from '@/db/records'
import type { Account, Category, Transaction } from '@/db/types'
import { toCSV, toXlsx, transactionTable } from './export'
import { crc32 } from './zip'

const groceries = makeRecord<Category>({ id: 'g', name: 'Groceries', type: 'expense', color: '#000' })
const account = makeRecord<Account>({ id: 'a1', name: 'Moey', type: 'bank', currency: 'EUR' })
const tx = (data: Partial<Transaction>) => makeRecord<Transaction>({ accountId: 'a1', date: '2026-10-05', description: 'CONTINENTE', amount: -1234, tags: [], ...data })

describe('export', () => {
  const table = transactionTable(
    [
      tx({ categoryId: 'g', tags: ['Home', 'Food'], notes: 'Weekly; big "shop"' }),
      tx({ date: '2026-10-01', description: '=HYPERLINK("x")', amount: 250000 }),
      tx({ split: true, amount: -999 }), // split original: replaced by its parts
      { ...tx({}), deleted: true },
    ],
    new Map([['g', groceries]]),
    new Map([['a1', account]]),
  )

  it('builds rows in date order without split originals or deleted rows', () => {
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0][0]).toBe('2026-10-01')
    expect(table.rows[1]).toEqual(['2026-10-05', 'CONTINENTE', -12.34, 'EUR', 'Groceries', 'Expense', 'Moey', 'Home, Food', 'Weekly; big "shop"', ''])
  })

  it('writes European CSV with BOM, quoting and formula protection', () => {
    const csv = toCSV(table)
    expect(csv.startsWith('﻿Date;Description;Amount')).toBe(true)
    expect(csv).toContain(`2026-10-01;"'=HYPERLINK(""x"")";2500;`)
    expect(csv).toContain(';Home, Food;')
    expect(csv).toContain('-12,34;EUR;Groceries')
    expect(csv).toContain('"Weekly; big ""shop"""')
  })

  it('writes a valid zip for xlsx', () => {
    const bytes = toXlsx(table)
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50)
    expect(view.getUint16(bytes.length - 22 + 10, true)).toBe(6) // files
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('<c r="C2" s="2"><v>2500</v></c>')
    expect(text).toContain('<c r="A3" s="3"><v>46300</v></c>') // 2026-10-05 as an Excel date
    expect(text).toContain('Weekly; big &quot;shop&quot;')
  })

  it('crc32 matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})
