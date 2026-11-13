import { groupLines } from '../lines'
import type { ParsedStatement, StatementParser, TextItem } from '../types'
import { moeyParser } from './moey'

/** Add a parser here for each new bank. Order matters only if two banks could match the same file. */
export const PARSERS: StatementParser[] = [moeyParser]

export const SUPPORTED_BANKS = PARSERS.map((p) => p.bank)

export class UnsupportedStatementError extends Error {
  constructor() {
    super(`This file isn't from a supported bank yet. Supported: ${SUPPORTED_BANKS.join(', ')}.`)
    this.name = 'UnsupportedStatementError'
  }
}

export function parseStatementText(items: TextItem[]): ParsedStatement {
  const lines = groupLines(items)
  const parser = PARSERS.find((p) => p.detect(lines))
  if (!parser) throw new UnsupportedStatementError()
  return parser.parse(lines)
}
