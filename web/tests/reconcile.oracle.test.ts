import { expect, test } from 'vitest'
import { extractFromText } from '../src/domain/extract'
import { buildLedger, type CellValue } from '../src/domain/ledger'
import { reconcile } from '../src/domain/match'
import oracle from './fixtures/reconcile-oracle.json'

/**
 * End-to-end oracle: the whole domain layer against the reference
 * implementation, on the real shipped sample data.
 *
 * The per-module tests prove each part in isolation; this proves they
 * compose. Every expected value came from running the Python CLI over
 * sample_data/, so a divergence here means the port disagrees with the
 * reference, not that an expectation was typed wrong.
 */

interface Oracle {
  invoices: Array<{ sourceFile: string; text: string }>
  ledgerGrid: Array<Array<CellValue | { __date: string }>>
  expected: Array<{
    sourceFile: string | null
    invoiceNumber: string | null
    ledgerRowIndex: number | null
    flags: string[]
  }>
}

const data = oracle as Oracle

/** Rebuilds date cells as the spreadsheet reader would: UTC midnight. */
function toGrid(raw: Oracle['ledgerGrid']): CellValue[][] {
  return raw.map((row) =>
    row.map((cell) =>
      cell !== null && typeof cell === 'object' && '__date' in cell
        ? new Date(`${cell.__date}T00:00:00Z`)
        : (cell as CellValue),
    ),
  )
}

function runPort() {
  const invoices = data.invoices.map((i) => extractFromText(i.text, i.sourceFile))
  const rows = buildLedger(toGrid(data.ledgerGrid))
  return reconcile(invoices, rows)
}

test('fixture describes the full sample set', () => {
  expect(data.invoices).toHaveLength(17)
  expect(data.ledgerGrid).toHaveLength(17) // header + 16 rows
  expect(data.expected).toHaveLength(18)
})

test('produces the same number of results as the reference', () => {
  expect(runPort()).toHaveLength(data.expected.length)
})

test('every result matches the reference implementation exactly', () => {
  const got = runPort().map((r) => ({
    sourceFile: r.invoice?.sourceFile ?? null,
    invoiceNumber: r.invoice?.invoiceNumber ?? null,
    ledgerRowIndex: r.ledgerRow?.rowIndex ?? null,
    flags: r.flags as string[],
  }))
  expect(got).toEqual(data.expected)
})

/**
 * The four faults deliberately planted in the sample data, asserted by
 * name so a regression says which one broke rather than just changing a
 * count. The duplicate produces two flags because both copies are marked.
 */
test('finds the four planted faults, five flags in total', () => {
  const flagged = runPort().filter((r) => r.flags.length > 0)
  expect(flagged).toHaveLength(5)

  const byFlag = (f: string) => flagged.filter((r) => (r.flags as string[]).includes(f))
  expect(byFlag('no_ledger_entry')).toHaveLength(2) // missing payment + the rescan
  expect(byFlag('amount_mismatch')).toHaveLength(1)
  expect(byFlag('duplicate_invoice')).toHaveLength(2)
  expect(byFlag('no_invoice')).toHaveLength(1)
})

test('the amount mismatch is the planted 50.00 discrepancy', () => {
  const r = runPort().find((x) => (x.flags as string[]).includes('amount_mismatch'))!
  const diff = Math.abs((r.invoice!.amount ?? 0) - (r.ledgerRow!.amount ?? 0))
  expect(diff).toBeCloseTo(50.0, 6)
})
