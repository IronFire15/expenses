import type { ExpensesDB } from '@/db/db'
import type { Transaction } from '@/db/types'

/** Trim, collapse spaces, max 40 characters. Case is kept as typed ("Vacation 2026"). */
export function cleanTag(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 40)
}

const sameTag = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0

/** Add a tag to transactions. Matching ignores case, so "vacation" reuses an existing "Vacation". */
export async function addTag(db: ExpensesDB, ids: string[], raw: string, existing: string[] = []): Promise<string> {
  const typed = cleanTag(raw)
  if (!typed) return ''
  const tag = existing.find((t) => sameTag(t, typed)) ?? typed
  await db.transaction('rw', db.transactions, async () => {
    const txs = (await db.transactions.bulkGet(ids)).filter((t): t is Transaction => !!t)
    const now = Date.now()
    const changed = txs.filter((t) => !t.tags.some((x) => sameTag(x, tag))).map((t) => ({ ...t, tags: [...t.tags, tag], updatedAt: now }))
    if (changed.length) await db.transactions.bulkPut(changed)
  })
  return tag
}

export async function removeTag(db: ExpensesDB, ids: string[], tag: string): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const txs = (await db.transactions.bulkGet(ids)).filter((t): t is Transaction => !!t)
    const now = Date.now()
    const changed = txs.filter((t) => t.tags.includes(tag)).map((t) => ({ ...t, tags: t.tags.filter((x) => x !== tag), updatedAt: now }))
    if (changed.length) await db.transactions.bulkPut(changed)
  })
}

/** Every tag in use with how many transactions carry it, most used first. */
export function tagCounts(txs: Transaction[]): { tag: string; count: number }[] {
  const map = new Map<string, number>()
  for (const t of txs) for (const tag of t.tags) map.set(tag, (map.get(tag) ?? 0) + 1)
  return [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
