import { Check, Plus, Sparkles } from 'lucide-react'
import { createElement, useState } from 'react'
import { toast } from 'sonner'
import { CategoryIcon } from '@/components/CategoryPicker'
import type { RuleDraft } from '@/components/RuleDialog'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { db } from '@/db/db'
import { addRecord, updateRecord } from '@/db/records'
import type { Category, CategoryType, Rule } from '@/db/types'
import { CATEGORY_ICONS } from '@/lib/categoryIcons'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { recategorizeAll } from '@/rules/engine'

export const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981', '#14b8a6', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#a16207', '#64748b',
]

const OPERATOR_LABEL: Record<Rule['operator'], string> = {
  contains: 'contains',
  word: 'has words',
  startsWith: 'starts with',
  equals: 'is',
  regex: 'regex',
  between: 'amount',
}

export function ruleSummary(r: Rule): string {
  if (r.operator === 'between') {
    const [a, b] = r.pattern.split('..')
    const e = (c: string) => (c ? formatMoney(Number(c)) : '…')
    return `Amount ${e(a)} to ${e(b)}`
  }
  const dir = r.direction === 'in' ? ' (money in)' : r.direction === 'out' ? ' (money out)' : ''
  return `${OPERATOR_LABEL[r.operator]} “${r.pattern}”${dir}`
}

export type CategoryDraft = Partial<Category> & { stats?: { count: number; rules: Rule[] } }

/** Create or edit a category, see its rules, delete it. */
export function CategoryDialog({
  draft,
  onClose,
  onEditRule,
}: {
  draft: CategoryDraft | null
  onClose: () => void
  onEditRule: (draft: RuleDraft) => void
}) {
  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {draft && <CategoryForm key={draft.id ?? 'new'} draft={draft} onClose={onClose} onEditRule={onEditRule} />}
      </DialogContent>
    </Dialog>
  )
}

function CategoryForm({ draft, onClose, onEditRule }: { draft: CategoryDraft; onClose: () => void; onEditRule: (d: RuleDraft) => void }) {
  const [name, setName] = useState(draft.name ?? '')
  const [type, setType] = useState<CategoryType>(draft.type ?? 'expense')
  const [color, setColor] = useState(draft.color ?? COLORS[7])
  const [icon, setIcon] = useState(draft.icon ?? 'circle-help')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const rules = draft.stats?.rules ?? []
  const preview = { id: 'preview', name, type, color, icon, updatedAt: 0, deleted: false }

  const save = async () => {
    const data = { name: name.trim(), type, color, icon }
    if (draft.id) await updateRecord(db.categories, draft.id, data)
    else await addRecord<Category>(db.categories, data)
    toast.success(draft.id ? 'Category saved' : `Category “${data.name}” created`)
    onClose()
  }

  const remove = async () => {
    if (!draft.id) return
    const id = draft.id
    await db.transaction('rw', db.categories, db.rules, db.transactions, async () => {
      const now = Date.now()
      await updateRecord(db.categories, id, { deleted: true })
      const rules = await db.rules.where('categoryId').equals(id).toArray()
      await db.rules.bulkPut(rules.map((r) => ({ ...r, deleted: true, updatedAt: now })))
      // Hand-picked transactions go back to the rules (or uncategorized).
      const txs = await db.transactions.where('categoryId').equals(id).toArray()
      await db.transactions.bulkPut(txs.map((t) => ({ ...t, categoryId: undefined, categorySource: undefined, ruleId: undefined, updatedAt: now })))
    })
    await recategorizeAll(db)
    toast.success(`Deleted “${draft.name}”`)
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <CategoryIcon category={preview} />
          {draft.id ? 'Edit category' : 'New category'}
        </DialogTitle>
        <DialogDescription>
          {draft.stats ? `${draft.stats.count} transaction${draft.stats.count === 1 ? '' : 's'} in this category.` : 'Pick a name, color and icon.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
          <div className="grid gap-2">
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!draft.id} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cat-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CategoryType)}>
              <SelectTrigger id="cat-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="transfer">Not spending</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {type === 'transfer' && (
          <p className="-mt-3 text-xs text-muted-foreground">Left out of spending and income totals (transfers, savings, investments).</p>
        )}

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Color</legend>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                className="grid size-8 place-items-center rounded-full outline-none ring-offset-2 ring-offset-background transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-90 pointer-coarse:size-10"
                style={{ backgroundColor: c }}
              >
                {color === c && <Check className="size-4 text-white" aria-hidden />}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Icon</legend>
          <div className="grid grid-cols-8 gap-1.5">
            {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setIcon(key)}
                aria-label={key.replace(/-/g, ' ')}
                aria-pressed={icon === key}
                className={cn(
                  'grid aspect-square place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  icon === key ? 'text-white' : 'text-muted-foreground hover:bg-muted',
                )}
                style={icon === key ? { backgroundColor: color } : undefined}
              >
                {createElement(Icon, { className: 'size-4', 'aria-hidden': true })}
              </button>
            ))}
          </div>
        </fieldset>

        {draft.id && (
          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Rules</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEditRule({ field: 'description', operator: 'contains', pattern: '', categoryId: draft.id! })}
              >
                <Plus aria-hidden /> Add rule
              </Button>
            </div>
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rules yet. Transactions only land here when you pick it.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {rules.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => onEditRule(r)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                    >
                      <span className="min-w-0 flex-1 truncate">{ruleSummary(r)}</span>
                      {r.builtin && (
                        <Badge variant="secondary" className="shrink-0">
                          <Sparkles aria-hidden /> Built-in
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {draft.id ? (
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim()}>
            {draft.id ? 'Save' : 'Create'}
          </Button>
        </div>
      </DialogFooter>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{draft.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {rules.length} rule{rules.length === 1 ? '' : 's'} are deleted too. Its {draft.stats?.count ?? 0} transactions go back to automatic
              categorization, or stay uncategorized if no other rule matches.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
