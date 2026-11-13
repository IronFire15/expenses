import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, BarChart3, ChevronLeft, ChevronRight, PiggyBank, Scale, Upload } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { BalanceChart } from '@/components/charts/BalanceChart'
import { ChartCard, DataTable } from '@/components/charts/ChartCard'
import { ColumnChart } from '@/components/charts/ColumnChart'
import { RankedBars, type RankedRow } from '@/components/charts/RankedBars'
import { CategoryIcon } from '@/components/CategoryPicker'
import { Stagger, StaggerItem } from '@/components/motion'
import { EmptyState, PageHeader, StatCard, Surface, type Delta } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  addMonths,
  balanceHistory,
  coveredMonths,
  monthLabel,
  monthly,
  periodOptions,
  resolvePeriod,
  spendingByCategory,
  topPayees,
  totals,
  type CategoryTypeMap,
} from '@/dashboard/stats'
import { budgetStatuses } from '@/budgets/budgets'
import { db } from '@/db/db'
import { listActive } from '@/db/records'
import { useLookups } from '@/hooks/useLookups'
import { formatDate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { isCounted } from '@/transactions/split'

const MAX_CATEGORY_ROWS = 7

export function DashboardPage() {
  const txs = useLiveQuery(() => listActive(db.transactions))
  const batches = useLiveQuery(() => listActive(db.importBatches))
  const budgets = useLiveQuery(() => listActive(db.budgets))
  const { categories, categoryById, accounts } = useLookups()
  const [params, setParams] = useSearchParams()

  const dataMonths = useMemo(() => [...new Set((txs ?? []).map((t) => t.date.slice(0, 7)))].sort(), [txs])
  const latest = dataMonths.at(-1)
  const key = params.get('period') ?? (latest ? `month:${latest}` : 'all')
  const period = useMemo(() => resolvePeriod(key, dataMonths), [key, dataMonths])
  const options = periodOptions(dataMonths)
  const setPeriod = (k: string) => setParams({ period: k })

  const types: CategoryTypeMap = useMemo(() => new Map(categories.map((c) => [c.id, c.type])), [categories])

  const view = useMemo(() => {
    if (!txs || !batches) return null
    const covered = coveredMonths(batches, dataMonths)
    const prevMonths = period.months.map((m) => addMonths(m, -period.months.length))
    const prevCovered = prevMonths.filter((m) => covered.has(m)).length
    const previousCoverage: Delta['coverage'] = prevCovered === 0 ? 'none' : prevCovered < prevMonths.length ? 'partial' : 'full'
    const now = totals(txs, types, period)
    const before = totals(txs, types, period.previous)
    // Monthly context: 12 months ending with the period (never before the first statement).
    const months: string[] = []
    const end = period.months.at(-1)!
    for (let i = Math.max(11, period.months.length - 1); i >= 0; i--) {
      const ym = addMonths(end, -i)
      if (!dataMonths[0] || ym >= dataMonths[0]) months.push(ym)
    }
    return {
      now,
      before,
      byCategory: spendingByCategory(txs, types, period),
      monthly: monthly(txs, types, months),
      payees: topPayees(txs, types, period),
      balance: balanceHistory(txs, accounts),
      uncategorized: txs.filter((t) => isCounted(t) && !t.categoryId && t.date >= period.from && t.date <= period.to),
      // Budgets are monthly: check the last month of the period.
      budgetMonth: period.months.at(-1)!,
      budgets: budgetStatuses(budgets ?? [], txs, categories, period.months.at(-1)!).filter((b) => b.level !== 'ok'),
      previousCoverage,
      monthsWithData: covered,
    }
  }, [txs, batches, budgets, types, period, dataMonths, accounts, categories])

  if (txs && txs.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState
          icon={BarChart3}
          title="No transactions yet"
          actions={
            <Button asChild size="lg">
              <Link to="/import">
                <Upload aria-hidden /> Import a bank file
              </Link>
            </Button>
          }
        >
          Import a statement from your bank to see spending by category, monthly trends and your balance over time.
        </EmptyState>
      </>
    )
  }

  const isMonth = key.startsWith('month:')
  const versus = `vs ${period.previous.label}`
  const monthQuery = isMonth ? `&month=${key.slice(6)}` : ''

  // Category rows: top N, the rest folded into "Other" (never more hues; one hue for all bars).
  const catRows: RankedRow[] = (view?.byCategory ?? []).slice(0, MAX_CATEGORY_ROWS).map((c) => {
    const cat = c.categoryId ? categoryById.get(c.categoryId) : undefined
    return {
      key: c.categoryId ?? 'none',
      label: cat?.name ?? 'Uncategorized',
      icon: <CategoryIcon category={cat} size="sm" />,
      value: c.spent,
      detail: `${c.count} transaction${c.count === 1 ? '' : 's'}`,
      href: `/transactions?category=${c.categoryId ?? 'none'}&dir=out${monthQuery}`,
    }
  })
  const rest = (view?.byCategory ?? []).slice(MAX_CATEGORY_ROWS)
  if (rest.length) {
    catRows.push({ key: 'other', label: `Other (${rest.length} categories)`, value: rest.reduce((s, r) => s + r.spent, 0) })
  }

  const prevMonth = isMonth && dataMonths.includes(addMonths(key.slice(6), -1)) ? addMonths(key.slice(6), -1) : null
  const nextMonth = isMonth && dataMonths.includes(addMonths(key.slice(6), 1)) ? addMonths(key.slice(6), 1) : null

  return (
    <>
      <PageHeader eyebrow={period.label} title="Dashboard" description="Where your money went. Transfers and investments are left out." />

      {/* One filter row above everything it scopes. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Select value={key} onValueChange={setPeriod}>
          <SelectTrigger aria-label="Period" className="w-56">
            <SelectValue placeholder="Period">{period.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Ranges</SelectLabel>
              {options.presets.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Months</SelectLabel>
              {options.months.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {isMonth && (
          <div className="flex gap-1">
            <Button variant="outline" size="icon" disabled={!prevMonth} onClick={() => prevMonth && setPeriod(`month:${prevMonth}`)} aria-label="Previous month">
              <ChevronLeft aria-hidden />
            </Button>
            <Button variant="outline" size="icon" disabled={!nextMonth} onClick={() => nextMonth && setPeriod(`month:${nextMonth}`)} aria-label="Next month">
              <ChevronRight aria-hidden />
            </Button>
          </div>
        )}
      </div>

      <Stagger key={key} className="min-w-0 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <StaggerItem>
            <StatCard
              label="Spent"
              cents={view?.now.spent}
              icon={ArrowUpRight}
              delta={view ? { current: view.now.spent, previous: view.before.spent, coverage: view.previousCoverage, upIsGood: false, versus } : undefined}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Income"
              cents={view?.now.income}
              icon={ArrowDownLeft}
              tone="positive"
              delta={view ? { current: view.now.income, previous: view.before.income, coverage: view.previousCoverage, upIsGood: true, versus } : undefined}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Net" cents={view?.now.net} icon={Scale} tone="brand" hint="Income minus spending" />
          </StaggerItem>
        </div>

        {view && view.uncategorized.length > 0 && (
          <StaggerItem>
            <Surface className="flex flex-wrap items-center justify-between gap-3 border-warning/40 bg-warning/5 p-4">
              <p className="flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  <span className="font-semibold">{view.uncategorized.length}</span> transactions in this period have no category, so charts
                  show them as “Uncategorized”.
                </span>
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to={`/transactions?category=none${monthQuery}`}>Categorize</Link>
              </Button>
            </Surface>
          </StaggerItem>
        )}

        {view && view.budgets.length > 0 && (
          <StaggerItem>
            <Surface className={cn('flex flex-wrap items-center justify-between gap-3 p-4', view.budgets.some((b) => b.level === 'over') ? 'border-negative/40 bg-negative/5' : 'border-warning/40 bg-warning/5')}>
              <p className="flex items-center gap-2 text-sm">
                <PiggyBank className={cn('size-4 shrink-0', view.budgets.some((b) => b.level === 'over') ? 'text-negative' : 'text-warning')} aria-hidden />
                <span>
                  {monthLabel(view.budgetMonth)}:{' '}
                  {view.budgets
                    .map((b) => `${b.category?.name ?? '?'} ${b.level === 'over' ? (b.left < 0 ? `over by ${formatMoney(-b.left)}` : 'used up') : `at ${Math.round(b.ratio * 100)}%`}`)
                    .join(', ')}
                  .
                </span>
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to={`/budgets?month=${view.budgetMonth}`}>See budgets</Link>
              </Button>
            </Surface>
          </StaggerItem>
        )}

        <StaggerItem>
          <ChartCard
            title="Spending and income by month"
            description={period.months.length < (view?.monthly.length ?? 0) ? 'Selected period highlighted' : undefined}
            legend={[
              { label: 'Spent', color: 'var(--viz-spend)' },
              { label: 'Income', color: 'var(--viz-income)' },
            ]}
            table={
              view && (
                <DataTable
                  head={['Month', 'Spent', 'Income', 'Net']}
                  rows={[...view.monthly]
                    .reverse()
                    .map((m) =>
                      view.monthsWithData.has(m.month)
                        ? [monthLabel(m.month), formatMoney(m.spent), formatMoney(m.income), formatMoney(m.income - m.spent)]
                        : [monthLabel(m.month), 'No data', 'No data', '—'],
                    )}
                />
              )
            }
          >
            {view && (
              <ColumnChart
                data={view.monthly.map((m) => ({
                  key: m.month,
                  label: monthLabel(m.month),
                  short: monthLabel(m.month, 'short'),
                  values: [m.spent, m.income],
                  noData: !view.monthsWithData.has(m.month),
                }))}
                series={[
                  { name: 'Spent', color: 'var(--viz-spend)' },
                  { name: 'Income', color: 'var(--viz-income)' },
                ]}
                highlight={new Set(period.months)}
                format={formatMoney}
              />
            )}
          </ChartCard>
        </StaggerItem>

        <div className="grid gap-4 lg:grid-cols-5">
          <StaggerItem className="min-w-0 lg:col-span-3">
            <ChartCard
              className="h-full"
              title="Spending by category"
              description={view ? `${formatMoney(view.now.spent)} in ${period.label}` : undefined}
              table={
                view && (
                  <DataTable
                    head={['Category', 'Spent', 'Transactions']}
                    rows={view.byCategory.map((c) => [c.categoryId ? (categoryById.get(c.categoryId)?.name ?? '?') : 'Uncategorized', formatMoney(c.spent), c.count])}
                  />
                )
              }
            >
              {catRows.length ? (
                <RankedBars rows={catRows} format={formatMoney} />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">No spending in this period.</p>
              )}
            </ChartCard>
          </StaggerItem>

          <StaggerItem className="min-w-0 lg:col-span-2">
            <ChartCard
              className="h-full"
              title="Where it went"
              description="Biggest payees in this period"
              table={view && <DataTable head={['Payee', 'Spent', 'Times']} rows={view.payees.map((p) => [p.name, formatMoney(p.spent), p.count])} />}
            >
              {view?.payees.length ? (
                <ol className="space-y-1">
                  {view.payees.map((p, i) => (
                    <li key={p.name}>
                      <Link
                        to={`/transactions?q=${encodeURIComponent(p.name)}${monthQuery}`}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="w-4 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                        <CategoryIcon category={p.categoryId ? categoryById.get(p.categoryId) : undefined} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{p.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {p.count} time{p.count === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="text-sm font-medium tabular-nums">{formatMoney(p.spent)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">No spending in this period.</p>
              )}
            </ChartCard>
          </StaggerItem>
        </div>

        <StaggerItem>
          <ChartCard
            title="Balance over time"
            description={`All accounts${key !== 'all' ? ' · selected period shaded' : ''}`}
            table={
              view && (
                <DataTable
                  head={['Date', 'Balance']}
                  rows={[...view.balance].reverse().map((b) => [formatDate(b.date), formatMoney(b.balance)])}
                />
              )
            }
          >
            {view && (
              <BalanceChart points={view.balance} shade={key !== 'all' ? { from: period.from, to: period.to } : undefined} format={formatMoney} />
            )}
          </ChartCard>
        </StaggerItem>
      </Stagger>
    </>
  )
}
