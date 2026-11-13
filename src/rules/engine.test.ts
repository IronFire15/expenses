import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExpensesDB } from '@/db/db'
import { makeRecord } from '@/db/records'
import { DEFAULT_CATEGORIES, defaultRules, seedDefaults } from '@/db/seed'
import type { Category, Rule, Transaction } from '@/db/types'
import { computeCategorization, findTransferPairs, matchRule, parseRange, recategorizeAll, setCategoryManually, suggestPattern } from './engine'

const tx = (over: Partial<Transaction>): Transaction =>
  makeRecord<Transaction>({ accountId: 'a', date: '2026-01-10', description: '', amount: -100, tags: [], ...over })
const rule = (over: Partial<Rule>): Rule =>
  makeRecord<Rule>({ field: 'description', operator: 'contains', pattern: '', categoryId: 'cat-other', priority: 100, ...over })
const categories = DEFAULT_CATEGORIES.map(([id, name, type, color]) => makeRecord<Category>({ id, name, type, color }, 0))

describe('matchRule', () => {
  it('ignores case and accents', () => {
    expect(matchRule(rule({ pattern: 'credito' }), tx({ description: 'Trf CRÉDITO intrab' }))).toBe(true)
  })
  it('"word" matches whole words only', () => {
    const r = rule({ operator: 'word', pattern: 'nos' })
    expect(matchRule(r, tx({ description: 'PAG NOS COMUNICACOES' }))).toBe(true)
    expect(matchRule(r, tx({ description: 'JOAO SANTOS' }))).toBe(false)
  })
  it('respects direction and account', () => {
    expect(matchRule(rule({ pattern: 'x', direction: 'in' }), tx({ description: 'x', amount: -5 }))).toBe(false)
    expect(matchRule(rule({ pattern: 'x', accountId: 'b' }), tx({ description: 'x' }))).toBe(false)
  })
  it('matches amount ranges', () => {
    expect(parseRange('-1000..-500')).toEqual([-1000, -500])
    expect(matchRule(rule({ field: 'amount', operator: 'between', pattern: '-1000..-500' }), tx({ amount: -700 }))).toBe(true)
    expect(matchRule(rule({ field: 'amount', operator: 'between', pattern: '1000..' }), tx({ amount: 500 }))).toBe(false)
  })
  it('treats an invalid regex as no match instead of crashing', () => {
    expect(matchRule(rule({ operator: 'regex', pattern: '([' }), tx({ description: '([' }))).toBe(false)
  })
})

describe('built-in rules on real Moey descriptions', () => {
  const plan = (description: string, amount = -100) =>
    computeCategorization([tx({ id: 't', description, amount })], defaultRules(), categories).get('t')?.categoryId

  it.each([
    ['Trf crédito intrab benef iguais RODRIGO PINTO DE SOUSA', 10000, 'cat-transfer'],
    ['Trf imediata Xtb sa', -15000, 'cat-investments'],
    ['COMPRA TOGETHER PRICE 5849280', -715, 'cat-subscriptions'],
    ['COMPRA UBER EATS 123', -1500, 'cat-restaurants'],
    ['COMPRA UBER 123', -900, 'cat-transport'],
    ['COMPRA PINGO DOCE LISBOA', -2300, 'cat-groceries'],
    ['DD SOLINCA HEALTH FITNESS', -3500, 'cat-fitness'],
    ['FARMACIA CENTRAL', -1200, 'cat-health'],
    ['Trf imediata JOAO SANTOS', -2000, undefined],
  ])('%s → %s', (description, amount, expected) => {
    expect(plan(description, amount)).toBe(expected)
  })
})

describe('transfer pairs', () => {
  it('pairs opposite amounts in different accounts within 3 days', () => {
    const out = tx({ id: 'o', accountId: 'moey', amount: -12500, date: '2026-01-24' })
    const inc = tx({ id: 'i', accountId: 'savings', amount: 12500, date: '2026-01-25' })
    const sameAccount = tx({ id: 's', accountId: 'moey', amount: 12500, date: '2026-01-24' })
    const tooLate = tx({ id: 'l', accountId: 'savings', amount: 12500, date: '2026-02-10' })
    expect(findTransferPairs([out, sameAccount, tooLate, inc])).toEqual([['o', 'i']])
  })

  it('wins over rules, and manual choices win over everything', () => {
    const out = tx({ id: 'o', accountId: 'moey', amount: -12500, description: 'Trsf.p/Seguro Auto' })
    const inc = tx({ id: 'i', accountId: 'savings', amount: 12500, description: 'TRSF.P/SEGURO AUTO' })
    const manual = tx({ id: 'm', description: 'COMPRA LIDL', categoryId: 'cat-gifts', categorySource: 'manual' })
    const plan = computeCategorization([out, inc, manual], defaultRules(), categories)
    expect(plan.get('o')).toMatchObject({ categoryId: 'cat-transfer', categorySource: 'transfer', transferPairId: 'i' })
    expect(plan.has('m')).toBe(false)
  })
})

describe('suggestPattern', () => {
  it.each([
    ['COMPRA TOGETHER PRICE 5849280', 'together price'],
    ['DD-00019338002-EFIT UNIPE', 'efit unipe'],
    ['Trf imediata ANA SILVA', 'ana silva'],
    ['Trf crédito intrab benef diferentes CARLOS', 'carlos'],
    ['COMPRA DOLINAS CLIM 8566786/02', 'dolinas clim'],
  ])('%s → %s', (input, expected) => expect(suggestPattern(input)).toBe(expected))
})

describe('database', () => {
  let db: ExpensesDB
  beforeEach(async () => {
    db = new ExpensesDB(`test-${crypto.randomUUID()}`)
    await db.open()
    await seedDefaults(db)
  })
  afterEach(() => db.delete())

  it('recategorizes, keeps manual choices, and hands back to rules on reset', async () => {
    await db.transactions.bulkAdd([tx({ id: 'a', description: 'COMPRA LIDL' }), tx({ id: 'b', description: 'COMPRA LIDL' })])
    expect(await recategorizeAll(db)).toBe(2)
    expect((await db.transactions.get('a'))?.categoryId).toBe('cat-groceries')

    await setCategoryManually(db, ['a'], 'cat-gifts')
    expect(await recategorizeAll(db)).toBe(0)
    expect(await db.transactions.get('a')).toMatchObject({ categoryId: 'cat-gifts', categorySource: 'manual' })

    await setCategoryManually(db, ['a'], null)
    expect(await db.transactions.get('a')).toMatchObject({ categoryId: 'cat-groceries', categorySource: 'rule' })
  })

  it('a deleted rule stops applying', async () => {
    await db.transactions.add(tx({ id: 'a', description: 'COMPRA LIDL' }))
    await recategorizeAll(db)
    const r = await db.rules.get('builtin-groceries-lidl')
    await db.rules.put({ ...r!, deleted: true, updatedAt: Date.now() })
    await recategorizeAll(db)
    expect((await db.transactions.get('a'))?.categoryId).toBeUndefined()
  })
})
