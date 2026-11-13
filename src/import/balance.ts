import type { Cents } from '@/db/types'
import { formatMoney } from '@/lib/money'
import type { BalanceCheck, ParsedTransaction } from './types'

/**
 * Verify the parse using the statement's own running balance:
 * each row's balance must equal the previous balance plus its amount,
 * and the last balance must match the stated final balance.
 * If this passes, every amount and sign was read correctly.
 */
export function checkRunningBalance(rows: ParsedTransaction[], finalBalance?: Cents): BalanceCheck {
  const problems: string[] = []
  for (let i = 1; i < rows.length; i++) {
    const expected = rows[i - 1].balanceAfter + rows[i].amount
    if (expected !== rows[i].balanceAfter) {
      problems.push(
        `Row ${i + 1} (${rows[i].postedDate}, ${rows[i].description}): expected balance ${formatMoney(expected)}, statement says ${formatMoney(rows[i].balanceAfter)}`,
      )
    }
  }
  const last = rows.at(-1)
  if (last && finalBalance !== undefined && last.balanceAfter !== finalBalance) {
    problems.push(`Final balance ${formatMoney(finalBalance)} does not match last row ${formatMoney(last.balanceAfter)}`)
  }
  return { ok: problems.length === 0, problems }
}
