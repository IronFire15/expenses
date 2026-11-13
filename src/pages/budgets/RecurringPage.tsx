import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarClock, EyeOff, MoreHorizontal, Repeat } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { CategoryIcon } from '@/components/CategoryPicker'
import { Stagger, StaggerItem } from '@/components/motion'
import { EmptyState, PageHeader, StatCard, Surface } from '@/components/page'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { db } from '@/db/db'
import { listActive } from '@/db/records'
import type { Category } from '@/db/types'
import { useLookups } from '@/hooks/useLookups'
import { formatDate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { CADENCE_LABEL, detectRecurring, ordinal, type RecurringSeries } from '@/recurring/detect'
import { HIDDEN_RECURRING, setRecurringHidden } from '@/recurring/hidden'
import { PlanTabs } from './PlanTabs'

const today = () => new Date().toISOString().slice(0, 10)
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

export function RecurringPage() {
  const txs = useLiveQuery(() => listActive(db.transactions))
  const hiddenRec = useLiveQuery(() => db.settings.get(HIDDEN_RECURRING))
  const { categories, categoryById } = useLookups()
  const [showHidden, setShowHidden] = useState(false)

  const hidden = useMemo(() => new Set(hiddenRec && !hiddenRec.deleted && Array.isArray(hiddenRec.value) ? (hiddenRec.value as string[]) : []), [hiddenRec])
  const all = useMemo(() => (txs ? detectRecurring(txs, categories, today()) : undefined), [txs, categories])
  const visible = all?.filter((s) => !hidden.has(s.key)) ?? []
  const active = visible.filter((s) => s.active)
  const bills = active.filter((s) => s.direction === 'out')
  const income = active.filter((s) => s.direction === 'in')
  const ended = visible.filter((s) => !s.active)
  const hiddenSeries = all?.filter((s) => hidden.has(s.key)) ?? []
  const upcoming = bills.filter((s) => s.next <= inDays(30))

  const hide = async (s: RecurringSeries) => {
    await setRecurringHidden(db, s.key, true)
    toast(`${s.name} hidden`, { action: { label: 'Undo', onClick: () => void setRecurringHidden(db, s.key, false) } })
  }

  const latest = txs?.reduce((m, t) => (t.date > m ? t.date : m), '')

  return (
    <>
      <PageHeader title="Recurring" description="Subscriptions, bills and regular income, found automatically in your transactions." />
      <PlanTabs />

      {!all ? (
        <Surface className="space-y-3 p-5">
          {Array.from({ length: 4 }, (_, k) => (
            <Skeleton key={k} className="h-10" />
          ))}
        </Surface>
      ) : visible.length === 0 && hiddenSeries.length === 0 ? (
        <EmptyState icon={Repeat} title="Nothing recurring found yet">
          Payments show up here once the same payee appears at least 3 times on a regular rhythm (weekly, every 2 weeks or monthly). Import a few months of statements.
        </EmptyState>
      ) : (
        <Stagger className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <StaggerItem>
              <StatCard label="Bills & subscriptions" cents={bills.reduce((s, b) => s + b.monthly, 0)} icon={Repeat} hint={`About this much a month, ${bills.length} active`} />
            </StaggerItem>
            {income.length > 0 && (
            <StaggerItem>
              <StatCard label="Regular income" cents={income.reduce((s, b) => s + b.monthly, 0)} icon={Repeat} tone="positive" hint={`About this much a month, ${income.length} active`} />
            </StaggerItem>
            )}
          </div>

          <StaggerItem>
            <Surface className="p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <CalendarClock className="size-4 text-muted-foreground" aria-hidden /> Coming up in the next 30 days
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Expected from past payments{latest ? `; your statements go up to ${formatDate(latest)}` : ''}.
              </p>
              {upcoming.length ? (
                <ul className="mt-3 divide-y">
                  {upcoming.map((s) => (
                    <li key={s.key} className="flex items-center gap-3 py-2.5">
                      <span className="w-14 shrink-0 text-center">
                        <span className="block text-xs text-muted-foreground uppercase">{formatDate(s.next, { month: 'short' })}</span>
                        <span className="block text-lg leading-tight font-semibold tabular-nums">{Number(s.next.slice(8))}</span>
                      </span>
                      <CategoryIcon category={categoryById.get(s.categoryId ?? '')} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                      <span className="text-sm font-medium tabular-nums">
                        {s.amountVaries && <span className="font-normal text-muted-foreground">~</span>}
                        {formatMoney(s.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">No bills expected in the next 30 days.</p>
              )}
            </Surface>
          </StaggerItem>

          {bills.length > 0 && (
            <StaggerItem>
              <SeriesList title="Bills & subscriptions" series={bills} onHide={hide} categoryById={categoryById} />
            </StaggerItem>
          )}
          {income.length > 0 && (
            <StaggerItem>
              <SeriesList title="Regular income" series={income} onHide={hide} categoryById={categoryById} />
            </StaggerItem>
          )}
          {ended.length > 0 && (
            <StaggerItem>
              <SeriesList
                title="Seem to have stopped"
                description="Not seen in your recent statements. Cancelled, or just a missing statement?"
                series={ended}
                onHide={hide}
                categoryById={categoryById}
                muted
              />
            </StaggerItem>
          )}

          {hiddenSeries.length > 0 && (
            <div className="text-sm text-muted-foreground">
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => setShowHidden((v) => !v)} aria-expanded={showHidden}>
                {showHidden ? 'Hide' : 'Show'} {hiddenSeries.length} marked “not recurring”
              </button>
              {showHidden && (
                <ul className="mt-2 space-y-1">
                  {hiddenSeries.map((s) => (
                    <li key={s.key} className="flex items-center gap-2">
                      <span className="truncate">{s.name}</span>
                      <Button variant="ghost" size="sm" onClick={() => void setRecurringHidden(db, s.key, false)}>
                        Show again
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Stagger>
      )}
    </>
  )
}

function SeriesList({
  title,
  description,
  series,
  onHide,
  categoryById,
  muted = false,
}: {
  title: string
  description?: string
  series: RecurringSeries[]
  onHide: (s: RecurringSeries) => void
  categoryById: Map<string, Category>
  muted?: boolean
}) {
  return (
    <Surface>
      <div className="px-5 pt-5 pb-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <ul className="divide-y">
        {series.map((s) => (
          <li key={s.key} className={cn('flex items-center gap-3 px-5 py-3', muted && 'opacity-70')}>
            <CategoryIcon category={categoryById.get(s.categoryId ?? '')} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {CADENCE_LABEL[s.cadence]}
                {s.dayOfMonth ? `, around the ${ordinal(s.dayOfMonth)}` : ''} · {s.occurrences.length} payments · last {formatDate(s.last, { day: 'numeric', month: 'short' })}
                {!muted && <> · next {formatDate(s.next, { day: 'numeric', month: 'short' })}</>}
              </p>
            </div>
            <div className="text-right">
              <p className={cn('text-sm font-medium tabular-nums', s.direction === 'in' && 'text-positive')}>
                {s.amountVaries && <span className="font-normal text-muted-foreground">~</span>}
                {formatMoney(s.amount)}
              </p>
              {s.cadence !== 'monthly' && <p className="text-xs text-muted-foreground tabular-nums">{formatMoney(s.monthly)}/month</p>}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`More for ${s.name}`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/transactions?q=${encodeURIComponent(s.pattern)}&dir=${s.direction}`}>Show payments</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onHide(s)}>
                  <EyeOff aria-hidden /> Not recurring
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
    </Surface>
  )
}
