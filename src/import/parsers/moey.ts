import type { AccountType, Cents } from '@/db/types'
import { parseAmount } from '@/lib/money'
import { checkRunningBalance } from '../balance'
import { parseDMY, parsePortugueseLongDate } from '../dates'
import type { Line, ParsedSection, ParsedTransaction, StatementParser } from '../types'

/**
 * Moey! (Crédito Agrícola) monthly PDF statement.
 *
 * Layout per account section ("CONTA MOEY", "CONTA POUPANÇA"):
 *   DATA LANÇAMENTO / DATA VALOR | DESCRIÇÃO | MOVIMENTOS (+/-) | SALDO CONTABILÍSTICO
 *   04-01-2026 / 04-01-2026      | Trf imediata …   | 100,00 -   | 122,26
 *                                | …second line of description
 *   SALDO FINAL                                                  | 93,15
 * A section can continue on the next page, where its header is repeated.
 * Column x positions are read from the header row, so small layout shifts still work.
 */

interface Columns {
  description: number
  amount: number
  balance: number
}

const DATE_RE = /^\d{2}-\d{2}-\d{4}$/
const MAX_CONTINUATION_GAP = 14 // points between a row and its wrapped description line

function sectionInfo(title: string): { key: string; name: string; type: AccountType } | null {
  const t = title.toUpperCase()
  if (t.startsWith('CONTA MOEY')) return { key: 'current', name: 'Moey', type: 'bank' }
  if (t.startsWith('CONTA POUPANÇA') || t.startsWith('CONTA POUPANCA')) return { key: 'savings', name: 'Moey Savings', type: 'savings' }
  return null
}

function readColumns(line: Line): Columns | null {
  const find = (label: string) => line.items.find((i) => i.str.toUpperCase().includes(label))?.x
  const description = find('DESCRI')
  const amount = find('MOVIMENTOS')
  const balance = find('SALDO')
  if (description === undefined || amount === undefined || balance === undefined) return null
  return { description, amount, balance }
}

/** "100,00 +" / "100,00" + "-" → signed cents. */
function parseSignedAmount(text: string): Cents | null {
  const m = /([\d.]+,\d{2})\s*([+-])/.exec(text)
  if (!m) return null
  const value = parseAmount(m[1], ',')
  if (value === null) return null
  return m[2] === '-' ? -value : value
}

function parseBalance(text: string): Cents | null {
  const t = text.replace(/\s+/g, '')
  // Negative balances may be printed as "12,30-" or "-12,30"; parseAmount handles both.
  return parseAmount(t, ',')
}

export const moeyParser: StatementParser = {
  bank: 'Moey',

  detect(lines) {
    const head = lines.slice(0, 80).map((l) => l.text.toUpperCase())
    return head.some((t) => t.includes('CONTA MOEY')) || head.some((t) => t.includes('MOEY') && t.includes('CRÉDITO AGRÍCOLA'))
  },

  parse(lines) {
    const ibanLine = lines.find((l) => l.text.startsWith('IBAN:'))
    const iban = ibanLine ? /IBAN:\s*([A-Z]{2}[\d ]+)/.exec(ibanLine.text)?.[1].replace(/\s+/g, '') : undefined

    const periodIdx = lines.findIndex((l) => l.text.includes('Período'))
    const periodLine = periodIdx >= 0 ? lines.slice(periodIdx, periodIdx + 3).find((l) => / de \d{4}.* de \d{4}/.test(l.text)) : undefined
    const periodDates = periodLine ? [...periodLine.text.matchAll(/\d{1,2} de [A-Za-zçã]+ de \d{4}/g)].map((m) => parsePortugueseLongDate(m[0])) : []

    const sections = new Map<string, ParsedSection>()
    let current: ParsedSection | null = null
    let columns: Columns | null = null
    let lastRow: { tx: ParsedTransaction; line: Line } | null = null

    for (const line of lines) {
      const first = line.items[0]

      // Section start (or the same section repeated at the top of the next page).
      const info = first && first.x < 100 ? sectionInfo(line.text) : null
      if (info) {
        const matchKey = `moey|${iban ?? 'unknown'}|${info.key}`
        current = sections.get(matchKey) ?? null
        if (!current) {
          current = { matchKey, name: info.name, type: info.type, transactions: [], check: { ok: true, problems: [] } }
          sections.set(matchKey, current)
        }
        columns = null
        lastRow = null
        continue
      }
      if (!current) continue

      if (!columns && line.text.includes('DESCRI') && line.text.includes('MOVIMENTOS')) {
        columns = readColumns(line)
        continue
      }
      if (!columns) continue

      if (line.text.startsWith('SALDO FINAL')) {
        const bal = line.items.find((i) => i.x >= columns!.balance - 20)
        if (bal) current.finalBalance = parseBalance(bal.str) ?? undefined
        current = null
        columns = null
        lastRow = null
        continue
      }

      const cols = columns
      if (first && DATE_RE.test(first.str.trim()) && first.x < cols.description) {
        const dates = line.items.filter((i) => i.x < cols.description - 5 && DATE_RE.test(i.str.trim()))
        const description = line.items.filter((i) => i.x >= cols.description - 5 && i.x < cols.amount - 5).map((i) => i.str.trim()).join(' ')
        const amountText = line.items.filter((i) => i.x >= cols.amount - 5 && i.x < cols.balance - 10).map((i) => i.str).join(' ')
        const balanceText = line.items.filter((i) => i.x >= cols.balance - 10).map((i) => i.str).join('')
        const postedDate = parseDMY(dates[0].str)
        const valueDate = dates[1] ? parseDMY(dates[1].str) : postedDate
        const amount = parseSignedAmount(amountText)
        const balanceAfter = parseBalance(balanceText)
        if (!postedDate || !valueDate || amount === null || balanceAfter === null) {
          current.check.problems.push(`Could not read row: "${line.text}"`)
          lastRow = null
          continue
        }
        const tx: ParsedTransaction = { date: valueDate, postedDate, description, amount, balanceAfter }
        current.transactions.push(tx)
        lastRow = { tx, line }
        continue
      }

      // Wrapped description: only description-column text, right under the previous row.
      const onlyDescription = line.items.every((i) => i.x >= cols.description - 10 && i.x < cols.amount - 5)
      if (lastRow && onlyDescription && line.page === lastRow.line.page && lastRow.line.y - line.y <= MAX_CONTINUATION_GAP) {
        lastRow.tx.description = `${lastRow.tx.description} ${line.text}`.replace(/\s+/g, ' ').trim()
        lastRow.line = line
        continue
      }
      lastRow = null
    }

    const parsed = [...sections.values()].map((s) => {
      const check = checkRunningBalance(s.transactions, s.finalBalance)
      return { ...s, check: { ok: check.ok && s.check.problems.length === 0, problems: [...s.check.problems, ...check.problems] } }
    })

    return {
      bank: 'Moey',
      currency: 'EUR',
      periodFrom: periodDates[0] ?? undefined,
      periodTo: periodDates[1] ?? undefined,
      sections: parsed,
    }
  },
}
