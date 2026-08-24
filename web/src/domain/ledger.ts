/**
 * Turns raw spreadsheet cells into LedgerRows, auto-detecting which
 * platform's export layout they came from. Mirrors
 * ledger_reconciler/ledger.py.
 *
 * Takes an already-read grid rather than a file, so this stays free of
 * browser and filesystem APIs. lib/sheet.ts does File -> grid.
 */

import { detectProfile, usesDebitCreditSplit } from './ledgerProfiles'
import type { PlainDate } from './dates'
import type { LedgerRow } from './types'

/** What a spreadsheet cell can hold once read. */
export type CellValue = string | number | boolean | Date | null | undefined

export class UnrecognisedLedgerError extends Error {}

/**
 * Date cells arrive as JS Date objects. xlsx stores dates as serial day
 * numbers with no timezone, and the reader reconstructs them at UTC
 * midnight, so the calendar date must be read with the getUTC* accessors.
 * Using getFullYear/getMonth/getDate instead would shift the date back a
 * day for anyone running west of UTC, which is the same trap dates.ts
 * exists to avoid.
 */
function asDate(value: CellValue): PlainDate | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    }
  }
  return null
}

/** Mirrors Python's isinstance(value, (int, float)) guard. */
function asNumber(value: CellValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function buildLedger(grid: CellValue[][]): LedgerRow[] {
  const headerRow = grid[0] ?? []
  // Mirrors `str(c.value).strip() if c.value else ""`, including Python's
  // truthiness: a header cell holding 0 or "" becomes an empty header.
  const rawHeaders = headerRow.map((c) => (c ? String(c).trim() : ''))
  const headers = rawHeaders.map((h) => h.toLowerCase())

  const detected = detectProfile(headers)
  if (!detected) {
    const found = rawHeaders.filter(Boolean).join(', ')
    throw new UnrecognisedLedgerError(
      "Couldn't recognise this ledger's columns against any known platform " +
        'format (Xero, Wave, FreshBooks, QuickBooks, or plain ' +
        `Date/Description/Reference/Amount). Found headers: ${found}`,
    )
  }
  const { profile, columns } = detected

  const rows: LedgerRow[] = []
  for (let i = 1; i < grid.length; i++) {
    const values = grid[i] ?? []
    if (values.every((v) => v === null || v === undefined)) continue

    let amount: number | null
    if (usesDebitCreditSplit(profile)) {
      // Magnitude is all that matters here, not signed dr/cr semantics, so
      // take whichever side of the pair this row populated. Note the
      // truthiness check rather than a null check: a debit of exactly 0
      // falls through to the credit column, matching the Python original.
      const debit = columns.debit !== undefined ? asNumber(values[columns.debit]) : null
      const credit = columns.credit !== undefined ? asNumber(values[columns.credit]) : null
      amount = debit ? debit : credit
    } else {
      amount = columns.amount !== undefined ? asNumber(values[columns.amount]) : null
    }

    const rawRef = columns.reference !== undefined ? values[columns.reference] : null
    const rawDesc = columns.description !== undefined ? values[columns.description] : null

    rows.push({
      // 1-based so it points at the actual spreadsheet row; the header is
      // row 1, so data starts at 2 and a finding is traceable by eye.
      rowIndex: i + 1,
      ledgerDate: columns.date !== undefined ? asDate(values[columns.date]) : null,
      // `||` not `??`, deliberately: the Python original is
      // `str(value or "")`, so a description cell holding 0 becomes an
      // empty string rather than the text "0".
      description: String(rawDesc || '').trim(),
      reference: rawRef ? String(rawRef).trim() : null,
      amount,
    })
  }
  return rows
}
