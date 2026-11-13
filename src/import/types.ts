import type { AccountType, Cents, ISODate } from '@/db/types'

/** One piece of text from a PDF page, in PDF coordinates (origin bottom-left). */
export interface TextItem {
  str: string
  x: number
  y: number
  page: number
}

/** Text items that share a baseline, sorted left to right. */
export interface Line {
  page: number
  y: number
  items: TextItem[]
  text: string
}

export interface ParsedTransaction {
  date: ISODate
  postedDate: ISODate
  description: string
  amount: Cents
  balanceAfter: Cents
}

export interface BalanceCheck {
  ok: boolean
  /** Human-readable problems, e.g. "Row 4 (12-01-2026): expected balance 93,15, statement says 95,15". */
  problems: string[]
}

export interface ParsedSection {
  /** Stable per bank + account, used to match an existing account (e.g. "moey|PT50…|current"). */
  matchKey: string
  name: string
  type: AccountType
  transactions: ParsedTransaction[]
  finalBalance?: Cents
  check: BalanceCheck
}

export interface ParsedStatement {
  bank: string
  currency: string
  periodFrom?: ISODate
  periodTo?: ISODate
  sections: ParsedSection[]
}

export interface StatementParser {
  bank: string
  /** Cheap check on the extracted lines: is this file from this bank? */
  detect(lines: Line[]): boolean
  parse(lines: Line[]): ParsedStatement
}
