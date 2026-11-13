import type { ExpensesDB, SyncedTableName } from '@/db/db'
import { SYNCED_TABLES } from '@/db/db'
import type { BaseRecord } from '@/db/types'

/** Everything that syncs, as plain data. The Drive file holds one of these (encrypted). */
export interface Snapshot {
  format: 'expenses-snapshot'
  v: 1
  exportedAt: number
  tables: Record<SyncedTableName, BaseRecord[]>
}

export function emptySnapshot(): Snapshot {
  return {
    format: 'expenses-snapshot',
    v: 1,
    exportedAt: 0,
    tables: Object.fromEntries(SYNCED_TABLES.map((t) => [t, []])) as unknown as Snapshot['tables'],
  }
}

export function isSnapshot(x: unknown): x is Snapshot {
  const s = x as Snapshot
  return s?.format === 'expenses-snapshot' && s.v === 1 && typeof s.tables === 'object'
}

export async function exportSnapshot(db: ExpensesDB): Promise<Snapshot> {
  const tables = {} as Snapshot['tables']
  await db.transaction('r', SYNCED_TABLES.map((t) => db.table(t)), async () => {
    for (const t of SYNCED_TABLES) tables[t] = (await db.table(t).toArray()) as BaseRecord[]
  })
  return { format: 'expenses-snapshot', v: 1, exportedAt: Date.now(), tables }
}

/**
 * Which of two versions of the same record wins: newer `updatedAt`.
 * Ties (rare) are broken deterministically so every device picks the same one:
 * a deletion wins, then the larger serialized form.
 */
export function winner<T extends BaseRecord>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (a.deleted !== b.deleted) return a.deleted ? a : b
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b
}

/** Fingerprint per record (id → updatedAt + deleted) to tell whether two snapshots differ. */
export function sameData(a: Snapshot, b: Snapshot): boolean {
  for (const t of SYNCED_TABLES) {
    const ra = a.tables[t] ?? []
    const rb = b.tables[t] ?? []
    if (ra.length !== rb.length) return false
    const map = new Map(ra.map((r) => [r.id, `${r.updatedAt}|${r.deleted}`]))
    for (const r of rb) if (map.get(r.id) !== `${r.updatedAt}|${r.deleted}`) return false
  }
  return true
}

/**
 * Merge a snapshot into the local database, record by record: the newest version wins.
 * Runs in one transaction and re-reads each local record, so edits made while a sync is
 * downloading are never overwritten by older data. Returns how many local records changed.
 */
export async function applySnapshot(db: ExpensesDB, snap: Snapshot): Promise<number> {
  let changed = 0
  await db.transaction('rw', SYNCED_TABLES.map((t) => db.table(t)), async () => {
    for (const t of SYNCED_TABLES) {
      const incoming = snap.tables[t] ?? []
      if (!incoming.length) continue
      const table = db.table<BaseRecord, string>(t)
      const local = await table.bulkGet(incoming.map((r) => r.id))
      const toPut = incoming.filter((r, i) => {
        const l = local[i]
        return !l || (winner(l, r) === r && (l.updatedAt !== r.updatedAt || l.deleted !== r.deleted || JSON.stringify(l) !== JSON.stringify(r)))
      })
      if (toPut.length) await table.bulkPut(toPut)
      changed += toPut.length
    }
  })
  return changed
}
