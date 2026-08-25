/**
 * Reconciliation results -> an .xlsx workbook, generated in the browser.
 *
 * Mirrors the sheet structure of ledger_reconciler/report.py so the two
 * outputs are comparable: a Summary sheet and a Detail sheet with the same
 * columns in the same order.
 *
 * One deliberate difference. The Python version colour-fills rows via
 * openpyxl; SheetJS's community build does not write cell styles, so rows
 * here are not filled. Column widths are set and DO reach the file, so the
 * sheet still opens readable. The Status column carries the meaning
 * either way, which is why this is a cosmetic loss rather than a
 * functional one.
 */

import * as XLSX from 'xlsx'
import { toISO } from '../domain/dates'
import type { MatchResult } from '../domain/types'
import { FLAG_LABELS, summarise } from '../ui/pipeline'

/**
 * No apostrophe-escaping here, deliberately, and the reasoning is worth
 * keeping because the Python side of this project does exactly the
 * opposite.
 *
 * openpyxl types any string starting with "=" as a FORMULA, so the Python
 * exporter has to prefix an apostrophe to force it back to a label. SheetJS
 * does not: aoa_to_sheet writes every string as a typed string cell, and in
 * the xlsx format a cell is only a formula when it carries an explicit <f>
 * element. Verified by inspecting the emitted sheet XML for both an escaped
 * and an unescaped "=SUM(A1:A9)": zero <f> elements either way.
 *
 * So porting the guard across would not have hardened anything. It would
 * have corrupted data, because SheetJS stores the guarding apostrophe as
 * part of the string and the user sees '=SUM(A1:A9) in the cell.
 *
 * This does NOT generalise to CSV. A CSV has no type information, so the
 * spreadsheet application parses cell content on open and a leading =, +,
 * - or @ genuinely does become a formula. If a CSV export is ever added
 * here, the escaping has to come back for that path only.
 */
function cellText(value: string | null | undefined): string {
  return value ?? ''
}

const DETAIL_HEADERS = [
  'Status',
  'Invoice #',
  'Vendor',
  'Invoice Date',
  'Invoice Amount',
  'Ledger Row',
  'Ledger Date',
  'Ledger Description',
  'Ledger Amount',
  'Source File',
]

/** Column widths, in characters. Written into the file even though
 * SheetJS's own reader discards them on round-trip. */
const DETAIL_WIDTHS = [26, 14, 26, 13, 15, 11, 13, 34, 14, 22]

function buildDetailSheet(results: MatchResult[]): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [DETAIL_HEADERS]

  for (const r of results) {
    const inv = r.invoice
    const row = r.ledgerRow
    rows.push([
      // Plain-language status rather than the internal flag names: this
      // sheet is read by a person, not parsed by code.
      r.flags.length === 0
        ? 'matched'
        : r.flags.map((f) => FLAG_LABELS[f] ?? f).join(', '),
      cellText(inv?.invoiceNumber),
      cellText(inv?.vendor),
      inv?.invoiceDate ? toISO(inv.invoiceDate) : '',
      inv?.amount ?? null,
      row?.rowIndex ?? null,
      row?.ledgerDate ? toISO(row.ledgerDate) : '',
      cellText(row?.description),
      row?.amount ?? null,
      cellText(inv?.sourceFile),
    ])
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = DETAIL_WIDTHS.map((wch) => ({ wch }))
  // Keeps the header visible when scrolling a long reconciliation.
  sheet['!freeze'] = { xSplit: '0', ySplit: '1' }
  return sheet
}

function buildSummarySheet(results: MatchResult[]): XLSX.WorkSheet {
  const s = summarise(results)
  const rows: (string | number)[][] = [
    ['Reconciliation Summary'],
    [],
    ['Total items', s.total],
    ['Matched clean', s.matched],
    ['Flagged', s.flagged],
    ['Match rate', s.total === 0 ? 'n/a' : `${Math.round(s.matchRate * 100)}%`],
    [],
  ]
  for (const [flag, n] of Object.entries(s.counts).sort()) {
    rows.push([`  ${FLAG_LABELS[flag] ?? flag}`, n])
  }
  rows.push([])
  rows.push(['Generated', new Date().toISOString().slice(0, 19).replace('T', ' ')])
  rows.push(['Note', 'Flagged items are records to review, not confirmed errors.'])

  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = [{ wch: 26 }, { wch: 58 }]
  return sheet
}

export function buildWorkbook(results: MatchResult[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(results), 'Summary')
  XLSX.utils.book_append_sheet(wb, buildDetailSheet(results), 'Detail')
  return wb
}

/**
 * The workbook as bytes, for tests and for the download.
 *
 * `type: 'array'` returns an ArrayBuffer, not a Uint8Array, despite the
 * name. SheetJS types the return loosely enough that annotating it as
 * Uint8Array compiles, and the lie only surfaces at the Blob boundary,
 * where a Uint8Array<ArrayBufferLike> is rejected because it might be
 * backed by a SharedArrayBuffer.
 */
export function workbookBytes(results: MatchResult[]): ArrayBuffer {
  return XLSX.write(buildWorkbook(results), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/**
 * Triggers a download without a server. The blob URL is revoked afterwards
 * because it otherwise pins the whole workbook in memory for the lifetime
 * of the document.
 */
export function downloadReport(results: MatchResult[], fileName = 'reconciliation-report.xlsx'): void {
  const blob = new Blob([workbookBytes(results)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
