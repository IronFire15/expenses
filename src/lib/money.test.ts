import { describe, expect, it } from 'vitest'
import { centsToInput, formatMoney, parseAmount, parseTypedAmount } from './money'

describe('parseAmount', () => {
  it.each([
    ['1.234,56', ',', 123456],
    ['-12,30', ',', -1230],
    ['12,30-', ',', -1230],
    ['(12,30)', ',', -1230],
    ['€ 12,30', ',', 1230],
    ['1,234.56', '.', 123456],
    ['-0.99', '.', -99],
    ['42', '.', 4200],
  ] as const)('%s with "%s" decimals → %d', (raw, sep, expected) => {
    expect(parseAmount(raw, sep)).toBe(expected)
  })

  it('returns null for empty or garbage input', () => {
    expect(parseAmount('', ',')).toBeNull()
    expect(parseAmount('abc', ',')).toBeNull()
  })
})

describe('formatMoney', () => {
  it('formats cents as euros in pt-PT', () => {
    // Intl uses a non-breaking space before the € sign.
    expect(formatMoney(123456).replace(/\s/g, ' ')).toBe('1234,56 €')
  })
})

describe('parseTypedAmount', () => {
  it('reads hand-typed amounts', () => {
    expect(['12,30', '12.30', '12,3', '12', '1 234,56', '1.234,56', '1,234.56', '1234', '0,05', '€ 7'].map(parseTypedAmount)).toEqual([
      1230, 1230, 1230, 1200, 123456, 123456, 123456, 123400, 5, 700,
    ])
    expect(['', 'abc', '-5', '1,2,3,4x'].map(parseTypedAmount)).toEqual([null, null, null, null])
    expect(centsToInput(-123456)).toBe('1234,56')
  })
})
