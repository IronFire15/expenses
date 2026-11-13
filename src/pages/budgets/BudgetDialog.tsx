import { useState } from 'react'
import { toast } from 'sonner'
import { CategoryIcon, CategoryPicker } from '@/components/CategoryPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setBudget, suggestBudget } from '@/budgets/budgets'
import { db } from '@/db/db'
import type { Category, Transaction } from '@/db/types'
import { centsToInput, formatMoney, parseTypedAmount } from '@/lib/money'

export interface BudgetDraft {
  categoryId?: string
  amount?: number
  editing: boolean
}

/** Add or change a monthly budget. Suggests your average spending in the category. */
export function BudgetDialog({
  draft,
  onClose,
  categories,
  txs,
  recentMonths,
}: {
  draft: BudgetDraft | null
  onClose: () => void
  categories: Category[]
  txs: Transaction[]
  recentMonths: string[]
}) {
  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {draft && <Form key={draft.categoryId ?? 'new'} draft={draft} onClose={onClose} categories={categories} txs={txs} recentMonths={recentMonths} />}
      </DialogContent>
    </Dialog>
  )
}

function Form({ draft, onClose, categories, txs, recentMonths }: { draft: BudgetDraft; onClose: () => void; categories: Category[]; txs: Transaction[]; recentMonths: string[] }) {
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? '')
  const [amount, setAmount] = useState(draft.amount ? centsToInput(draft.amount) : '')
  const cents = parseTypedAmount(amount)
  const category = categories.find((c) => c.id === categoryId)
  const expenseCategories = categories.filter((c) => c.type === 'expense')
  const suggestion = categoryId ? suggestBudget(txs, categoryId, categories, recentMonths) : 0

  const save = async (value: number) => {
    await setBudget(db, categoryId, value)
    toast.success(value ? `Budget for ${category?.name}: ${formatMoney(value)} a month` : `Budget for ${category?.name} removed`)
    onClose()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (categoryId && cents) void save(cents)
      }}
      className="contents"
    >
      <DialogHeader>
        <DialogTitle>{draft.editing ? `${category?.name ?? 'Budget'} budget` : 'New budget'}</DialogTitle>
        <DialogDescription>A monthly limit. You’ll see a warning at 80% and when it’s used up.</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {!draft.editing && (
          <div className="space-y-2">
            <Label>Category</Label>
            <CategoryPicker categories={expenseCategories} value={categoryId} onChange={setCategoryId}>
              <Button type="button" variant="outline" className="w-full justify-start">
                <CategoryIcon category={category} size="sm" />
                {category?.name ?? 'Choose a category'}
              </Button>
            </CategoryPicker>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="budget-amount">Monthly amount</Label>
          <div className="relative">
            <Input
              id="budget-amount"
              inputMode="decimal"
              autoFocus={draft.editing}
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={amount !== '' && cents === null}
              className="pr-7 tabular-nums"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
              €
            </span>
          </div>
          {suggestion > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              You spend about {formatMoney(suggestion)} a month here ({recentMonths.length === 1 ? 'last month' : `last ${recentMonths.length} months`}).
              <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setAmount(centsToInput(suggestion))}>
                Use this
              </button>
            </p>
          )}
        </div>
      </div>

      <DialogFooter className="gap-2">
        {draft.editing && (
          <Button type="button" variant="ghost" className="sm:mr-auto" onClick={() => void save(0)}>
            Remove budget
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!categoryId || !cents}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
