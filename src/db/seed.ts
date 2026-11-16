import type { ExpensesDB } from './db'
import { makeRecord } from './records'
import type { Category, CategoryType, Rule, RuleDirection } from './types'

type CategorySeed = [id: string, name: string, type: CategoryType, color: string, icon: string]

/**
 * Starter categories. IDs are fixed (not random) so two devices that both seed
 * produce the same records and the sync merges them cleanly.
 */
export const DEFAULT_CATEGORIES: CategorySeed[] = [
  ['cat-housing', 'Housing', 'expense', '#6366f1', 'house'],
  ['cat-utilities', 'Utilities', 'expense', '#0ea5e9', 'zap'],
  ['cat-groceries', 'Groceries', 'expense', '#22c55e', 'shopping-cart'],
  ['cat-restaurants', 'Restaurants & Cafés', 'expense', '#f97316', 'utensils'],
  ['cat-transport', 'Transport', 'expense', '#eab308', 'bus'],
  ['cat-car', 'Car', 'expense', '#a16207', 'car'],
  ['cat-health', 'Health', 'expense', '#ef4444', 'heart-pulse'],
  ['cat-fitness', 'Fitness', 'expense', '#06b6d4', 'dumbbell'],
  ['cat-shopping', 'Shopping', 'expense', '#ec4899', 'shopping-bag'],
  ['cat-subscriptions', 'Subscriptions', 'expense', '#8b5cf6', 'repeat'],
  ['cat-entertainment', 'Entertainment', 'expense', '#d946ef', 'clapperboard'],
  ['cat-travel', 'Travel', 'expense', '#14b8a6', 'plane'],
  ['cat-education', 'Education', 'expense', '#3b82f6', 'graduation-cap'],
  ['cat-personal-care', 'Personal care', 'expense', '#f43f5e', 'sparkles'],
  ['cat-gifts', 'Gifts & Donations', 'expense', '#e11d48', 'gift'],
  ['cat-fees', 'Fees & Taxes', 'expense', '#64748b', 'landmark'],
  ['cat-other', 'Other', 'expense', '#94a3b8', 'circle-help'],
  ['cat-salary', 'Salary', 'income', '#16a34a', 'briefcase'],
  ['cat-refunds', 'Refunds', 'income', '#10b981', 'undo-2'],
  ['cat-interest', 'Interest', 'income', '#059669', 'percent'],
  ['cat-other-income', 'Other income', 'income', '#34d399', 'plus-circle'],
  ['cat-transfer', 'Transfer', 'transfer', '#71717a', 'arrow-left-right'],
  ['cat-investments', 'Investments', 'transfer', '#0d9488', 'trending-up'],
]

/**
 * Built-in rules: bank transfer patterns and common merchants in Portugal.
 * Matched as whole words, ignoring case and accents. Priority 900+ so your own rules (100) win.
 * Order inside a category doesn't matter; across categories, earlier entries get a lower priority number
 * (e.g. "uber eats" must beat "uber").
 */
