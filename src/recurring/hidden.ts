import type { ExpensesDB } from '@/db/db'

/** Series you marked "not recurring". Stored as a synced setting, so it applies on every device. */
export const HIDDEN_RECURRING = 'recurring.hidden'

export async function setRecurringHidden(db: ExpensesDB, key: string, hidden: boolean): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const rec = await db.settings.get(HIDDEN_RECURRING)
    const current = new Set(Array.isArray(rec?.value) && !rec.deleted ? (rec.value as string[]) : [])
    if (hidden) current.add(key)
    else current.delete(key)
    await db.settings.put({ id: HIDDEN_RECURRING, value: [...current], deleted: false, updatedAt: Date.now() })
  })
}
