import { AlertTriangle, CheckCircle2, FileText, Loader2, X, XCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Surface } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { PreparedImport } from '@/import/importer'
import { formatDate, formatPeriod, formatRelative } from '@/lib/dates'
import { formatSigned } from '@/lib/money'
import { EASE_OUT } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { QueueItem } from './useImportQueue'

const listItem = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.3, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.15 } },
}

function FileCard({ item, prep, onRemove }: { item: QueueItem; prep?: PreparedImport; onRemove: () => void }) {
  const [showProblems, setShowProblems] = useState(false)
  const problems = prep?.sections.flatMap((s) => s.problems.map((p) => `${s.name}: ${p}`)) ?? []
  const balanceOk = prep?.sections.every((s) => s.balanceOk)

  return (
    <Surface className="p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-lg',
            item.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-brand-soft text-primary',
          )}
        >
          {item.status === 'reading' ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : item.status === 'error' ? (
            <XCircle className="size-5" aria-hidden />
          ) : (
            <FileText className="size-5" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.fileName}</p>
          {item.status === 'reading' && <p className="text-sm text-muted-foreground">Reading statement…</p>}
          {item.status === 'error' && <p className="text-sm text-destructive">{item.error}</p>}
          {prep && (
            <>
              <p className="text-sm text-muted-foreground">
                {formatPeriod(prep.periodFrom, prep.periodTo)} · {prep.bank}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Badge className={prep.newCount ? 'bg-brand-soft text-primary' : 'bg-muted text-muted-foreground'}>
                  {prep.newCount} new
                </Badge>
                {prep.matchedCount > 0 && <Badge variant="secondary">{prep.matchedCount} match what you typed</Badge>}
                {prep.duplicateCount > 0 && <Badge variant="secondary">{prep.duplicateCount} already imported</Badge>}
                {balanceOk ? (
                  <Badge variant="secondary" className="text-positive">
                    <CheckCircle2 aria-hidden /> Balances match
                  </Badge>
                ) : (
                  <button type="button" onClick={() => setShowProblems((v) => !v)} aria-expanded={showProblems}>
                    <Badge className="bg-warning/15 text-warning">
                      <AlertTriangle aria-hidden /> Balance check failed
                    </Badge>
                  </button>
                )}
              </div>
              {prep.previouslyImportedAt && (
                <p className="mt-2 text-xs text-muted-foreground">
                  You imported this exact file {formatRelative(prep.previouslyImportedAt)}.
                </p>
              )}
              <AnimatePresence initial={false}>
                {showProblems && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-2 list-disc space-y-1 overflow-hidden pl-4 text-xs text-muted-foreground"
                  >
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </>
          )}
        </div>

        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${item.fileName}`}>
          <X aria-hidden />
        </Button>
      </div>
    </Surface>
  )
}

const PREVIEW_LIMIT = 15

function PreviewTable({ preps }: { preps: PreparedImport[] }) {
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const rows = useMemo(
    () =>
      preps
        .flatMap((p) => p.sections.flatMap((s) => s.rows.map((r) => ({ ...r, account: s.name }))))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [preps],
  )
  const duplicates = rows.filter((r) => r.duplicate).length
  const visible = rows.filter((r) => showDuplicates || !r.duplicate)
  const shown = showAll ? visible : visible.slice(0, PREVIEW_LIMIT)

  if (rows.length === 0) return null

  return (
    <Surface className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Preview</h3>
        {duplicates > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowDuplicates((v) => !v)}>
            {showDuplicates ? 'Hide' : 'Show'} {duplicates} already imported
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="hidden w-28 pl-4 sm:table-cell">Date</TableHead>
            <TableHead className="pl-4 sm:pl-2">Description</TableHead>
            <TableHead className="hidden md:table-cell">Account</TableHead>
            <TableHead className="pr-4 text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.dedupeHash} className={cn(r.duplicate && 'opacity-50')}>
              <TableCell className="hidden pl-4 text-muted-foreground tabular-nums sm:table-cell">{formatDate(r.date)}</TableCell>
              <TableCell className="max-w-0 pl-4 sm:pl-2">
                <p className="truncate">{r.description}</p>
                <p className="text-xs text-muted-foreground sm:hidden">{formatDate(r.date)}</p>
                {r.duplicate && <p className="text-xs text-muted-foreground">Already imported</p>}
                {!r.duplicate && r.matchesManual && (
                  <p className="truncate text-xs text-muted-foreground">Matches what you typed: “{r.manualDescription}”</p>
                )}
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{r.account}</TableCell>
              <TableCell className={cn('pr-4 text-right font-medium tabular-nums', r.amount > 0 && 'text-positive')}>
                {formatSigned(r.amount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {visible.length > PREVIEW_LIMIT && (
        <div className="border-t px-4 py-2 text-center">
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show less' : `Show all ${visible.length}`}
          </Button>
        </div>
      )}
    </Surface>
  )
}

export function ReviewPanel({
  items,
  ready,
  onRemove,
  onCancel,
  onImport,
  committing,
  busy,
}: {
  items: QueueItem[]
  ready: { id: string; prep: PreparedImport }[]
  onRemove: (id: string) => void
  onCancel: () => void
  onImport: () => void
  committing: boolean
  busy: boolean
}) {
  const preps = ready.map((r) => r.prep)
  const prepById = new Map(ready.map((r) => [r.id, r.prep]))
  const newCount = preps.reduce((n, p) => n + p.newCount, 0)
  const matchedCount = preps.reduce((n, p) => n + p.matchedCount, 0)
  const duplicateCount = preps.reduce((n, p) => n + p.duplicateCount, 0)

  return (
    <div className="space-y-4">
      <motion.ul layout className="grid gap-3 md:grid-cols-2">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item) => (
            <motion.li key={item.id} layout variants={listItem} initial="initial" animate="animate" exit="exit">
              <FileCard item={item} prep={prepById.get(item.id)} onRemove={() => onRemove(item.id)} />
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>

      <PreviewTable preps={preps} />

      {/* Sticky action bar: sits above the mobile tab bar. */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 md:bottom-4">
        <Surface className="flex flex-wrap items-center justify-between gap-3 bg-card/90 p-3 pl-4 backdrop-blur-lg">
          <p className="text-sm" aria-live="polite">
            {busy ? (
              'Reading files…'
            ) : (
              <>
                <span className="font-semibold tabular-nums">{newCount}</span> new transaction{newCount === 1 ? '' : 's'}
                {matchedCount > 0 && <span className="text-muted-foreground"> · {matchedCount} matched</span>}
                {duplicateCount > 0 && <span className="text-muted-foreground"> · {duplicateCount} skipped</span>}
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={committing}>
              Cancel
            </Button>
            <Button onClick={onImport} disabled={busy || committing || newCount + matchedCount === 0}>
              {committing && <Loader2 className="animate-spin" aria-hidden />}
              Import {newCount > 0 ? newCount : ''}
            </Button>
          </div>
        </Surface>
      </div>
    </div>
  )
}
