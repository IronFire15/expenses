import { useLiveQuery } from 'dexie-react-hooks'
import { FileText, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Surface } from '@/components/page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { db } from '@/db/db'
import type { ImportBatch } from '@/db/types'
import { undoImport } from '@/import/importer'
import { formatPeriod, formatRelative } from '@/lib/dates'

export function ImportHistory() {
  const batches = useLiveQuery(async () =>
    (await db.importBatches.orderBy('importedAt').reverse().toArray()).filter((b) => !b.deleted),
  )
  const [confirm, setConfirm] = useState<ImportBatch | null>(null)

  if (!batches?.length) return null

  const undo = async (batch: ImportBatch) => {
    const n = await undoImport(db, batch.id)
    toast.success(`Removed ${n} transaction${n === 1 ? '' : 's'} from ${batch.fileName}`)
  }

  return (
    <section aria-labelledby="history-title" className="mt-10">
      <h2 id="history-title" className="mb-3 flex items-baseline gap-2 text-sm font-semibold">
        Import history <span className="font-normal text-muted-foreground tabular-nums">{batches.length}</span>
      </h2>
      <Surface>
        <ul className="divide-y">
          <AnimatePresence initial={false}>
            {batches.map((b) => (
              <motion.li
                key={b.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {formatPeriod(b.periodFrom, b.periodTo)}
                      <span className="font-normal text-muted-foreground"> · {b.fileName}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {b.rowCount} added{!!b.matchedManual && ` · ${b.matchedManual} matched`}{b.skippedDuplicates > 0 && ` · ${b.skippedDuplicates} skipped`} · {formatRelative(b.importedAt)}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setConfirm(b)}>
                    <Undo2 aria-hidden /> Undo
                  </Button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Surface>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this import?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the {confirm?.rowCount} transactions added from {confirm?.fileName}. You can import the file again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirm) void undo(confirm)
                setConfirm(null)
              }}
            >
              Undo import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
