import { useLiveQuery } from 'dexie-react-hooks'
import { Landmark, PenLine, Plus, Split, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { CategoryIcon, CategoryPicker } from '@/components/CategoryPicker'
import { TagPicker, TagPill } from '@/components/TagPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/db/db'
import { updateRecord } from '@/db/records'
import type { Transaction } from '@/db/types'
import { useLookups } from '@/hooks/useLookups'
import { formatDate } from '@/lib/dates'
import { centsToInput, formatMoney, formatSigned, parseTypedAmount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { splitParts, splitTransaction, unsplitTransaction, validateSplit } from '@/transactions/split'
import { deleteTransaction, restoreTransactions } from '@/transactions/manual'
import { addTag, removeTag } from '@/transactions/tags'

/**
 * Details of one transaction: category, tags, notes and splitting.
 * For a split part, the split section edits the original's split.
 */
export function TransactionDialog({
  id,
  allTags,
  onClose,
  onCategorize,
  onEdit,
}: {
  id: string | null
  allTags: string[]
  onClose: () => void
  onCategorize: (ids: string[], categoryId: string) => void
  /** Open the edit form for a transaction typed by hand. */
  onEdit: (tx: Transaction) => void
}) {
  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {id && <Details key={id} id={id} allTags={allTags} onCategorize={onCategorize} onClose={onClose} onEdit={onEdit} />}
      </DialogContent>
    </Dialog>
  )
}

function Details({
  id,
  allTags,
  onCategorize,
  onClose,
  onEdit,
}: {
  id: string
  allTags: string[]
  onCategorize: (ids: string[], categoryId: string) => void
  onClose: () => void
  onEdit: (tx: Transaction) => void
}) {
  const tx = useLiveQuery(() => db.transactions.get(id), [id])
  const parentId = tx?.splitOf ?? (tx?.split ? tx.id : undefined)
  const parent = useLiveQuery(async () => (parentId ? db.transactions.get(parentId) : undefined), [parentId])
  const parts = useLiveQuery(async () => (parentId ? splitParts(db, parentId) : []), [parentId]) ?? []
  const { categories, categoryById, accountById, accounts } = useLookups()
  const [editingSplit, setEditingSplit] = useState(false)

  if (!tx) return null
  if (tx.deleted) {
    // The split was changed or undone while this was open.
    return (
      <DialogHeader>
        <DialogTitle>This transaction changed</DialogTitle>
        <DialogDescription>It was replaced by a new split or the split was undone. Close and open it again from the list.</DialogDescription>
      </DialogHeader>
    )
  }

  const category = categoryById.get(tx.categoryId ?? '')
  const account = accountById.get(tx.accountId)
  const original = parent ?? tx

  if (editingSplit) return <SplitEditor parent={original} existing={parts} onDone={() => setEditingSplit(false)} onSaved={onClose} />

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6 break-words">{tx.description}</DialogTitle>
        <DialogDescription>
          {formatDate(tx.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          {accounts.length > 1 && account && ` · ${account.name}`}
        </DialogDescription>
      </DialogHeader>

      <p className={cn('text-3xl font-semibold tracking-tight tabular-nums', tx.amount > 0 && 'text-positive')}>{formatSigned(tx.amount)}</p>

      {original.manual && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 p-3">
          <PenLine className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            Typed by you. Your next bank import matches it (same account and amount, close date) instead of adding it twice.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onEdit(original)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const ids = await deleteTransaction(db, original.id)
                onClose()
                toast('Transaction deleted', { action: { label: 'Undo', onClick: () => void restoreTransactions(db, ids) } })
              }}
            >
              <Trash2 aria-hidden /> Delete
            </Button>
          </div>
        </div>
      )}
      {original.manualEntry && (
        <p className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
          <Landmark className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            You typed this as “{original.manualEntry.description}” on {formatDate(original.manualEntry.date)}. A bank import confirmed it.
          </span>
        </p>
      )}

      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Category</h3>
          <CategoryPicker categories={categories} value={tx.categoryId} onChange={(c) => onCategorize([tx.id], c)}>
            <Button variant="outline" className="w-full justify-start">
              <CategoryIcon category={category} size="sm" />
              {category?.name ?? <span className="text-warning">Uncategorized</span>}
            </Button>
          </CategoryPicker>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Tags</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {tx.tags.map((t) => (
              <TagPill key={t} tag={t} onRemove={() => void removeTag(db, [tx.id], t)} />
            ))}
            <TagPicker tags={allTags} exclude={tx.tags} onPick={(t) => void addTag(db, [tx.id], t, allTags)}>
              <Button variant="ghost" size="sm">
                <Plus aria-hidden /> Add tag
              </Button>
            </TagPicker>
          </div>
          {tx.tags.length === 0 && <p className="text-xs text-muted-foreground">Group transactions across categories, e.g. “Vacation 2026”.</p>}
        </section>

        <section className="space-y-2">
          <Label htmlFor="tx-notes">Notes</Label>
          <Textarea
            id="tx-notes"
            defaultValue={tx.notes ?? ''}
            placeholder="Anything to remember about this payment"
            rows={2}
            onBlur={(e) => {
              const notes = e.target.value.trim() || undefined
              if (notes !== tx.notes) void updateRecord(db.transactions, tx.id, { notes })
            }}
          />
        </section>

        <section className="space-y-2 rounded-xl border p-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Split className="size-4 text-muted-foreground" aria-hidden /> Split
          </h3>
          {parent && parts.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                {tx.splitOf ? 'This is one part of' : 'Split into parts:'} {formatMoney(Math.abs(original.amount))} on {formatDate(original.date)}.
              </p>
              <ul className="space-y-1">
                {parts.map((p) => (
                  <li key={p.id} className={cn('flex items-center gap-2 rounded-lg px-2 py-1 text-sm', p.id === tx.id && 'bg-brand-soft/60')}>
                    <CategoryIcon category={categoryById.get(p.categoryId ?? '')} size="sm" />
                    <span className="min-w-0 flex-1 truncate">
                      {categoryById.get(p.categoryId ?? '')?.name ?? 'Uncategorized'}
                      {p.notes && <span className="text-muted-foreground"> · {p.notes}</span>}
                    </span>
                    <span className="tabular-nums">{formatMoney(Math.abs(p.amount))}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setEditingSplit(true)}>
                  Edit split
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await unsplitTransaction(db, original.id)
                    toast('Split undone', { description: 'Back to one transaction, categorized by your rules.' })
                    onClose()
                  }}
                >
                  <Undo2 aria-hidden /> Undo split
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">One payment, several categories? E.g. a supermarket receipt that was groceries and household items.</p>
              <Button variant="outline" size="sm" onClick={() => setEditingSplit(true)}>
                Split this transaction
              </Button>
            </>
          )}
        </section>
      </div>
    </>
  )
}

