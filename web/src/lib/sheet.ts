/**
 * File -> cell grid, via SheetJS. The browser edge of ledger reading; the
 * column detection and row building live in domain/ledger.ts.
 *
 * Note the dependency is installed from SheetJS's own registry rather than
 * npm. The npm-published `xlsx` stopped at 0.18.5 and carries unpatched
 * prototype-pollution and ReDoS advisories, which matters here because
 * this parses spreadsheets from people we do not trust.
 */

import * as XLSX from 'xlsx'
import type { CellValue } from '../domain/ledger'

export class SheetReadError extends Error {}

/**
 * Reads the first worksheet into a dense grid, preserving blank cells so
 * column indices stay aligned with the header row.
 *
 * `cellDates: true` makes SheetJS hand back real Date objects rather than
 * the raw serial day numbers a spreadsheet actually stores. Without it a
 * date column arrives as a number like 45678, which asNumber() would
 * happily accept as an amount.
 */
export async function readSheetGrid(file: Blob, fileName: string): Promise<CellValue[][]> {
  const buffer = await file.arrayBuffer()

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  } catch (cause) {
    throw new SheetReadError(`Could not read ${fileName}: ${String(cause)}`, { cause })
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new SheetReadError(`${fileName} contains no worksheets.`)
  }
  const sheet = workbook.Sheets[sheetName]

  /*
   * `header: 1` yields an array-of-arrays instead of objects keyed by
   * header name, which is what the domain layer wants: it does its own
   * header detection, and keying by name here would silently collapse
   * duplicate column names.
   *
   * `defval: null` keeps empty cells as null rather than omitting them,
   * so a blank cell mid-row does not shift every later column left by one
   * and misalign the detected indices.
   *
   * `blankrows: true` keeps fully empty rows, so rowIndex still points at
   * the real spreadsheet row a user would scroll to. domain/ledger.ts
   * drops them after numbering.
   */
  const grid = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  })

  return grid
}

/** True for the extensions SheetJS will read here. */
export function isSpreadsheetFile(name: string): boolean {
  return /\.(xlsx|xlsm|xls|csv)$/i.test(name)
}

export function isPdfFile(name: string): boolean {
  return /\.pdf$/i.test(name)
}
