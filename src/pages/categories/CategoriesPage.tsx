import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CategoryIcon } from '@/components/CategoryPicker'
import { Stagger, StaggerItem } from '@/components/motion'
import { PageHeader, Surface } from '@/components/page'
import { RuleDialog, type RuleDraft } from '@/components/RuleDialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { db } from '@/db/db'
import { listActive } from '@/db/records'
import type { CategoryType, Rule } from '@/db/types'
import { useLookups } from '@/hooks/useLookups'
import { formatMoney } from '@/lib/money'
import { CategoryDialog, type CategoryDraft } from './CategoryDialog'
import { CategoryTabs } from './CategoryTabs'

const GROUPS: { type: CategoryType; title: string; hint: string }[] = [
  { type: 'expense', title: 'Expenses', hint: 'Counted as spending' },
  { type: 'income', title: 'Income', hint: 'Counted as income' },
  { type: 'transfer', title: 'Not spending', hint: 'Transfers, savings and investments. Left out of totals.' },
]

export function CategoriesPage() {
  const { categories, rules } = useLookups()
  const txs = useLiveQuery(() => listActive(db.transactions))
  const [catDraft, setCatDraft] = useState<CategoryDraft | null>(null)
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null)

  const stats = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>()
    for (const t of txs ?? []) {
      if (!t.categoryId) continue
      const s = map.get(t.categoryId) ?? { count: 0, total: 0 }
      s.count++
      s.total += t.amount
      map.set(t.categoryId, s)
    }
    return map
  }, [txs])

  const rulesByCategory = useMemo(() => {
    const map = new Map<string, Rule[]>()
    for (const r of [...rules].sort((a, b) => Number(!!a.builtin) - Number(!!b.builtin) || a.pattern.localeCompare(b.pattern))) {
      map.set(r.categoryId, [...(map.get(r.categoryId) ?? []), r])
    }
    return map
  }, [rules])

  const uncategorized = txs?.filter((t) => !t.categoryId).length ?? 0
  // Open the live record so edits in the dialog always start from current data.
  const editing = catDraft?.id ? { ...categories.find((c) => c.id === catDraft.id), stats: { count: stats.get(catDraft.id)?.count ?? 0, rules: rulesByCategory.get(catDraft.id) ?? [] } } : catDraft

  return (
    <>
      <PageHeader
        title="Categories"
        description={`${categories.length} categories · ${rules.length} rules`}
        actions={
          <Button onClick={() => setCatDraft({})}>
            <Plus aria-hidden /> New category
          </Button>
        }
      />
      <CategoryTabs />

      {uncategorized > 0 && (
        <Surface className="mb-6 flex flex-wrap items-center justify-between gap-3 border-warning/40 bg-warning/5 p-4">
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{uncategorized}</span> transaction{uncategorized === 1 ? ' has' : 's have'} no category yet.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/transactions?category=none">Categorize them</Link>
          </Button>
        </Surface>
      )}

      <div className="space-y-8">
        {GROUPS.map((g) => {
          const items = categories.filter((c) => c.type === g.type)
          return (
            <section key={g.type} aria-labelledby={`group-${g.type}`}>
              <div className="mb-3">
                <h2 id={`group-${g.type}`} className="flex items-baseline gap-2 text-sm font-semibold">
                  {g.title} <span className="font-normal text-muted-foreground tabular-nums">{items.length}</span>
                </h2>
                <p className="text-xs text-muted-foreground">{g.hint}</p>
              </div>
              {!txs ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-[4.5rem] rounded-xl" />
                  ))}
                </div>
              ) : (
                <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((c) => {
                    const s = stats.get(c.id)
                    const ruleCount = rulesByCategory.get(c.id)?.length ?? 0
                    return (
                      <StaggerItem key={c.id}>
                        <button
                          type="button"
                          onClick={() => setCatDraft({ id: c.id })}
                          className="block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Surface interactive className="flex items-center gap-3 p-3">
                            <CategoryIcon category={c} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{c.name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {s ? `${s.count} transaction${s.count === 1 ? '' : 's'}` : 'No transactions'}
                                {ruleCount > 0 && ` · ${ruleCount} rule${ruleCount === 1 ? '' : 's'}`}
                              </p>
                            </div>
                            {s && <p className="shrink-0 text-sm font-medium tabular-nums">{formatMoney(Math.abs(s.total))}</p>}
                          </Surface>
                        </button>
                      </StaggerItem>
                    )
                  })}
                </Stagger>
              )}
            </section>
          )
        })}
      </div>

      <CategoryDialog draft={editing} onClose={() => setCatDraft(null)} onEditRule={setRuleDraft} />
      <RuleDialog draft={ruleDraft} onClose={() => setRuleDraft(null)} />
    </>
  )
}