const BUILTIN_RULES: [categoryId: string, patterns: string[], direction?: RuleDirection][] = [
  // Moey: "benef iguais" = same person on both sides → money from your own account at another bank.
  ['cat-transfer', ['benef iguais']],
  ['cat-investments', ['xtb', 'trading 212', 'degiro', 'interactive brokers', 'etoro', 'lightyear', 'raize', 'certificados de aforro']],
  ['cat-restaurants', ['uber eats', 'bolt food', 'glovo', 'mcdonalds', 'mcdonald s', 'burger king', 'kfc', 'telepizza', 'pizza hut', 'starbucks', 'h3', 'vitaminas', 'padaria', 'pastelaria', 'restaurante', 'cafe', 'tasca']],
  ['cat-subscriptions', ['together price', 'netflix', 'spotify', 'disney plus', 'disney', 'hbo', 'max com', 'youtube premium', 'amazon prime', 'prime video', 'apple com bill', 'icloud', 'google one', 'openai', 'chatgpt', 'claude ai', 'anthropic', 'patreon']],
  ['cat-groceries', ['continente', 'pingo doce', 'lidl', 'aldi', 'mercadona', 'intermarche', 'minipreco', 'auchan', 'froiz', 'spar', 'meu super', 'amanhecer', 'supermercado', 'hipermercado']],
  ['cat-transport', ['uber', 'bolt', 'free now', 'cp comboios', 'comboios de portugal', 'metro do porto', 'metropolitano', 'carris', 'stcp', 'fertagus', 'flixbus', 'rede expressos', 'navegante', 'andante']],
  ['cat-car', ['galp', 'repsol', 'bp', 'prio', 'cepsa', 'via verde', 'emel', 'saba', 'empark', 'iuc', 'seguro auto']],
  ['cat-utilities', ['edp', 'endesa', 'goldenergy', 'iberdrola', 'epal', 'aguas do porto', 'smas', 'meo', 'nos comunicacoes', 'vodafone', 'nowo', 'digi', 'galp energia']],
  ['cat-fitness', ['ginasio', 'gym', 'fitness', 'holmes place', 'solinca', 'fitness up', 'go fit', 'virgin active', 'crossfit', 'piscina']],
  ['cat-health', ['farmacia', 'wells', 'cuf', 'lusiadas', 'luz saude', 'trofa saude', 'clinica', 'dentista']],
  ['cat-shopping', ['worten', 'fnac', 'ikea', 'zara', 'primark', 'decathlon', 'amazon', 'aliexpress', 'shein', 'leroy merlin', 'sport zone', 'el corte ingles', 'radio popular', 'mediamarkt']],
  ['cat-entertainment', ['cinema', 'cinemas nos', 'uci', 'steam', 'playstation', 'nintendo', 'ticketline', 'bol pt']],
  ['cat-travel', ['ryanair', 'easyjet', 'tap air', 'booking com', 'airbnb', 'hotel', 'vueling']],
  ['cat-personal-care', ['barbearia', 'cabeleireiro', 'barbershop']],
  ['cat-fees', ['comissao', 'imposto do selo', 'manutencao de conta', 'anuidade']],
  ['cat-salary', ['vencimento', 'ordenado', 'salario'], 'in'],
]

function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

export function defaultRules(): Rule[] {
  return BUILTIN_RULES.flatMap(([categoryId, patterns, direction], i) =>
    patterns.map((pattern) =>
      makeRecord<Rule>(
        {
          id: `builtin-${slug(categoryId.replace('cat-', ''))}-${slug(pattern)}`,
          field: 'description',
          operator: 'word',
          pattern,
          categoryId,
          priority: 900 + i,
          direction,
          builtin: true,
        },
        0, // timestamp 0: any edit, on any device, wins over the pristine default
      ),
    ),
  )
}

/**
 * Built-in rules that were replaced by a newer default (e.g. gym rules moved from Health to Fitness).
 * Retired only if never edited (updatedAt 0), so a rule you changed is left alone.
 */
const RETIRED_RULE_IDS = [
  'builtin-health-ginasio',
  'builtin-health-fitness',
  'builtin-health-holmes-place',
  'builtin-health-solinca',
  'builtin-health-fitness-up',
]

/**
 * Adds any default category or rule whose id doesn't exist yet, and retires replaced defaults.
 * Safe on every app start. Deleted defaults stay deleted: their tombstone still exists, so they're not re-added.
 */
export function defaultCategories(now = 0): Category[] {
  return DEFAULT_CATEGORIES.map(([id, name, type, color, icon]) => makeRecord<Category>({ id, name, type, color, icon }, now))
}

export async function seedDefaults(db: ExpensesDB): Promise<number> {
  return db.transaction('rw', db.categories, db.rules, async () => {
    const categories = defaultCategories()
    const haveCats = new Set(await db.categories.toCollection().primaryKeys())
    const haveRules = new Set(await db.rules.toCollection().primaryKeys())
    const newCats = categories.filter((c) => !haveCats.has(c.id))
    const newRules = defaultRules().filter((r) => !haveRules.has(r.id))
    await db.categories.bulkAdd(newCats)
    await db.rules.bulkAdd(newRules)
    const retired = (await db.rules.bulkGet(RETIRED_RULE_IDS)).filter((r): r is Rule => !!r && !r.deleted && r.updatedAt === 0)
    await db.rules.bulkPut(retired.map((r) => ({ ...r, deleted: true, updatedAt: Date.now() })))
    return newCats.length + newRules.length + retired.length
  })
}
