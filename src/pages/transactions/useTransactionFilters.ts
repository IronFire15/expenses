import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { Transaction } from '@/db/types'
import { normalizeText } from '@/rules/engine'

export const UNCATEGORIZED = 'none'

export interface Filters {
  q: string
  month: string // YYYY-MM or ''
  account: string
  category: string // id, UNCATEGORIZED or ''
  dir: '' | 'in' | 'out'
  tag: string
}

/** Filters live in the URL: back/forward work and a filtered view can be bookmarked. */
export function useTransactionFilters() {
  const [params, setParams] = useSearchParams()

  const filters: Filters = {
    q: params.get('q') ?? '',
    month: params.get('month') ?? '',
    account: params.get('account') ?? '',
    category: params.get('category') ?? '',
    dir: (params.get('dir') as Filters['dir']) ?? '',
    tag: params.get('tag') ?? '',
  }

  const setFilter = useCallback(
    (key: keyof Filters, value: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set(key, value)
          else next.delete(key)
          return next
        },
        { replace: key === 'q' }, // typing shouldn't flood the history
      ),
    [setParams],
  )

  const clear = useCallback(() => setParams({}), [setParams])
  const active = Object.values(filters).some(Boolean)

  return { filters, setFilter, clear, active }
}

export function applyFilters(txs: Transaction[], f: Filters): Transaction[] {
  const q = normalizeText(f.q)
  return txs.filter(
    (t) =>
      (!f.month || t.date.startsWith(f.month)) &&
      (!f.account || t.accountId === f.account) &&
      (!f.category || (f.category === UNCATEGORIZED ? !t.categoryId : t.categoryId === f.category)) &&
      (!f.dir || (f.dir === 'in' ? t.amount > 0 : t.amount < 0)) &&
      (!f.tag || t.tags.includes(f.tag)) &&
      (!q || normalizeText(`${t.description} ${t.notes ?? ''} ${t.tags.join(' ')}`).includes(q)),
  )
}

/** Months that have data, newest first, as "YYYY-MM". */
export function useMonths(txs: Transaction[] | undefined) {
  return useMemo(() => [...new Set((txs ?? []).map((t) => t.date.slice(0, 7)))].sort().reverse(), [txs])
}
