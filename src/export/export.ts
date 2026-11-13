import type { Account, Category, Transaction } from '@/db/types'
import { isCounted } from '@/transactions/split'
import { zip } from './zip'

export type Cell = string | number | null

export interface Table {
  head: string[]
  rows: Cell[][]
}

/**
 * One row per transaction as you see it in the app: split originals are replaced by their parts.
 * Amount is a plain number in euros (negative = money out), so spreadsheets can sum it.
 */
export function transactionTable(txs: Transaction[], categories: Map<string, Category>, accounts: Map<string, Account>): Table {
  const rows = txs
    .filter(isCounted)
    .sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description))
    .map((t) => {
      const cat = t.categoryId ? categories.get(t.categoryId) : undefined
      const parent = cat?.parentId ? categories.get(cat.parentId) : undefined
      const account = accounts.get(t.accountId)
      return [
        t.date,
        t.description,
        t.amount / 100,
        account?.currency ?? 'EUR',
        parent ? `${parent.name} › ${cat!.name}` : (cat?.name ?? ''),
        cat?.type === 'income' ? 'Income' : cat?.type === 'transfer' ? 'Not spending' : cat ? 'Expense' : '',
        account?.name ?? '',
        t.tags.join(', '),
        t.notes ?? '',
        t.splitOf ? 'Yes' : '',
      ]
    })
  return { head: ['Date', 'Description', 'Amount', 'Currency', 'Category', 'Type', 'Account', 'Tags', 'Notes', 'Split part'], rows }
}

/**
 * CSV for spreadsheets set to Portuguese/European format: `;` between columns and a decimal comma,
 * which is what Excel expects there. A byte-order mark makes Excel read accents (UTF-8) correctly.
 */
export function toCSV(table: Table, decimal: ',' | '.' = ','): string {
  const sep = decimal === ',' ? ';' : ','
  const cell = (v: Cell) => {
    if (v === null) return ''
    if (typeof v === 'number') return decimal === ',' ? String(v).replace('.', ',') : String(v)
    // A leading = + - @ would run as a formula in Excel: prefix it so it stays text.
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v
    return safe.includes(sep) || /["\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return '﻿' + [table.head, ...table.rows].map((r) => r.map(cell).join(sep)).join('\r\n') + '\r\n'
}

// ---------- Excel (.xlsx) ----------

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are not allowed in XML.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** ISO date → Excel serial day number (days since 1899-12-30). */
function excelDate(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A one-sheet .xlsx: bold header row, real dates, amounts as numbers with 2 decimals, frozen header,
 * autofilter. Opens in Excel, Numbers, LibreOffice and Google Sheets.
 */
export function toXlsx(table: Table, sheetName = 'Transactions'): Uint8Array {
  const widths = table.head.map((h, c) => Math.min(60, Math.max(h.length, ...table.rows.slice(0, 500).map((r) => String(r[c] ?? '').length)) + 2))
  const rowXml = (cells: Cell[], r: number, header: boolean) =>
    `<row r="${r}">${cells
      .map((v, c) => {
        const ref = `${colName(c)}${r}`
        if (v === null || v === '') return ''
        if (header) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xml(String(v))}</t></is></c>`
        if (typeof v === 'number') return `<c r="${ref}" s="2"><v>${v}</v></c>`
        if (ISO_DATE.test(v)) return `<c r="${ref}" s="3"><v>${excelDate(v)}</v></c>`
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`
      })
      .join('')}</row>`

  const lastRef = `${colName(table.head.length - 1)}${table.rows.length + 1}`
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rowXml(table.head, 1, true)}${table.rows.map((r, i) => rowXml(r, i + 2, false)).join('')}</sheetData>
<autoFilter ref="A1:${lastRef}"/>
</worksheet>`

  return zip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xml(sheetName.slice(0, 31))}'!$A$1:$${colName(table.head.length - 1)}$${table.rows.length + 1}</definedName></definedNames>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ])
}

/** Save a file through the browser's download. */
export function downloadFile(data: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type ExportFormat = 'csv' | 'xlsx'

export function exportTransactions(table: Table, format: ExportFormat, baseName: string) {
  if (format === 'csv') downloadFile(toCSV(table), `${baseName}.csv`, 'text/csv;charset=utf-8')
  else downloadFile(toXlsx(table) as Uint8Array<ArrayBuffer>, `${baseName}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}
