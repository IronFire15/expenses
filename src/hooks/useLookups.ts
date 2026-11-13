import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '@/db/db'
import { listActive } from '@/db/records'
import type { Account, Category, Rule } from '@/db/types'

const EMPTY: never[] = []

/** Live categories, accounts and rules with id → record maps. */
export function useLookups() {
  const categories = useLiveQuery(() => listActive(db.categories)) ?? (EMPTY as Category[])
  const accounts = useLiveQuery(() => listActive(db.accounts)) ?? (EMPTY as Account[])
  const rules = useLiveQuery(() => listActive(db.rules)) ?? (EMPTY as Rule[])

  return useMemo(
    () => ({
      categories: [...categories].sort((a, b) => a.name.localeCompare(b.name)),
      accounts,
      rules,
      categoryById: new Map(categories.map((c) => [c.id, c])),
      accountById: new Map(accounts.map((a) => [a.id, a])),
      ruleById: new Map(rules.map((r) => [r.id, r])),
    }),
    [categories, accounts, rules],
  )
}
