import { SYNCED_TABLES, type ExpensesDB } from './db'
import type { BaseRecord } from './types'
import { defaultCategories, defaultRules } from './seed'

/**
 * Erase everything you've added: transactions, accounts, budgets, imports, your own rules and categories.
 *
 * Every record becomes a bare tombstone (`id`, `updatedAt`, `deleted`) with no content left,
 * so the deletion reaches other devices through sync while the old data itself is gone,
 * from here and from the Drive file once it uploads. The default categories and rules come back
 * fresh, stamped `now` so they also replace any edited copy on other devices.
 * `localMeta` (sync settings on this device) is kept.
 */
export async function clearAllData(db: ExpensesDB, now = Date.now()): Promise<void> {
  const defaults: Partial<Record<(typeof SYNCED_TABLES)[number], BaseRecord[]>> = {
    categories: defaultCategories(now),
    rules: defaultRules().map((r) => ({ ...r, updatedAt: now })),
  }
  await db.transaction('rw', SYNCED_TABLES.map((t) => db.table(t)), async () => {
    for (const t of SYNCED_TABLES) {
      const table = db.table<BaseRecord, string>(t)
      const ids = await table.toCollection().primaryKeys()
      const fresh = defaults[t] ?? []
      const keep = new Set(fresh.map((r) => r.id))
      await table.clear()
      await table.bulkAdd([...ids.filter((id) => !keep.has(id)).map((id) => ({ id, updatedAt: now, deleted: true })), ...fresh])
    }
  })
}
