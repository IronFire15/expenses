import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeftRight, Download, ListChecks, PenLine, Plus, Search, Split, Tag, Upload, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { CategoryIcon, CategoryPicker } from '@/components/CategoryPicker'
import { EmptyState, PageHeader, Surface } from '@/components/page'
import { RuleDialog, type RuleDraft } from '@/components/RuleDialog'
import { TagPicker, TagPill } from '@/components/TagPicker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { db } from '@/db/db'
import { listActive } from '@/db/records'
import type { Transaction } from '@/db/types'
import { useLookups } from '@/hooks/useLookups'
import { formatDate } from '@/lib/dates'
import { formatMoney, formatSigned } from '@/lib/money'
import { EASE_OUT } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { exportTransactions, transactionTable, type ExportFormat } from '@/export/export'
import { setCategoryManually, suggestPattern } from '@/rules/engine'
import { isCounted } from '@/transactions/split'
import { addTag, tagCounts } from '@/transactions/tags'
import { ManualTransactionDialog, type ManualDraft } from './ManualTransactionDialog'
import { TransactionDialog } from './TransactionDialog'
import { applyFilters, UNCATEGORIZED, useMonths, useTransactionFilters } from './useTransactionFilters'

const PAGE = 150
const ALL = '__all__'

const monthLabel = (ym: string) => formatDate(`${ym}-01`, { month: 'long', year: 'numeric' })

