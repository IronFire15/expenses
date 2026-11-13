import type { Cents } from '../db/types'

export const DEFAULT_LOCALE = 'pt-PT'
export const DEFAULT_CURRENCY = 'EUR'

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, locale: string, signed: boolean) {
  const key = `${locale}|${currency}|${signed}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, signDisplay: signed ? 'exceptZero' : 'auto' })
    formatters.set(key, f)
  }
  return f
}

export function formatMoney(cents: Cents, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE): string {
  return formatter(currency, locale, false).format(cents / 100)
}

/** Always shows the sign: "+100,00 €" / "-7,15 €". For transaction amounts. */
export function formatSigned(cents: Cents, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE): string {
  return formatter(currency, locale, true).format(cents / 100)
}

/**
 * Parse a bank amount string into cents.
 * Handles "1.234,56", "1,234.56", "-12,30", "12.30-", "(12.30)", "€ 12,30".
 */
export function parseAmount(raw: string, decimalSeparator: ',' | '.'): Cents | null {
  let s = raw.trim()
  if (!s) return null
  let negative = false
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.endsWith('-')) {
    negative = true
    s = s.slice(0, -1)
  }
  s = s.replace(/[^\d.,-]/g, '')
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  }
  const thousands = decimalSeparator === ',' ? '.' : ','
  s = s.split(thousands).join('').replace(decimalSeparator, '.')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const cents = Math.round(Number(s) * 100)
  return negative ? -cents : cents
}

/**
 * Parse an amount typed by hand: "12,30", "12.30", "1 234,5", "1.234,56". Returns positive cents or null.
 * The last "," or "." followed by 1–2 digits is the decimal mark; other separators are thousands.
 */
export function parseTypedAmount(raw: string): Cents | null {
  const s = raw.replace(/[\s€]/g, '')
  if (!s) return null
  const m = /^(\d[\d.,]*?)(?:[.,](\d{1,2}))?$/.exec(s)
  if (!m) return null
  const whole = m[1].replace(/[.,]/g, '')
  if (!/^\d+$/.test(whole)) return null
  return Number(whole) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0)
}

/** Cents → "12,30" for an input field (no currency sign, no thousands separator). */
export function centsToInput(cents: Cents): string {
  return (Math.abs(cents) / 100).toFixed(2).replace('.', ',')
}
