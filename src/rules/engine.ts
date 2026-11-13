import type { ExpensesDB } from '@/db/db'
import type { Category, Rule, Transaction } from '@/db/types'

export const TRANSFER_CATEGORY_ID = 'cat-transfer'
/** Max days between the two sides of a transfer between own accounts. */
const TRANSFER_WINDOW_DAYS = 3

/** Lowercase, strip accents, turn punctuation into spaces. "Trf CRÉDITO/123" → "trf credito 123". */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

type Matchable = Pick<Transaction, 'description' | 'amount' | 'accountId'>

const regexCache = new Map<string, RegExp | null>()
function safeRegex(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(pattern, 'i'))
    } catch {
      regexCache.set(pattern, null)
    }
  }
  return regexCache.get(pattern) ?? null
}

/** "-50..-10" or "1000..": amount range in cents, open ends allowed. */
export function parseRange(pattern: string): [number, number] | null {
  const m = /^\s*(-?\d+)?\s*\.\.\s*(-?\d+)?\s*$/.exec(pattern)
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  return [m[1] !== undefined ? Number(m[1]) : -Infinity, m[2] !== undefined ? Number(m[2]) : Infinity]
}

export function matchRule(rule: Rule, tx: Matchable): boolean {
  if (rule.deleted) return false
  if (rule.accountId && rule.accountId !== tx.accountId) return false
  if (rule.direction === 'in' && tx.amount <= 0) return false
  if (rule.direction === 'out' && tx.amount >= 0) return false

  if (rule.field === 'amount' || rule.operator === 'between') {
    const range = parseRange(rule.pattern)
    return !!range && tx.amount >= range[0] && tx.amount <= range[1]
  }

  if (rule.operator === 'regex') return safeRegex(rule.pattern)?.test(tx.description) ?? false

  const text = normalizeText(tx.description)
  const pattern = normalizeText(rule.pattern)
  if (!pattern) return false
  switch (rule.operator) {
    case 'contains':
      return text.includes(pattern)
    case 'word':
      return ` ${text} `.includes(` ${pattern} `)
    case 'startsWith':
      return text.startsWith(pattern)
    case 'equals':
      return text === pattern
    default:
      return false
  }
}

export function sortRules(rules: Rule[]): Rule[] {
  // Same priority: newer rule first, so a fresh correction beats an older rule.
  return rules.filter((r) => !r.deleted).sort((a, b) => a.priority - b.priority || b.updatedAt - a.updatedAt)
}

/** First matching rule, given rules already sorted with `sortRules`. */
export function findRule(sortedRules: Rule[], tx: Matchable): Rule | undefined {
  return sortedRules.find((r) => matchRule(r, tx))
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)

/**
 * Pair money leaving one own account with the same amount arriving in another
 * own account within a few days (e.g. Moey → Moey Savings). Returns [outId, inId] pairs.
 */
export function findTransferPairs(txs: Transaction[]): [string, string][] {
  const incoming = txs.filter((t) => t.amount > 0).sort((a, b) => a.date.localeCompare(b.date))
  const outgoing = txs.filter((t) => t.amount < 0).sort((a, b) => a.date.localeCompare(b.date))
  const used = new Set<string>()
  const pairs: [string, string][] = []

  for (const out of outgoing) {
    let best: Transaction | undefined
    let bestGap = Infinity
    for (const inc of incoming) {
      if (used.has(inc.id) || inc.accountId === out.accountId || inc.amount !== -out.amount) continue
      const gap = Math.abs(dayNumber(inc.date) - dayNumber(out.date))
      if (gap <= TRANSFER_WINDOW_DAYS && gap < bestGap) {
        best = inc
        bestGap = gap
      }
    }
    if (best) {
      used.add(best.id)
      pairs.push([out.id, best.id])
    }
  }
  return pairs
}

type Categorization = Pick<Transaction, 'categoryId' | 'categorySource' | 'ruleId' | 'transferPairId'>

/**
 * Work out the automatic category for every transaction. Precedence:
 * 1. manual choice (never touched)  2. transfer pair between own accounts  3. first matching rule  4. uncategorized
 */
