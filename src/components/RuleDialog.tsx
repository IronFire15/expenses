import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CategoryIcon } from '@/components/CategoryPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { db } from '@/db/db'
import { addRecord, listActive, softDelete } from '@/db/records'
import type { Rule, RuleOperator } from '@/db/types'
import { useLookups } from '@/hooks/useLookups'
import { formatDate } from '@/lib/dates'
import { formatSigned } from '@/lib/money'
import { cn } from '@/lib/utils'
import { deleteRule, matchRule, recategorizeAll, restoreRule } from '@/rules/engine'

export type RuleDraft = Pick<Rule, 'field' | 'operator' | 'pattern' | 'categoryId'> & Partial<Pick<Rule, 'direction' | 'accountId' | 'id'>>

const OPERATORS: { value: RuleOperator; label: string }[] = [
  { value: 'contains', label: 'Description contains' },
  { value: 'word', label: 'Description has the words' },
  { value: 'startsWith', label: 'Description starts with' },
  { value: 'equals', label: 'Description is exactly' },
  { value: 'regex', label: 'Description matches regex' },
  { value: 'between', label: 'Amount is between' },
]

const ANY = '__any__'

/** Euros text "-50..-10" ↔ cents "-5000..-1000" for amount rules. */
const centsToEuros = (p: string) => p.replace(/-?\d+/g, (n) => String(Number(n) / 100))
const eurosToCents = (p: string) => p.replace(/-?\d+(?:[.,]\d+)?/g, (n) => String(Math.round(Number(n.replace(',', '.')) * 100)))

/**
 * Create or edit a rule with a live preview of what it matches.
 * Saving re-runs categorization; transactions you categorized by hand are never changed.
 */
export function RuleDialog({ draft, onClose }: { draft: RuleDraft | null; onClose: () => void }) {
  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">{draft && <RuleForm key={draft.id ?? 'new'} draft={draft} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}

function RuleForm({ draft, onClose }: { draft: RuleDraft; onClose: () => void }) {
  const { categories, accounts, categoryById } = useLookups()
  const [operator, setOperator] = useState<RuleOperator>(draft.operator)
  const [pattern, setPattern] = useState(draft.operator === 'between' ? centsToEuros(draft.pattern) : draft.pattern)
  const [categoryId, setCategoryId] = useState(draft.categoryId)
  const [direction, setDirection] = useState(draft.direction ?? ANY)
  const [accountId, setAccountId] = useState(draft.accountId ?? ANY)
  const [saving, setSaving] = useState(false)

  const isAmount = operator === 'between'
  const rule: Rule = useMemo(
    () => ({
      id: draft.id ?? 'preview',
      updatedAt: 0,
      deleted: false,
      priority: 100,
      field: isAmount ? 'amount' : 'description',
      operator,
      pattern: isAmount ? eurosToCents(pattern) : pattern.trim(),
      categoryId,
      direction: direction === ANY ? undefined : (direction as Rule['direction']),
      accountId: accountId === ANY ? undefined : accountId,
    }),
    [draft.id, isAmount, operator, pattern, categoryId, direction, accountId],
  )

  const transactions = useLiveQuery(() => listActive(db.transactions)) ?? []
  const matches = pattern.trim() ? transactions.filter((t) => matchRule(rule, t)) : []
  const manual = matches.filter((t) => t.categorySource === 'manual').length

  const save = async () => {
    setSaving(true)
    try {
      const { id: _id, updatedAt: _u, deleted: _d, ...data } = rule
      if (draft.id) await softDelete(db.rules, draft.id) // edit = replace, so the newer rule wins everywhere
      await addRecord<Rule>(db.rules, data)
      const changed = await recategorizeAll(db)
      toast.success(draft.id ? 'Rule updated' : 'Rule created', {
        description: changed ? `${changed} transaction${changed === 1 ? '' : 's'} recategorized.` : undefined,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!draft.id) return
    const id = draft.id
    const changed = await deleteRule(db, id)
    toast.success('Rule deleted', {
      description: changed ? `${changed} transaction${changed === 1 ? '' : 's'} recategorized.` : undefined,
      action: { label: 'Undo', onClick: () => void restoreRule(db, id) },
    })
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{draft.id ? 'Edit rule' : 'New rule'}</DialogTitle>
        <DialogDescription>Matching transactions get this category automatically, now and on future imports.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="rule-op">When</Label>
          <Select value={operator} onValueChange={(v) => setOperator(v as RuleOperator)}>
            <SelectTrigger id="rule-op" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={isAmount ? 'Amount range in euros' : 'Text to match'}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={isAmount ? '-50..-10 (euros, negative = money out)' : 'e.g. together price'}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            {isAmount ? 'Leave one side empty for "at least" or "at most", e.g. 1000..' : 'Ignores upper/lower case and accents.'}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="rule-dir">Money</Label>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger id="rule-dir" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>In or out</SelectItem>
                <SelectItem value="out">Only money out</SelectItem>
                <SelectItem value="in">Only money in</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rule-acc">Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="rule-acc" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any account</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="rule-cat">Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="rule-cat" className="w-full">
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              {(['expense', 'income', 'transfer'] as const).map((type) => (
                <SelectGroup key={type}>
                  <SelectLabel>{type === 'expense' ? 'Expenses' : type === 'income' ? 'Income' : 'Not spending'}</SelectLabel>
                  {categories
                    .filter((c) => c.type === type)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <CategoryIcon category={c} size="sm" /> {c.name}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border bg-muted/40 p-3" aria-live="polite">
          <p className="text-sm font-medium">
            {pattern.trim() ? `Matches ${matches.length} transaction${matches.length === 1 ? '' : 's'}` : 'Type something to see matches'}
            {manual > 0 && <span className="font-normal text-muted-foreground"> · {manual} set by hand stay as they are</span>}
          </p>
          {matches.length > 0 && (
            <ul className="mt-2 space-y-1">
              {matches.slice(0, 4).map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 text-muted-foreground tabular-nums">{formatDate(t.date, { day: 'numeric', month: 'short' })}</span>
                  <span className="min-w-0 flex-1 truncate">{t.description}</span>
                  <span className={cn('tabular-nums', t.amount > 0 && 'text-positive')}>{formatSigned(t.amount)}</span>
                </li>
              ))}
              {matches.length > 4 && <li className="text-xs text-muted-foreground">and {matches.length - 4} more</li>}
            </ul>
          )}
        </div>
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {draft.id ? (
          <Button variant="destructive" onClick={remove}>
            Delete rule
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !pattern.trim() || !categoryById.has(categoryId)}>
            {draft.id ? 'Save rule' : 'Create rule'}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
