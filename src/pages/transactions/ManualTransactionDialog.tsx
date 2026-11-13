import { useState } from 'react'
import { toast } from 'sonner'
import { CategoryIcon, CategoryPicker } from '@/components/CategoryPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/db/db'
import type { Transaction } from '@/db/types'
import { useLookups } from '@/hooks/useLookups'
import { centsToInput, parseTypedAmount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { MATCH_WINDOW_DAYS } from '@/import/manualMatch'
import { addManualTransaction, ensureCashAccount, updateManualTransaction } from '@/transactions/manual'

/** `{}` = new transaction; a transaction = edit it (only ones typed by hand). */
export type ManualDraft = Partial<Transaction>

const NEW_CASH = '__cash__'
const LAST_ACCOUNT_KEY = 'expenses:lastManualAccount'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function lastAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY)
  } catch {
    return null
  }
}

/** Type in a transaction by hand, e.g. right after paying. A later bank import confirms it instead of adding a duplicate. */
export function ManualTransactionDialog({ draft, onClose }: { draft: ManualDraft | null; onClose: () => void }) {
  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">{draft && <Form key={draft.id ?? 'new'} draft={draft} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}

function Form({ draft, onClose }: { draft: ManualDraft; onClose: () => void }) {
  const { categories, categoryById, accounts } = useLookups()
  const editing = !!draft.id
  const hasCash = accounts.some((a) => a.type === 'cash')
  const defaultAccount =
    draft.accountId ??
    accounts.find((a) => a.id === lastAccount())?.id ??
    accounts.find((a) => a.type === 'bank')?.id ??
    accounts[0]?.id ??
    NEW_CASH

  const [direction, setDirection] = useState<'out' | 'in'>(draft.amount !== undefined && draft.amount > 0 ? 'in' : 'out')
  const [amount, setAmount] = useState(draft.amount !== undefined ? centsToInput(draft.amount) : '')
  const [description, setDescription] = useState(draft.description ?? '')
  const [date, setDate] = useState(draft.date ?? today())
  // Accounts load a moment after the form opens, so the default is worked out on every render until you pick one.
  const [pickedAccount, setAccountId] = useState<string | null>(null)
  const accountId = pickedAccount ?? defaultAccount
  const [categoryId, setCategoryId] = useState(draft.categorySource === 'manual' ? (draft.categoryId ?? '') : '')
  const [notes, setNotes] = useState(draft.notes ?? '')
  const [saving, setSaving] = useState(false)

  const cents = parseTypedAmount(amount)
  const category = categoryById.get(categoryId)
  const valid = !!cents && !!description.trim() && /^\d{4}-\d{2}-\d{2}$/.test(date)

  const save = async () => {
    if (!valid) return
    setSaving(true)
    try {
      const account = accountId === NEW_CASH ? await ensureCashAccount(db) : accountId
      const input = {
        accountId: account,
        date,
        description,
        amount: direction === 'out' ? -cents! : cents!,
        categoryId: categoryId || undefined,
        notes,
      }
      if (editing) await updateManualTransaction(db, draft.id!, input)
      else await addManualTransaction(db, input)
      try {
        localStorage.setItem(LAST_ACCOUNT_KEY, account)
      } catch {
        // Only a convenience.
      }
      toast.success(editing ? 'Transaction saved' : 'Transaction added', {
        description: editing ? undefined : 'When your bank statement comes in, the import matches it instead of adding it twice.',
      })
      onClose()
    } catch (err) {
      toast.error('Couldn’t save', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit transaction' : 'Add transaction'}</DialogTitle>
        <DialogDescription>
          Typed by hand. A bank import later finds it by account, amount and date (up to {MATCH_WINDOW_DAYS} days apart) and fills in the bank’s details.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <span className="text-sm font-medium" id="manual-dir">
            Money
          </span>
          <div role="radiogroup" aria-labelledby="manual-dir" className="inline-flex w-fit rounded-lg bg-muted p-0.5">
            {(['out', 'in'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                onClick={() => setDirection(d)}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11',
                  direction === d ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {d === 'out' ? 'Money out' : 'Money in'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <div className="grid gap-2">
            <Label htmlFor="manual-desc">Description</Label>
            <Input id="manual-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Lunch at Zé" autoFocus={!editing} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="manual-amount">Amount</Label>
            <div className="relative">
              <Input
                id="manual-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                aria-invalid={amount !== '' && !cents}
                className="pr-6 text-right tabular-nums"
              />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
                €
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="manual-date">Date</Label>
            <Input id="manual-date" type="date" value={date} max="2100-12-31" onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="manual-account">Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="manual-account" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
                {!hasCash && <SelectItem value={NEW_CASH}>Cash</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium">Category</span>
          {draft.split ? (
            <p className="text-sm text-muted-foreground">Split: each part keeps its own category.</p>
          ) : (
            <div className="flex gap-2">
              <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId}>
                <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start">
                  <CategoryIcon category={category} size="sm" />
                  <span className="truncate">{category?.name ?? 'Let my rules decide'}</span>
                </Button>
              </CategoryPicker>
              {categoryId && (
                <Button type="button" variant="ghost" onClick={() => setCategoryId('')}>
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="manual-notes">Notes</Label>
          <Textarea id="manual-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || saving}>
          {editing ? 'Save' : 'Add transaction'}
        </Button>
      </DialogFooter>
    </form>
  )
}
