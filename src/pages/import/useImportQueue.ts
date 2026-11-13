import { useCallback, useMemo, useState } from 'react'
import { db } from '@/db/db'
import type { ImportBatch } from '@/db/types'
import { commitImport, markCrossFileDuplicates, prepareImport, sha256, type PreparedImport } from '@/import/importer'
import { parseStatementText } from '@/import/parsers'
import { extractPdfText } from '@/import/pdf'
import { recategorizeAll } from '@/rules/engine'

export type QueueItem =
  | { id: string; fileName: string; status: 'reading' }
  | { id: string; fileName: string; status: 'ready'; prep: PreparedImport }
  | { id: string; fileName: string; status: 'error'; error: string }

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'PasswordException') return 'This PDF is password-protected. Export it again without a password.'
    if (err.name === 'InvalidPDFException') return 'This file is not a valid PDF.'
    return err.message
  }
  return 'Something went wrong reading this file.'
}

async function processFile(file: File): Promise<PreparedImport> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) throw new Error('Only PDF statements are supported right now. CSV and Excel come with your next bank.')
  const data = await file.arrayBuffer()
  const hash = await sha256(data)
  const stmt = parseStatementText(await extractPdfText(data))
  return prepareImport(db, stmt, file.name, hash)
}

/** Files waiting for review. Parsing happens immediately; nothing is saved until `commit()`. */
export function useImportQueue() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [committing, setCommitting] = useState(false)

  const update = (id: string, next: QueueItem) => setItems((prev) => prev.map((i) => (i.id === id ? next : i)))

  const addFiles = useCallback((files: File[]) => {
    const added = files.map((file) => ({ file, item: { id: crypto.randomUUID(), fileName: file.name, status: 'reading' as const } }))
    setItems((prev) => [...prev, ...added.map((a) => a.item)])
    for (const { file, item } of added) {
      processFile(file)
        .then((prep) => update(item.id, { ...item, status: 'ready', prep }))
        .catch((err) => update(item.id, { ...item, status: 'error', error: errorMessage(err) }))
    }
  }, [])

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((i) => i.id !== id)), [])
  const clear = useCallback(() => setItems([]), [])

  /** Ready items with duplicates across the selected files already marked. */
  const ready = useMemo(() => {
    const readyItems = items.filter((i): i is Extract<QueueItem, { status: 'ready' }> => i.status === 'ready')
    const marked = markCrossFileDuplicates(readyItems.map((i) => i.prep))
    return readyItems.map((item, idx) => ({ ...item, prep: marked[idx] }))
  }, [items])

  const commit = useCallback(async (): Promise<ImportBatch[]> => {
    setCommitting(true)
    try {
      const ordered = [...ready].sort((a, b) => (a.prep.periodFrom ?? '').localeCompare(b.prep.periodFrom ?? ''))
      const batches: ImportBatch[] = []
      for (const item of ordered) {
        if (item.prep.newCount + item.prep.matchedCount === 0) continue
        batches.push(await commitImport(db, item.prep))
      }
      // New rows may complete a transfer pair with older rows, so re-run over everything.
      await recategorizeAll(db)
      setItems([])
      return batches
    } finally {
      setCommitting(false)
    }
  }, [ready])

  const busy = items.some((i) => i.status === 'reading')
  return { items, ready, addFiles, remove, clear, commit, committing, busy }
}
