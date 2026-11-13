import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toTextItems } from '../pdf'
import type { TextItem } from '../types'
import { parseStatementText, UnsupportedStatementError } from './index'

/** Build a fake text layer: each row is [y, [x, text][]]. Mirrors the real Moey layout (fake people and amounts). */
function page(rows: [number, [number, string][]][], pageNo = 1): TextItem[] {
  return rows.flatMap(([y, cells]) => cells.map(([x, str]) => ({ str, x, y, page: pageNo })))
}

const HEADER: [number, string][] = [[54, 'DATA LANÇAMENTO / DATA VALOR'], [189, 'DESCRIÇÃO'], [392, 'MOVIMENTOS (+/-)'], [480, 'SALDO CONTABILÍSTICO']]

const SAMPLE = [
  ...page([
    [676, [[51, 'IBAN:'], [86, 'PT50 0000 0000 0000 0000 0000 0'], [250, 'Período']]],
    [664, [[249, '1 de Janeiro de 2026'], [336, 'û'], [348, '31 de Janeiro de 2026']]],
    [541, [[51, 'CONTA MOEY'], [121, '/ MOEY ACCOUNT']]],
    [515, HEADER],
    [482, [[54, '04-01-2026'], [105, '/'], [114, '04-01-2026'], [189, 'Trf imediata MARIA'], [430, '100,00'], [463, '-'], [537, '122,26']]],
    [472, [[188, 'SILVA']]],
    [461, [[54, '19-01-2026'], [105, '/'], [114, '17-01-2026'], [189, 'COMPRA SHOP 123'], [440, '7,15'], [463, '-'], [537, '115,11']]],
    [450, [[54, '26-01-2026'], [105, '/'], [114, '26-01-2026'], [189, 'Trf crédito intrab'], [430, '1.000,00 +'], [537, '1.115,11']]],
    [269, [[387, 'SALDO FINAL'], [537, '1.115,11']]],
    [198, [[51, 'CONTA POUPANÇA /'], [157, 'SAVINGS']]],
    [172, HEADER],
    [97, [[54, '24-01-2026'], [105, '/'], [114, '24-01-2026'], [189, 'TRSF.P/SEGURO AUTO'], [430, '125,00 +'], [537, '125,00']]],
    [88, [[32, 'ZRDDP760']]],
  ]),
  // Savings section continues on page 2 with a repeated header.
  ...page(
    [
      [681, [[51, 'CONTA POUPANÇA /'], [157, 'SAVINGS']]],
      [655, HEADER],
      [630, [[54, '30-01-2026'], [105, '/'], [114, '30-01-2026'], [189, 'LEVANT SEGURO'], [440, '25,00'], [463, '-'], [537, '100,00']]],
      [608, [[387, 'SALDO FINAL'], [533, '100,00']]],
    ],
    2,
  ),
]

describe('Moey parser', () => {
  const stmt = parseStatementText(SAMPLE)

  it('reads bank, period and both accounts', () => {
    expect(stmt.bank).toBe('Moey')
    expect(stmt).toMatchObject({ periodFrom: '2026-01-01', periodTo: '2026-01-31' })
    expect(stmt.sections.map((s) => [s.name, s.type, s.transactions.length])).toEqual([
      ['Moey', 'bank', 3],
      ['Moey Savings', 'savings', 2],
    ])
    expect(stmt.sections[0].matchKey).toBe('moey|PT50000000000000000000000|current')
  })

  it('reads amounts, signs, value dates and wrapped descriptions', () => {
    const [a, b, c] = stmt.sections[0].transactions
    expect(a).toEqual({ date: '2026-01-04', postedDate: '2026-01-04', description: 'Trf imediata MARIA SILVA', amount: -10000, balanceAfter: 12226 })
    expect(b).toMatchObject({ date: '2026-01-17', postedDate: '2026-01-19', amount: -715 })
    expect(c).toMatchObject({ amount: 100000, balanceAfter: 111511 })
  })

  it('passes the running-balance check, across pages too', () => {
    expect(stmt.sections.every((s) => s.check.ok)).toBe(true)
    expect(stmt.sections[1].finalBalance).toBe(10000)
  })

  it('flags a balance that does not add up', () => {
    const broken = SAMPLE.map((i) => (i.str === '115,11' ? { ...i, str: '116,11' } : i))
    const check = parseStatementText(broken).sections[0].check
    expect(check.ok).toBe(false)
    expect(check.problems[0]).toMatch(/Row 2/)
  })

  it('rejects files from other banks', () => {
    expect(() => parseStatementText(page([[700, [[50, 'Some other bank statement']]]]))).toThrow(UnsupportedStatementError)
  })
})

/**
 * Runs against your real statements in samples/ (git-ignored, so this is skipped on other machines).
 * Every file must parse and pass the running-balance check.
 */
const SAMPLES_DIR = join(process.cwd(), 'samples')
const samplePdfs = existsSync(SAMPLES_DIR) ? readdirSync(SAMPLES_DIR).filter((f) => f.toLowerCase().endsWith('.pdf')) : []

describe.skipIf(samplePdfs.length === 0)('real Moey samples', () => {
  it.each(samplePdfs)('%s parses and balances', async (file) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(SAMPLES_DIR, file))), isEvalSupported: false }).promise
    const items: TextItem[] = []
    for (let p = 1; p <= doc.numPages; p++) items.push(...toTextItems(await (await doc.getPage(p)).getTextContent(), p))
    await doc.destroy()

    const stmt = parseStatementText(items)
    expect(stmt.periodFrom).toMatch(/^\d{4}-\d{2}-01$/)
    expect(stmt.sections.length).toBeGreaterThanOrEqual(1)
    for (const s of stmt.sections) expect(s.check.problems).toEqual([])
    expect(stmt.sections[0].transactions.length).toBeGreaterThan(0)
  })
})