export function TransactionsPage() {
  // Split originals are replaced by their parts everywhere you see transactions.
  const all = useLiveQuery(async () =>
    (await listActive(db.transactions)).filter(isCounted).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt),
  )
  const lookups = useLookups()
  const { categories, accounts, categoryById, accountById, ruleById } = lookups
  const { filters, setFilter, clear, active } = useTransactionFilters()
  const query = useDeferredValue(filters.q)
  const months = useMonths(all)

  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [manualDraft, setManualDraft] = useState<ManualDraft | null>(null)
  const allTags = useMemo(() => tagCounts(all ?? []).map((t) => t.tag), [all])

  const filtered = useMemo(() => applyFilters(all ?? [], { ...filters, q: query }), [all, filters, query])
  const uncategorized = useMemo(() => (all ?? []).filter((t) => !t.categoryId).length, [all])
  const totals = useMemo(() => {
    const counted = filtered.filter((t) => categoryById.get(t.categoryId ?? '')?.type !== 'transfer')
    return {
      in: counted.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
      out: counted.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0),
    }
  }, [filtered, categoryById])

  const shown = filtered.slice(0, limit)
  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    for (const t of shown) map.set(t.date, [...(map.get(t.date) ?? []), t])
    return [...map.entries()]
  }, [shown])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Set category by hand, then offer to turn it into a rule. */
  const categorize = async (ids: string[], categoryId: string) => {
    await setCategoryManually(db, ids, categoryId)
    const txs = (all ?? []).filter((t) => ids.includes(t.id))
    const patterns = [...new Set(txs.map((t) => suggestPattern(t.description)))]
    const name = categoryById.get(categoryId)?.name
    setSelected(new Set())
    if (patterns.length === 1) {
      toast.success(`${ids.length > 1 ? `${ids.length} transactions` : 'Saved'} → ${name}`, {
        description: `Always put “${patterns[0]}” in ${name}?`,
        action: {
          label: 'Create rule',
          onClick: () =>
            setRuleDraft({
              field: 'description',
              operator: 'contains',
              pattern: patterns[0],
              categoryId,
              direction: txs.every((t) => t.amount < 0) ? 'out' : txs.every((t) => t.amount > 0) ? 'in' : undefined,
            }),
        },
        duration: 15_000, // long enough to read and act; hovering pauses it
      })
    } else {
      toast.success(`${ids.length} transactions → ${name}`)
    }
  }

  const tagSelected = async (tag: string) => {
    const ids = [...selected]
    const used = await addTag(db, ids, tag, allTags)
    setSelected(new Set())
    toast.success(`Tagged ${ids.length} transaction${ids.length === 1 ? '' : 's'} “${used}”`)
  }

  const exportView = (format: ExportFormat) => {
    const table = transactionTable(filtered, categoryById, accountById)
    const scope = filters.month || (active ? 'filtered' : 'all')
    exportTransactions(table, format, `expenses-${scope}-${new Date().toISOString().slice(0, 10)}`)
    toast.success(`Exported ${table.rows.length} transactions`, { description: format === 'csv' ? 'CSV file, ready for Excel or Numbers.' : 'Excel file.' })
  }

  const reset = async (id: string) => {
    await setCategoryManually(db, [id], null)
    toast('Back to automatic', { description: 'Rules decide this category again.' })
  }

  if (all && all.length === 0) {
    return (
      <>
        <PageHeader title="Transactions" />
        <EmptyState
          icon={ArrowLeftRight}
          title="No transactions yet"
          actions={
            <>
              <Button asChild size="lg">
                <Link to="/import">
                  <Upload aria-hidden /> Import a bank file
                </Link>
              </Button>
              <Button size="lg" variant="outline" onClick={() => setManualDraft({})}>
                <Plus aria-hidden /> Add by hand
              </Button>
            </>
          }
        >
          Imported transactions appear here, ready to search, filter and categorize.
        </EmptyState>
        <ManualTransactionDialog draft={manualDraft} onClose={() => setManualDraft(null)} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        description={
          all
            ? `${filtered.length} of ${all.length} · in ${formatMoney(totals.in)} · out ${formatMoney(totals.out)} (transfers excluded)`
            : undefined
        }
        actions={
          <>
            {uncategorized > 0 && filters.category !== UNCATEGORIZED && (
              <Button variant="outline" onClick={() => setFilter('category', UNCATEGORIZED)}>
                {uncategorized} to categorize
              </Button>
            )}
            {all && filtered.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Download aria-hidden /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => exportView('xlsx')}>Excel (.xlsx), {filtered.length} rows</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => exportView('csv')}>CSV, {filtered.length} rows</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button onClick={() => setManualDraft({})}>
              <Plus aria-hidden /> Add
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto sm:min-w-48 sm:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search transactions"
            placeholder="Search descriptions…"
            value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={filters.month || ALL} onValueChange={(v) => setFilter('month', v === ALL ? '' : v)}>
          <SelectTrigger aria-label="Month" className="w-[calc(50%-0.25rem)] sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All months</SelectItem>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.category || ALL} onValueChange={(v) => setFilter('category', v === ALL ? '' : v)}>
          <SelectTrigger aria-label="Category" className="w-[calc(50%-0.25rem)] sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
            <SelectSeparator />
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <CategoryIcon category={c} size="sm" /> {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {accounts.length > 1 && (
          <Select value={filters.account || ALL} onValueChange={(v) => setFilter('account', v === ALL ? '' : v)}>
            <SelectTrigger aria-label="Account" className="w-[calc(50%-0.25rem)] sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={filters.dir || ALL} onValueChange={(v) => setFilter('dir', v === ALL ? '' : v)}>
          <SelectTrigger aria-label="Money in or out" className="w-[calc(50%-0.25rem)] sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>In and out</SelectItem>
            <SelectItem value="out">Money out</SelectItem>
            <SelectItem value="in">Money in</SelectItem>
          </SelectContent>
        </Select>
        {(allTags.length > 0 || filters.tag) && (
          <Select value={filters.tag || ALL} onValueChange={(v) => setFilter('tag', v === ALL ? '' : v)}>
            <SelectTrigger aria-label="Tag" className="w-[calc(50%-0.25rem)] sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tags</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>
                  <Tag aria-hidden /> {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {active && (
          <Button variant="ghost" onClick={clear}>
            <X aria-hidden /> Clear
          </Button>
        )}
        <Button
          variant={selectMode ? 'secondary' : 'ghost'}
          className="md:hidden"
          onClick={() => {
            setSelectMode((v) => !v)
            setSelected(new Set())
          }}
          aria-pressed={selectMode}
        >
          <ListChecks aria-hidden /> Select
        </Button>
      </div>

      {/* List */}
      {!all ? (
        <Surface className="space-y-3 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </Surface>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="Nothing matches" actions={<Button variant="outline" onClick={clear}>Clear filters</Button>}>
          Try another search or remove a filter.
        </EmptyState>
      ) : (
        <Surface className="overflow-clip">
          {groups.map(([date, txs]) => (
            <section key={date} aria-label={formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}>
              <h2 className="sticky top-14 z-[1] border-b bg-muted/80 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur md:top-0">
                {formatDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </h2>
              <ul className="divide-y">
                {txs.map((t) => {
                  const category = categoryById.get(t.categoryId ?? '')
                  const account = accountById.get(t.accountId)
                  const rule = t.ruleId ? ruleById.get(t.ruleId) : undefined
                  const how = t.splitOf
                    ? 'Split part'
                    : t.manual
                      ? 'Typed by you, waiting for bank'
                    : t.categorySource === 'transfer'
                      ? 'Transfer between your accounts'
                      : t.categorySource === 'manual'
                        ? 'Set by you'
                        : rule
                          ? `Rule: ${rule.pattern}`
                          : undefined
                  const isSelected = selected.has(t.id)
                  return (
                    <li key={t.id} className={cn('flex items-center gap-3 px-4 py-2.5 transition-colors', isSelected && 'bg-brand-soft/60')}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggle(t.id)}
                        aria-label={`Select ${t.description}`}
                        className={cn(selectMode ? 'flex' : 'hidden md:flex')}
                      />
                      <CategoryPicker
                        categories={categories}
                        value={t.categoryId}
                        onChange={(id) => categorize([t.id], id)}
                        onReset={t.categorySource === 'manual' && !t.splitOf ? () => reset(t.id) : undefined}
                      >
                        <button
                          type="button"
                          className="rounded-lg outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
                          aria-label={`Category: ${category?.name ?? 'Uncategorized'}. Change`}
                        >
                          <CategoryIcon category={category} />
                        </button>
                      </CategoryPicker>
                      <button
                        type="button"
                        onClick={() => setOpenId(t.id)}
                        className="-my-1 min-w-0 flex-1 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${t.description}, ${formatSigned(t.amount)}. Open details`}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <span className="truncate">{t.description}</span>
                          {t.splitOf && <Split className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                          {t.manual && <PenLine className="size-3.5 shrink-0 text-muted-foreground" aria-label="Typed by hand" />}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {category ? category.name : <span className="text-warning">Uncategorized</span>}
                          {t.splitOf && t.notes && ` · ${t.notes}`}
                          {accounts.length > 1 && account && ` · ${account.name}`}
                          {how && <span className="hidden sm:inline"> · {how}</span>}
                        </span>
                        {t.tags.length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {t.tags.map((tag) => (
                              <TagPill key={tag} tag={tag} />
                            ))}
                          </span>
                        )}
                      </button>
                      <p
                        className={cn(
                          'shrink-0 text-sm font-medium tabular-nums',
                          t.amount > 0 && 'text-positive',
                          category?.type === 'transfer' && 'text-muted-foreground',
                        )}
                      >
                        {formatSigned(t.amount)}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {filtered.length > limit && (
            <div className="border-t p-2 text-center">
              <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
                Show more ({filtered.length - limit} left)
              </Button>
            </div>
          )}
        </Surface>
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
            exit={{ opacity: 0, y: 16, transition: { duration: 0.12 } }}
            className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 md:inset-x-auto md:right-8 md:bottom-6 md:left-[calc(15rem+2rem)]"
          >
            <Surface className="mx-auto flex max-w-xl items-center justify-between gap-3 bg-card/95 p-2 pl-4 shadow-card-hover backdrop-blur-lg">
              <span className="text-sm font-medium tabular-nums">{selected.size} selected</span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <TagPicker tags={allTags} onPick={(tag) => void tagSelected(tag)} align="end">
                  <Button variant="outline">
                    <Tag aria-hidden /> Tag
                  </Button>
                </TagPicker>
                <CategoryPicker categories={categories} onChange={(id) => categorize([...selected], id)} align="end">
                  <Button>Set category</Button>
                </CategoryPicker>
              </div>
            </Surface>
          </motion.div>
        )}
      </AnimatePresence>

      <RuleDialog draft={ruleDraft} onClose={() => setRuleDraft(null)} />
      <TransactionDialog
        id={openId}
        allTags={allTags}
        onClose={() => setOpenId(null)}
        onCategorize={(ids, c) => void categorize(ids, c)}
        onEdit={(tx) => {
          setOpenId(null)
          setManualDraft(tx)
        }}
      />
      <ManualTransactionDialog draft={manualDraft} onClose={() => setManualDraft(null)} />
    </>
  )
}
