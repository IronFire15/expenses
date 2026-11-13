import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page'
import { db } from '@/db/db'
import { undoImport } from '@/import/importer'
import { EASE_OUT } from '@/lib/motion'
import { Dropzone } from './Dropzone'
import { ImportHistory } from './ImportHistory'
import { ReviewPanel } from './ReviewPanel'
import { useImportQueue } from './useImportQueue'

const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
}

export function ImportPage() {
  const queue = useImportQueue()
  const reviewing = queue.items.length > 0

  const handleImport = async () => {
    try {
      const batches = await queue.commit()
      const added = batches.reduce((n, b) => n + b.rowCount, 0)
      const matched = batches.reduce((n, b) => n + (b.matchedManual ?? 0), 0)
      toast.success(`${added} transaction${added === 1 ? '' : 's'} imported`, {
        description: `From ${batches.length} file${batches.length === 1 ? '' : 's'}.${matched ? ` ${matched} matched what you typed by hand (not added twice).` : ''}`,
        action: {
          label: 'Undo',
          onClick: async () => {
            for (const b of batches) await undoImport(db, b.id)
            toast('Import undone')
          },
        },
      })
    } catch (err) {
      toast.error('Import failed. Nothing was saved.', { description: err instanceof Error ? err.message : undefined })
    }
  }

  return (
    <>
      <PageHeader title="Import" description="Add statements from your bank. Everything stays on this device." />

      <AnimatePresence mode="wait" initial={false}>
        {reviewing ? (
          <motion.div key="review" {...swap} className="space-y-4">
            <Dropzone compact onFiles={queue.addFiles} />
            <ReviewPanel
              items={queue.items}
              ready={queue.ready}
              onRemove={queue.remove}
              onCancel={queue.clear}
              onImport={handleImport}
              committing={queue.committing}
              busy={queue.busy}
            />
          </motion.div>
        ) : (
          <motion.div key="drop" {...swap}>
            <Dropzone onFiles={queue.addFiles} />
          </motion.div>
        )}
      </AnimatePresence>

      <ImportHistory />
    </>
  )
}
