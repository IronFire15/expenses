import type { ExpensesDB } from '@/db/db'
import type { Budget, Category, Cents, Transaction } from '@/db/types'
import { isCounted } from '@/transactions/split'

export const DEFAULT_ALERTS = [0.8, 1]

/**
 * One budget per category, with a fixed id: two devices that create a budget for the same
 * category write the same record, so sync merges them instead of keeping two.
 */
export const budgetId = (categoryId: string) => `budget-${categoryId}`

export type BudgetLevel = 'ok' | 'near' | 'over'

export interface BudgetStatus {
  budget: Budget
  category?: Category
  spent: Cents
  /** spent / budget, can go above 1. */
  ratio: number
  left: Cents
  level: BudgetLevel
}

/** The category and its subcategories (a budget on "Car" also covers "Car › Fuel"). */
function categoryFamily(categoryId: string, categories: Category[]): Set<string> {
  const ids = new Set([categoryId])
  let grew = true
  while (grew) {
    grew = false
    for (const c of categories) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id)
        grew = true
      }
    }
  }
  return ids
}

/** Net spending in a set of categories during one month ("YYYY-MM"). Refunds in the category reduce it. */
export function spentInMonth(txs: Transaction[], categoryIds: Set<string>, month: string): Cents {
  let spent = 0
  for (const t of txs) {
    if (!isCounted(t) || !t.categoryId || !categoryIds.has(t.categoryId) || !t.date.startsWith(month)) continue
    spent -= t.amount
  }
  return Math.max(0, spent)
}

export function levelFor(ratio: number, alertAt: number[] = DEFAULT_ALERTS): BudgetLevel {
  const sorted = [...alertAt].sort((a, b) => a - b)
  const over = sorted.at(-1) ?? 1
  const near = sorted.length > 1 ? sorted[0] : 0.8
  if (ratio >= over) return 'over'
  if (ratio >= near) return 'near'
  return 'ok'
}

/** Every live budget with what was spent against it in `month`, worst first. */
export function budgetStatuses(budgets: Budget[], txs: Transaction[], categories: Category[], month: string): BudgetStatus[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const rank: Record<BudgetLevel, number> = { over: 0, near: 1, ok: 2 }
  return budgets
    .filter((b) => !b.deleted && b.monthlyAmount > 0 && !byId.get(b.categoryId)?.deleted)
    .map((budget) => {
      const spent = spentInMonth(txs, categoryFamily(budget.categoryId, categories), month)
      const ratio = spent / budget.monthlyAmount
      return { budget, category: byId.get(budget.categoryId), spent, ratio, left: budget.monthlyAmount - spent, level: levelFor(ratio, budget.alertAt) }
    })
    .sort((a, b) => rank[a.level] - rank[b.level] || b.ratio - a.ratio)
}

/**
 * Average monthly spending in a category over the given months (those with statements),
 * rounded up to whole euros: a starting point when creating a budget.
 */
export function suggestBudget(txs: Transaction[], categoryId: string, categories: Category[], months: string[]): Cents {
  if (!months.length) return 0
  const family = categoryFamily(categoryId, categories)
  const total = months.reduce((s, m) => s + spentInMonth(txs, family, m), 0)
  return Math.ceil(total / months.length / 100) * 100
}

/** Create or change the budget for a category. An amount of 0 removes it. */
export async function setBudget(db: ExpensesDB, categoryId: string, monthlyAmount: Cents): Promise<void> {
  const id = budgetId(categoryId)
  const existing = await db.budgets.get(id)
  const now = Date.now()
  if (monthlyAmount <= 0) {
    if (existing && !existing.deleted) await db.budgets.put({ ...existing, deleted: true, updatedAt: now })
    return
  }
  await db.budgets.put({
    id,
    categoryId,
    monthlyAmount,
    alertAt: existing?.alertAt ?? DEFAULT_ALERTS,
    deleted: false,
    updatedAt: now,
  })
}
