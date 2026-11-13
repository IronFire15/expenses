import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, PiggyBank, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CategoryIcon } from '@/components/CategoryPicker'
import { Stagger, StaggerItem } from '@/components/motion'
import { EmptyState, PageHeader, Surface } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { budgetStatuses, suggestBudget, type BudgetStatus } from '@/budgets/budgets'
import { monthLabel, spendingByCategory } from '@/dashboard/stats'
import { db } from '@/db/db'
import { listActive } from '@/db/records'
import { useLookups } from '@/hooks/useLookups'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { BudgetDialog, type BudgetDraft } from './BudgetDialog'
import { Meter, PlanTabs } from './PlanTabs'

const thisMonth = () => new Date().toISOString().slice(0, 7)

export function BudgetsPage() {
  const txs = useLiveQuery(() => listActive(db.transactions))
  const budgets = useLiveQuery(() => listActive(db.budgets))
  const { categories, categoryById } = useLookups()
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState<BudgetDraft | null>(null)

  const dataMonths = useMemo(() => [...new Set((txs ?? []).map((t) => t.date.slice(0, 7)))].sort(), [txs])
  const months = useMemo(() => [...new Set([...dataMonths, thisMonth()])].sort(), [dataMonths])
  // Statements arrive after the month ends: start on the newest month that has data.
  const month = params.get('month') ?? (dataMonths.includes(thisMonth()) ? thisMonth() : (dataMonths.at(-1) ?? thisMonth()))
  const setMonth = (m: string) => setParams({ month: m }, { replace: true })
  // The 3 months with data before the one shown, for suggestions.
  const recentMonths = useMemo(() => dataMonths.filter((m) => m <= month).slice(-3), [dataMonths, month])

  const statuses = useMemo(() => (txs && budgets ? budgetStatuses(budgets, txs, categories, month) : undefined), [txs, budgets, categories, month])
  const totals = statuses?.reduce((t, s) => ({ budget: t.budget + s.budget.monthlyAmount, spent: t.spent + s.spent }), { budget: 0, spent: 0 })

  /** Biggest spending categories without a budget yet: one-tap suggestions. */
  const suggestions = useMemo(() => {
    if (!txs || !budgets) return []
    const budgeted = new Set(budgets.map((b) => b.categoryId))
    const types = new Map(categories.map((c) => [c.id, c.type]))
    const from = `${recentMonths[0] ?? month}-01`
    const to = `${month}-31`
    return spendingByCategory(txs, types, { from, to, label: '' })
      .filter((c) => c.categoryId && !budgeted.has(c.categoryId) && types.get(c.categoryId) === 'expense')
      .slice(0, 4)
      .map((c) => ({ categoryId: c.categoryId!, amount: suggestBudget(txs, c.categoryId!, categories, recentMonths) }))
      .filter((s) => s.amount > 0)
  }, [txs, budgets, categories, recentMonths, month])

  const i = months.indexOf(month)
  const prev = i > 0 ? months[i - 1] : null
  const next = i >= 0 && i < months.length - 1 ? months[i + 1] : null
  const hasData = dataMonths.includes(month)

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Monthly limits per category. Refunds in a category count against what you spent."
        actions={
          <Button onClick={() => setDraft({ editing: false })}>
            <Plus aria-hidden /> Add budget
          </Button>
        }
      />
      <PlanTabs />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger aria-label="Month" className="w-48">
            <SelectValue>{monthLabel(month)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[...months].reverse().map((m) => (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" disabled={!prev} onClick={() => prev && setMonth(prev)} aria-label="Previous month">
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="icon" disabled={!next} onClick={() => next && setMonth(next)} aria-label="Next month">
            <ChevronRight aria-hidden />
          </Button>
        </div>
        {!hasData && <p className="text-sm text-muted-foreground">No statement imported for {monthLabel(month)} yet.</p>}
      </div>

      {!statuses ? (
        <Surface className="space-y-4 p-5">
          {Array.from({ length: 3 }, (_, k) => (
            <Skeleton key={k} className="h-12" />
          ))}
        </Surface>
      ) : statuses.length === 0 ? (
        <EmptyState icon={PiggyBank} title="No budgets yet" actions={<Button onClick={() => setDraft({ editing: false })}>Add a budget</Button>}>
          Set a monthly limit for a category, like Restaurants or Shopping. You’ll get a warning at 80% and when it’s used up.
        </EmptyState>
      ) : (
        <Stagger key={month} className="space-y-4">
          <StaggerItem>
            <Surface className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Spent <span className="font-semibold text-foreground tabular-nums">{formatMoney(totals!.spent)}</span> of{' '}
                  <span className="tabular-nums">{formatMoney(totals!.budget)}</span> budgeted
                </p>
                <p className={cn('text-sm font-medium tabular-nums', totals!.spent > totals!.budget ? 'text-negative' : 'text-muted-foreground')}>
                  {totals!.spent > totals!.budget ? `${formatMoney(totals!.spent - totals!.budget)} over` : `${formatMoney(totals!.budget - totals!.spent)} left`}
                </p>
              </div>
              <div className="mt-3">
                <Meter
                  ratio={totals!.budget ? totals!.spent / totals!.budget : 0}
                  tone={totals!.spent >= totals!.budget ? 'over' : totals!.spent >= totals!.budget * 0.8 ? 'near' : 'ok'}
                  label="All budgets"
                />
              </div>
            </Surface>
          </StaggerItem>
          <StaggerItem>
            <Surface className="divide-y">
              {statuses.map((s) => (
                <BudgetRow key={s.budget.id} status={s} month={month} onEdit={() => setDraft({ editing: true, categoryId: s.budget.categoryId, amount: s.budget.monthlyAmount })} />
              ))}
            </Surface>
          </StaggerItem>
        </Stagger>
      )}

      {suggestions.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold">Suggested budgets</h2>
          <p className="mb-3 text-sm text-muted-foreground">Your biggest categories without a budget, at your recent monthly average.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((s) => {
              const cat = categoryById.get(s.categoryId)
              return (
                <button
                  key={s.categoryId}
                  type="button"
                  onClick={() => setDraft({ editing: false, categoryId: s.categoryId, amount: s.amount })}
                  className="flex items-center gap-3 rounded-xl border border-dashed p-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CategoryIcon category={cat} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">{cat?.name}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">{formatMoney(s.amount)} / month</span>
                  <Plus className="size-4 text-primary" aria-hidden />
                </button>
              )
            })}
          </div>
        </section>
      )}

      <BudgetDialog draft={draft} onClose={() => setDraft(null)} categories={categories} txs={txs ?? []} recentMonths={recentMonths} />
    </>
  )
}

function BudgetRow({ status: s, month, onEdit }: { status: BudgetStatus; month: string; onEdit: () => void }) {
  const name = s.category?.name ?? 'Deleted category'
  const pct = Math.round(s.ratio * 100)
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
      <CategoryIcon category={s.category} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <Link
            to={`/transactions?category=${s.budget.categoryId}&month=${month}`}
            className="truncate text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {name}
          </Link>
          <p className="text-sm tabular-nums">
            <span className="font-medium">{formatMoney(s.spent)}</span>
            <span className="text-muted-foreground"> of {formatMoney(s.budget.monthlyAmount)}</span>
          </p>
        </div>
        <Meter ratio={s.ratio} tone={s.level} label={`${name}: ${pct}% used`} />
        <p className={cn('text-xs', s.level === 'over' ? 'font-medium text-negative' : s.level === 'near' ? 'font-medium text-warning' : 'text-muted-foreground')}>
          {s.level === 'over'
            ? s.left === 0
              ? 'Used up'
              : `${formatMoney(-s.left)} over budget`
            : `${formatMoney(s.left)} left · ${pct}% used`}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${name} budget`}>
        Edit
      </Button>
    </div>
  )
}
