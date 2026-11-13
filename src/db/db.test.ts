import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExpensesDB } from './db'
import { addRecord, listActive, softDelete, updateRecord } from './records'
import { seedDefaults } from './seed'
import type { Account } from './types'

let db: ExpensesDB

beforeEach(async () => {
  db = new ExpensesDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('records', () => {
  it('adds, updates and soft-deletes with timestamps', async () => {
    const acc = await addRecord<Account>(db.accounts, { name: 'Main', type: 'bank', currency: 'EUR' })
    expect(acc.id).toMatch(/[0-9a-f-]{36}/)
    expect(acc.deleted).toBe(false)

    await new Promise((r) => setTimeout(r, 2))
    await updateRecord(db.accounts, acc.id, { name: 'Main bank' })
    const updated = await db.accounts.get(acc.id)
    expect(updated?.name).toBe('Main bank')
    expect(updated!.updatedAt).toBeGreaterThan(acc.updatedAt)

    await softDelete(db.accounts, acc.id)
    expect(await db.accounts.get(acc.id)).toMatchObject({ deleted: true })
    expect(await listActive(db.accounts)).toHaveLength(0)
  })
})

describe('seedDefaults', () => {
  it('seeds categories and rules once with fixed ids', async () => {
    expect(await seedDefaults(db)).toBeGreaterThan(50)
    const count = await db.categories.count()
    expect(count).toBeGreaterThan(15)
    expect(await db.categories.get('cat-groceries')).toMatchObject({ name: 'Groceries', updatedAt: 0 })
    expect(await db.rules.get('builtin-groceries-pingo-doce')).toMatchObject({ operator: 'word', builtin: true })

    expect(await seedDefaults(db)).toBe(0)
    expect(await db.categories.count()).toBe(count)
  })

  it('does not bring back a default the user deleted', async () => {
    await seedDefaults(db)
    await softDelete(db.rules, 'builtin-groceries-lidl')
    expect(await seedDefaults(db)).toBe(0)
    expect(await db.rules.get('builtin-groceries-lidl')).toMatchObject({ deleted: true })
  })

  it('retires replaced built-in rules unless you edited them', async () => {
    await db.rules.bulkAdd([
      { id: 'builtin-health-solinca', field: 'description', operator: 'word', pattern: 'solinca', categoryId: 'cat-health', priority: 909, builtin: true, updatedAt: 0, deleted: false },
      { id: 'builtin-health-ginasio', field: 'description', operator: 'word', pattern: 'ginasio', categoryId: 'cat-health', priority: 909, builtin: true, updatedAt: 42, deleted: false },
    ])
    await seedDefaults(db)
    expect(await db.rules.get('builtin-health-solinca')).toMatchObject({ deleted: true })
    expect(await db.rules.get('builtin-health-ginasio')).toMatchObject({ deleted: false })
    expect(await db.rules.get('builtin-fitness-solinca')).toMatchObject({ categoryId: 'cat-fitness' })
    expect(await db.categories.get('cat-fitness')).toMatchObject({ name: 'Fitness', icon: 'dumbbell' })
  })

  it('does not overwrite a category that arrived from sync', async () => {
    await db.categories.put({
      id: 'cat-groceries', name: 'Supermarket', type: 'expense', color: '#000', updatedAt: 5, deleted: false,
    })
    await seedDefaults(db)
    expect((await db.categories.get('cat-groceries'))?.name).toBe('Supermarket')
  })
})
