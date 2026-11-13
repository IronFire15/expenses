import type { EntityTable } from 'dexie'
import type { BaseRecord } from './types'

export type NewRecord<T extends BaseRecord> = Omit<T, 'id' | 'updatedAt' | 'deleted'> & { id?: string }

/** Build a full record with id, timestamp and tombstone flag. */
export function makeRecord<T extends BaseRecord>(data: NewRecord<T>, now = Date.now()): T {
  return { ...data, id: data.id ?? crypto.randomUUID(), updatedAt: now, deleted: false } as T
}

export async function addRecord<T extends BaseRecord>(table: EntityTable<T, 'id'>, data: NewRecord<T>): Promise<T> {
  const record = makeRecord<T>(data)
  await table.add(record)
  return record
}

/** Update fields and bump `updatedAt` so the change wins on the next sync. */
export async function updateRecord<T extends BaseRecord>(
  table: EntityTable<T, 'id'>,
  id: string,
  changes: Partial<Omit<T, 'id' | 'updatedAt'>>,
): Promise<void> {
  const existing = await table.where('id').equals(id).first()
  if (!existing) throw new Error(`Record ${id} not found`)
  await table.put({ ...existing, ...changes, updatedAt: Date.now() })
}

/** Soft delete: keeps a tombstone so the deletion reaches other devices. */
export function softDelete<T extends BaseRecord>(table: EntityTable<T, 'id'>, id: string): Promise<void> {
  return updateRecord(table, id, { deleted: true } as Partial<Omit<T, 'id' | 'updatedAt'>>)
}

/** All non-deleted records of a table. */
export async function listActive<T extends BaseRecord>(table: EntityTable<T, 'id'>): Promise<T[]> {
  return (await table.toArray()).filter((r) => !r.deleted)
}