interface Row {
  key: string
  amount: string
  categoryId: string
  notes: string
}

let rowKey = 0
const newRow = (amount = '', categoryId = '', notes = ''): Row => ({ key: String(++rowKey), amount, categoryId, notes })

function SplitEditor({ parent, existing, onDone, onSaved }: { parent: Transaction; existing: Transaction[]; onDone: () => void; onSaved: () => void }) {
  const { categories, categoryById } = useLookups()
  const sign = Math.sign(parent.amount) || -1
  const total = Math.abs(parent.amount)
  const [rows, setRows] = useState<Row[]>(() =>
    existing.length
      ? existing.map((p) => newRow(centsToInput(p.amount), p.categoryId ?? '', p.notes ?? ''))
      : [newRow(centsToInput(total), parent.categoryId ?? ''), newRow()],
  )
  const [saving, setSaving] = useState(false)

  const amounts = rows.map((r) => parseTypedAmount(r.amount))
  const assigned = amounts.reduce<number>((s, a) => s + (a ?? 0), 0)
  const left = total - assigned
  const parts = rows.map((r, i) => ({ amount: (amounts[i] ?? 0) * sign, categoryId: r.categoryId, notes: r.notes }))
  const problems = validateSplit(parent, parts)

  const set = (key: string, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)))

  /** Typing in a part takes the amount from the first part, so the total keeps adding up. */
  const setAmount = (key: string, value: string) =>
    setRows((rs) => {
      const next = rs.map((r) => (r.key === key ? { ...r, amount: value } : r))
      if (next[0].key === key) return next
      const others = next.slice(1).reduce((s, r) => s + (parseTypedAmount(r.amount) ?? 0), 0)
      return total - others > 0 ? [{ ...next[0], amount: centsToInput(total - others) }, ...next.slice(1)] : next
    })

  const save = async () => {
    setSaving(true)
    try {
      await splitTransaction(db, parent.id, parts)
      toast.success(`Split into ${parts.length} parts`)
      onSaved()
    } catch (err) {
      toast.error('Couldn’t save the split', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Split {formatMoney(total)}</DialogTitle>
        <DialogDescription className="break-words">
          {parent.description} · {formatDate(parent.date)}
        </DialogDescription>
      </DialogHeader>

      <ul className="space-y-3">
        {rows.map((r, i) => {
          const cat = categoryById.get(r.categoryId)
          return (
            <li key={r.key} className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <CategoryPicker categories={categories} value={r.categoryId} onChange={(c) => set(r.key, { categoryId: c })}>
                  <Button variant="outline" className="min-w-0 flex-1 justify-start" aria-label={`Part ${i + 1} category: ${cat?.name ?? 'none'}`}>
                    <CategoryIcon category={cat} size="sm" />
                    <span className="truncate">{cat?.name ?? 'Choose category'}</span>
                  </Button>
                </CategoryPicker>
                <div className="relative w-28 shrink-0">
                  <Input
                    inputMode="decimal"
                    aria-label={`Part ${i + 1} amount in euros`}
                    value={r.amount}
                    onChange={(e) => setAmount(r.key, e.target.value)}
                    aria-invalid={r.amount !== '' && amounts[i] === null}
                    className="pr-6 text-right tabular-nums"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
                    €
                  </span>
                </div>
                {rows.length > 2 && (
                  <Button variant="ghost" size="icon" aria-label={`Remove part ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
              <Input placeholder="Note (optional)" aria-label={`Part ${i + 1} note`} value={r.notes} onChange={(e) => set(r.key, { notes: e.target.value })} />
            </li>
          )
        })}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, newRow(left > 0 ? centsToInput(left) : '')])}>
          <Plus aria-hidden /> Add part
        </Button>
        <p className={cn('text-sm tabular-nums', left === 0 ? 'text-muted-foreground' : 'font-medium text-warning')} aria-live="polite">
          {left === 0 ? 'Adds up' : left > 0 ? `${formatMoney(left)} left to assign` : `${formatMoney(-left)} too much`}
        </p>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={saving || problems.length > 0} title={problems[0]}>
          Save split
        </Button>
      </DialogFooter>
    </>
  )
}