export function computeCategorization(txs: Transaction[], rules: Rule[], categories: Category[]): Map<string, Categorization> {
  const sorted = sortRules(rules)
  const liveCategories = new Set(categories.filter((c) => !c.deleted).map((c) => c.id))
  const active = txs.filter((t) => !t.deleted)
  // Split originals are replaced by their parts (which are always set by hand).
  const auto = active.filter((t) => t.categorySource !== 'manual' && !t.split && !t.splitOf)

  const result = new Map<string, Categorization>()
  for (const [outId, inId] of findTransferPairs(auto)) {
    const pairId = outId < inId ? outId : inId
    for (const id of [outId, inId]) {
      result.set(id, { categoryId: TRANSFER_CATEGORY_ID, categorySource: 'transfer', ruleId: undefined, transferPairId: pairId })
    }
  }
  for (const tx of auto) {
    if (result.has(tx.id)) continue
    const rule = findRule(sorted, tx)
    const usable = rule && liveCategories.has(rule.categoryId)
    result.set(
      tx.id,
      usable
        ? { categoryId: rule.categoryId, categorySource: 'rule', ruleId: rule.id, transferPairId: undefined }
        : { categoryId: undefined, categorySource: undefined, ruleId: undefined, transferPairId: undefined },
    )
  }
  return result
}

const same = (a: Transaction, c: Categorization) =>
  a.categoryId === c.categoryId && a.categorySource === c.categorySource && a.ruleId === c.ruleId && a.transferPairId === c.transferPairId

/**
 * Re-run automatic categorization over all transactions and save what changed.
 * Called after imports and whenever rules or categories change. Fast enough for tens of thousands of rows.
 */
export async function recategorizeAll(db: ExpensesDB): Promise<number> {
  return db.transaction('rw', db.transactions, db.rules, db.categories, async () => {
    const [txs, rules, categories] = await Promise.all([db.transactions.toArray(), db.rules.toArray(), db.categories.toArray()])
    const plan = computeCategorization(txs, rules, categories)
    const now = Date.now()
    const changed = txs
      .filter((t) => plan.has(t.id) && !same(t, plan.get(t.id)!))
      .map((t) => ({ ...t, ...plan.get(t.id)!, updatedAt: now }))
    if (changed.length) await db.transactions.bulkPut(changed)
    return changed.length
  })
}

/**
 * Set a category by hand. Passing `null` hands the transactions back to the rules.
 */
export async function setCategoryManually(db: ExpensesDB, ids: string[], categoryId: string | null): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const txs = (await db.transactions.bulkGet(ids)).filter((t): t is Transaction => !!t)
    const now = Date.now()
    await db.transactions.bulkPut(
      txs.map((t) =>
        categoryId === null
          ? { ...t, categorySource: undefined, categoryId: undefined, ruleId: undefined, updatedAt: now }
          : { ...t, categoryId, categorySource: 'manual' as const, ruleId: undefined, transferPairId: undefined, updatedAt: now },
      ),
    )
  })
  if (categoryId === null) await recategorizeAll(db)
}

/**
 * Suggest a rule pattern from a description: drops reference numbers and generic bank prefixes.
 * "COMPRA TOGETHER PRICE 5849280" → "together price"; "DD-00019338002-EFIT UNIPE" → "efit unipe".
 */
export function suggestPattern(description: string): string {
  const prefixes = /^(compra|pagamento|pag|dd|trf imediata|trf a credito sepa|trf credito intrab benef diferentes|trf credito intrab|trf|transferencia|levant|levantamento|mb way|mbway)\s+/
  let text = normalizeText(description)
    .split(' ')
    .filter((w) => !/\d{3,}/.test(w) && !/^\d+$/.test(w)) // reference numbers
    .join(' ')
  for (let i = 0; i < 3; i++) text = text.replace(prefixes, '')
  return text.trim() || normalizeText(description)
}

/** Delete a rule (soft, so it syncs) and re-run categorization. Returns how many transactions changed. */
export async function deleteRule(db: ExpensesDB, id: string): Promise<number> {
  const rule = await db.rules.get(id)
  if (!rule || rule.deleted) return 0
  await db.rules.put({ ...rule, deleted: true, updatedAt: Date.now() })
  return recategorizeAll(db)
}

/** Bring a deleted rule back (the Undo in the toast). */
export async function restoreRule(db: ExpensesDB, id: string): Promise<number> {
  const rule = await db.rules.get(id)
  if (!rule) return 0
  await db.rules.put({ ...rule, deleted: false, updatedAt: Date.now() })
  return recategorizeAll(db)
}
