import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, Pencil, Plus, Search, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CategoryIcon } from '@/components/CategoryPicker'
import { EmptyState, PageHeader, Surface } from '@/components/page'
import { RuleDialog, type RuleDraft } from '@/components/RuleDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { db } from '@/db/db'
import { listActive } from '@/db/records'
import type { Rule } from '@/db/types'
import { useLookups } from '@/hooks/useLookups'
import { deleteRule, normalizeText, restoreRule } from '@/rules/engine'
import { CategoryTabs } from './CategoryTabs'
import { ruleSummary } from './CategoryDialog'

/** Every rule in one list: see what each one does, edit it or delete it. */
export function RulesPage() {
  const { rules, categoryById } = useLookups()
  const txs = useLiveQuery(() => listActive(db.transactions))
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [q, setQ] = useState('')
  const query = normalizeText(useDeferredValue(q))

  // How many transactions each rule categorizes right now.
  const usage = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of txs ?? []) if (t.ruleId && t.categorySource === 'rule') map.set(t.ruleId, (map.get(t.ruleId) ?? 0) + 1)
    return map
  }, [txs])

  const groups = useMemo(() => {
    const visible = rules
      .filter((r) => !query || normalizeText(`${r.pattern} ${categoryById.get(r.categoryId)?.name ?? ''}`).includes(query))
      .sort((a, b) => (categoryById.get(a.categoryId)?.name ?? '').localeCompare(categoryById.get(b.categoryId)?.name ?? '') || a.pattern.localeCompare(b.pattern))
    return [
      { key: 'mine', title: 'Your rules', hint: 'Run first, so they win over built-in ones.', items: visible.filter((r) => !r.builtin) },
      { key: 'builtin', title: 'Built-in', hint: 'Common Portuguese merchants. Edit or delete any of them.', items: visible.filter((r) => r.builtin) },
    ].filter((g) => g.items.length > 0)
  }, [rules, query, categoryById])

  const remove = async (r: Rule) => {
    const changed = await deleteRule(db, r.id)
    toast.success(`Rule “${r.pattern}” deleted`, {
      description: changed ? `${changed} transaction${changed === 1 ? '' : 's'} recategorized.` : undefined,
      action: { label: 'Undo', onClick: () => void restoreRule(db, r.id) },
    })
  }

  return (
    <>
      <PageHeader
        title="Rules"
        description={`${rules.length} rules put transactions in a category automatically. Ones you set by hand are never changed.`}
        actions={
          <Button onClick={() => setDraft({ field: 'description', operator: 'contains', pattern: '', categoryId: '' })}>
            <Plus aria-hidden /> New rule
          </Button>
        }
      />
      <CategoryTabs />

      {rules.length > 0 && (
        <div className="relative mb-4 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search rules" placeholder="Search rules or categories…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
      )}

      {!txs ? (
        <Surface className="space-y-3 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </Surface>
      ) : rules.length === 0 ? (
        <EmptyState icon={Wand2} title="No rules yet">
          Set a category on a transaction and the app offers to turn it into a rule.
        </EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState icon={Search} title="No rule matches" actions={<Button variant="outline" onClick={() => setQ('')}>Clear search</Button>}>
          Try another word.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`rules-${g.key}`}>
              <div className="mb-3">
                <h2 id={`rules-${g.key}`} className="flex items-baseline gap-2 text-sm font-semibold">
                  {g.title} <span className="font-normal text-muted-foreground tabular-nums">{g.items.length}</span>
                </h2>
                <p className="text-xs text-muted-foreground">{g.hint}</p>
              </div>
              <Surface className="overflow-clip">
                <ul className="divide-y">
                  {g.items.map((r) => {
                    const category = categoryById.get(r.categoryId)
                    const used = usage.get(r.id) ?? 0
                    return (
                      <li key={r.id} className="flex items-center gap-2 py-1 pr-2 pl-4">
                        <button
                          type="button"
                          onClick={() => setDraft(r)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Edit rule ${ruleSummary(r)}, sets ${category?.name ?? 'a deleted category'}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                              <span className="truncate">{ruleSummary(r)}</span>
                              {r.builtin && <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              <span className="sm:hidden">{category?.name ?? 'Deleted category'} · </span>
                              {used ? `${used} transaction${used === 1 ? '' : 's'}` : 'Matches nothing right now'}
                            </span>
                          </span>
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <Badge variant="secondary" className="hidden max-w-40 shrink-0 gap-1.5 sm:inline-flex">
                            <CategoryIcon category={category} size="sm" />
                            <span className="truncate">{category?.name ?? 'Deleted'}</span>
                          </Badge>
                          <span className="sm:hidden">
                            <CategoryIcon category={category} size="sm" />
                          </span>
                        </button>
                        <Button variant="ghost" size="icon" aria-label={`Edit rule ${r.pattern}`} onClick={() => setDraft(r)} className="hidden sm:inline-flex">
                          <Pencil aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Delete rule ${r.pattern}`} onClick={() => void remove(r)}>
                          <Trash2 aria-hidden />
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </Surface>
            </section>
          ))}
        </div>
      )}

      <RuleDialog draft={draft} onClose={() => setDraft(null)} />
    </>
  )
}
