import { Download, FileSpreadsheet, FileUp, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { db } from '@/db/db'
import { listActive } from '@/db/records'
import { exportTransactions, transactionTable, type ExportFormat } from '@/export/export'
import { recategorizeAll } from '@/rules/engine'
import { applySnapshot, exportSnapshot, isSnapshot } from '@/sync/snapshot'

/** Manual backup, independent of Google Drive: a plain JSON file you keep yourself. */
export function BackupCard() {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const download = async () => {
    const snap = await exportSnapshot(db)
    const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    const count = snap.tables.transactions.filter((t) => !t.deleted).length
    toast.success('Backup downloaded', { description: `${count} transactions, plus categories, rules and accounts.` })
  }

  const exportAll = async (format: ExportFormat) => {
    const [txs, categories, accounts] = await Promise.all([listActive(db.transactions), listActive(db.categories), listActive(db.accounts)])
    const table = transactionTable(txs, new Map(categories.map((c) => [c.id, c])), new Map(accounts.map((a) => [a.id, a])))
    exportTransactions(table, format, `expenses-all-${new Date().toISOString().slice(0, 10)}`)
    toast.success(`Exported ${table.rows.length} transactions`)
  }

  const restore = async (file: File) => {
    setBusy(true)
    try {
      const data: unknown = JSON.parse(await file.text())
      if (!isSnapshot(data)) throw new Error('This file is not an Expenses backup.')
      const changed = await applySnapshot(db, data)
      if (changed) await recategorizeAll(db)
      toast.success(changed ? `Restored ${changed} records` : 'Nothing to restore', {
        description: changed ? 'Merged with your current data; newer versions were kept.' : 'Everything in the file is already here.',
      })
    } catch (err) {
      toast.error('Restore failed. Nothing was changed.', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A copy of everything in one file, for safekeeping or moving to another device without Drive. The file is not encrypted: store it somewhere private.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void download()}>
          <Download aria-hidden /> Download backup
        </Button>
        <Button variant="ghost" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <FileUp aria-hidden />} Restore from file
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void restore(f)
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">Restoring merges with what’s already here: for each item, the newer version wins.</p>
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm text-muted-foreground">All transactions as a spreadsheet, to analyse elsewhere. Split payments appear as their parts.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void exportAll('xlsx')}>
            <FileSpreadsheet aria-hidden /> Excel (.xlsx)
          </Button>
          <Button variant="ghost" onClick={() => void exportAll('csv')}>
            <FileSpreadsheet aria-hidden /> CSV
          </Button>
        </div>
      </div>
    </div>
  )
}
