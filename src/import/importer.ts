import type { ExpensesDB } from '@/db/db'
import { makeRecord } from '@/db/records'
import type { Account, ImportBatch, Transaction } from '@/db/types'
import { recategorizeAll } from '@/rules/engine'
import { matchManualEntries, pendingManual } from './manualMatch'
import type { ParsedStatement, ParsedTransaction } from './types'

/** Lowercase, strip accents and collapse spaces so tiny formatting differences don't defeat dedupe. */
export function normalizeDescription(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Duplicate key: account + date + amount + description, plus an occurrence number
 * so two genuinely identical payments on the same day both survive.
 */
export function dedupeKeys(accountKey: string, rows: ParsedTransaction[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const base = `${accountKey}|${r.postedDate}|${r.amount}|${normalizeDescription(r.description)}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}|${n}`
  })
}

export async function sha256(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface PreparedRow extends ParsedTransaction {
  dedupeHash: string
  duplicate: boolean
  /** Id of a transaction you typed by hand that this row confirms (it's updated, not added again). */
  matchesManual?: string
  /** What you typed for that match, shown in the review. */
  manualDescription?: string
}

export interface PreparedSection {
  matchKey: string
  name: string
  type: Account['type']
  /** Existing account this section maps to, if any. */
  accountId?: string
  rows: PreparedRow[]
  balanceOk: boolean
  problems: string[]
}

export interface PreparedImport {
  fileName: string
  fileHash: string
  bank: string
  currency: string
  periodFrom?: string
  periodTo?: string
  sections: PreparedSection[]
  /** Set when this exact file was imported before (and not undone). */
  previouslyImportedAt?: number
  /** Rows that will be added. */
  newCount: number
  duplicateCount: number
  /** Rows that confirm a transaction you typed by hand. */
  matchedCount: number
}

function counts(sections: PreparedSection[]) {
  const all = sections.flatMap((s) => s.rows)
  return {
    newCount: all.filter((r) => !r.duplicate && !r.matchesManual).length,
    duplicateCount: all.filter((r) => r.duplicate).length,
    matchedCount: all.filter((r) => !r.duplicate && r.matchesManual).length,
  }
}

/**
 * Compare a parsed statement with the database, without writing anything.
 * Duplicates are matched by the account's stable matchKey (not its random id), so they're
 * found even before the account exists on this device.
 */
export async function prepareImport(db: ExpensesDB, stmt: ParsedStatement, fileName: string, fileHash: string): Promise<PreparedImport> {
  const accounts = (await db.accounts.toArray()).filter((a) => !a.deleted)
  const previous = (await db.importBatches.where('fileHash').equals(fileHash).toArray()).find((b) => !b.deleted)

  // Skip empty sections that carry no information (e.g. an untouched savings account at 0,00).
  const relevant = stmt.sections.filter((s) => s.transactions.length > 0 || (s.finalBalance ?? 0) !== 0)

  const sections: PreparedSection[] = []
  for (const s of relevant) {
    const account = accounts.find((a) => a.matchKey === s.matchKey)
    const keys = dedupeKeys(s.matchKey, s.transactions)
    const existing = new Set(
      (await db.transactions.where('dedupeHash').anyOf(keys).toArray()).filter((t) => !t.deleted).map((t) => t.dedupeHash),
    )
    const rows: PreparedRow[] = s.transactions.map((t, i) => ({ ...t, dedupeHash: keys[i], duplicate: existing.has(keys[i]) }))
    if (account) {
      const typed = await pendingManual(db, account.id)
      const fresh = rows.filter((r) => !r.duplicate)
      matchManualEntries(fresh, typed).forEach((id, i) => {
        if (!id) return
        fresh[i].matchesManual = id
        fresh[i].manualDescription = typed.find((t) => t.id === id)?.description
      })
    }
    sections.push({
      matchKey: s.matchKey,
      name: account?.name ?? s.name,
      type: s.type,
      accountId: account?.id,
      rows,
      balanceOk: s.check.ok,
      problems: s.check.problems,
    })
  }

  return {
    fileName,
    fileHash,
    bank: stmt.bank,
    currency: stmt.currency,
    periodFrom: stmt.periodFrom,
    periodTo: stmt.periodTo,
    sections,
    previouslyImportedAt: previous?.importedAt,
    ...counts(sections),
  }
}

/**
 * When several files are reviewed together, a later file can overlap an earlier one
 * (or be the same file twice). Mark those rows as duplicates too, so the counts shown
 * before importing match what will actually be added. Files are processed oldest period first.
 */
export function markCrossFileDuplicates(preps: PreparedImport[]): PreparedImport[] {
  const seenRows = new Set<string>()
  const seenFiles = new Set<string>()
  const seenManual = new Set<string>()
  const ordered = [...preps].sort((a, b) => (a.periodFrom ?? '').localeCompare(b.periodFrom ?? ''))
  const result = new Map<PreparedImport, PreparedImport>()

  for (const prep of ordered) {
    const sameFileAgain = seenFiles.has(prep.fileHash)
    seenFiles.add(prep.fileHash)
    const sections = prep.sections.map((s) => ({
      ...s,
      rows: s.rows.map((r) => {
        const duplicate = r.duplicate || sameFileAgain || seenRows.has(r.dedupeHash)
        if (!duplicate) seenRows.add(r.dedupeHash)
        // A typed entry can only be confirmed once, by the earliest file.
        const matchesManual = !duplicate && r.matchesManual && !seenManual.has(r.matchesManual) ? r.matchesManual : undefined
        if (matchesManual) seenManual.add(matchesManual)
        return { ...r, duplicate, matchesManual, manualDescription: matchesManual ? r.manualDescription : undefined }
      }),
    }))
    result.set(prep, { ...prep, sections, ...counts(sections) })
  }
  return preps.map((p) => result.get(p)!)
}

/** Write one prepared file: creates missing accounts, adds new rows, records the batch. All or nothing. */
export async function commitImport(db: ExpensesDB, prep: PreparedImport): Promise<ImportBatch> {
  return db.transaction('rw', db.accounts, db.transactions, db.importBatches, async () => {
    const accountIds: string[] = []
    const txs: Transaction[] = []
    const confirmed: Transaction[] = []
    const batchId = crypto.randomUUID()

    for (const s of prep.sections) {
      // Re-check inside the transaction: another file in the same session may have created it.
      let accountId = (await db.accounts.toArray()).find((a) => !a.deleted && a.matchKey === s.matchKey)?.id
      if (!accountId) {
        const account = makeRecord<Account>({
          name: s.name,
          type: s.type,
          currency: prep.currency,
          institution: prep.bank,
          matchKey: s.matchKey,
        })
        await db.accounts.add(account)
        accountId = account.id
      }
      accountIds.push(accountId)

      const taken = new Set(
        (await db.transactions.where('dedupeHash').anyOf(s.rows.map((r) => r.dedupeHash)).toArray())
          .filter((t) => !t.deleted)
          .map((t) => t.dedupeHash),
      )
      // Rows that confirm a transaction you typed by hand update it (keeping your category, notes, tags).
      const fresh = s.rows.filter((r) => !taken.has(r.dedupeHash))
      const typed = await pendingManual(db, accountId)
      const matches = matchManualEntries(fresh, typed)
      for (const [i, r] of fresh.entries()) {
        const entry = typed.find((t) => t.id === matches[i])
        if (entry) {
          confirmed.push({
            ...entry,
            date: r.date,
            postedDate: r.postedDate !== r.date ? r.postedDate : undefined,
            description: r.description,
            balanceAfter: r.balanceAfter,
            importBatchId: batchId,
            dedupeHash: r.dedupeHash,
            manual: undefined,
            manualEntry: { date: entry.date, description: entry.description },
            updatedAt: Date.now(),
          })
          continue
        }
        txs.push(
          makeRecord<Transaction>({
            accountId,
            date: r.date,
            postedDate: r.postedDate !== r.date ? r.postedDate : undefined,
            description: r.description,
            amount: r.amount,
            balanceAfter: r.balanceAfter,
            tags: [],
            importBatchId: batchId,
            dedupeHash: r.dedupeHash,
          }),
        )
      }
    }

    await db.transactions.bulkAdd(txs)
    await db.transactions.bulkPut(confirmed)
    const total = prep.sections.reduce((n, s) => n + s.rows.length, 0)
    const batch = makeRecord<ImportBatch>({
      id: batchId,
      accountIds,
      fileName: prep.fileName,
      fileHash: prep.fileHash,
      bank: prep.bank,
      periodFrom: prep.periodFrom,
      periodTo: prep.periodTo,
      importedAt: Date.now(),
      rowCount: txs.length,
      skippedDuplicates: total - txs.length - confirmed.length,
      matchedManual: confirmed.length,
    })
    await db.importBatches.add(batch)
    return batch
  })
}

/**
 * Undo an import: soft-deletes its transactions and the batch (so the undo also syncs).
 * Transactions you typed by hand that this import confirmed go back to what you typed.
 */
export async function undoImport(db: ExpensesDB, batchId: string): Promise<number> {
  const removed = await db.transaction('rw', db.transactions, db.importBatches, async () => {
    const now = Date.now()
    const txs = (await db.transactions.where('importBatchId').equals(batchId).toArray()).filter((t) => !t.deleted)
    await db.transactions.bulkPut(
      txs.map((t) =>
        t.manualEntry
          ? {
              ...t,
              ...t.manualEntry,
              postedDate: undefined,
              balanceAfter: undefined,
              importBatchId: undefined,
              dedupeHash: undefined,
              manual: true,
              manualEntry: undefined,
              updatedAt: now,
            }
          : { ...t, deleted: true, updatedAt: now },
      ),
    )
    const batch = await db.importBatches.get(batchId)
    if (batch) await db.importBatches.put({ ...batch, deleted: true, updatedAt: now })
    return txs.filter((t) => !t.manualEntry).length
  })
  // The other side of a transfer pair may now be unpaired.
  await recategorizeAll(db)
  return removed
}
