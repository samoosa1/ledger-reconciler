import { expect, test } from 'vitest'
import { extractFromText } from '../src/domain/extract'
import { buildLedger, type CellValue } from '../src/domain/ledger'
import { reconcile } from '../src/domain/match'
import oracle from './fixtures/reconcile-oracle.json'

/**
 * End-to-end oracle: the whole domain layer against the reference
 * implementation, on the shipped browser sample subset.
 *
 * The per-module tests prove each part in isolation; this proves they
 * compose. Every expected value came from running the Python reference
 * (tools/make_web_oracle.py, OCR disabled so it is deterministic) over
 * web/public/sample, so a divergence here means the port disagrees with the
 * reference, not that an expectation was typed wrong. Scanned files carry an
 * empty text and must come back unreadable on both sides.
 */

interface Oracle {
  invoices: Array<{ sourceFile: string; text: string }>
  ledgerGrid: Array<Array<CellValue | { __date: string }>>
  expected: Array<{
    sourceFile: string | null
    invoiceNumber: string | null
    ledgerRowIndex: number | null
    extraRowIndexes: number[]
    flags: string[]
  }>
  flagCounts: Record<string, number>
  invoiceCount: number
  ledgerRowCount: number
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

test('fixture describes the shipped sample subset', () => {
  expect(data.invoices).toHaveLength(data.invoiceCount)
  expect(data.ledgerGrid).toHaveLength(data.ledgerRowCount + 1) // header row
  expect(data.invoiceCount).toBeGreaterThanOrEqual(20)
  expect(data.invoices.filter((i) => i.text === '').length).toBeGreaterThan(0) // scans are in the set
})

test('produces the same number of results as the reference', () => {
  expect(runPort()).toHaveLength(data.expected.length)
})

test('every result matches the reference implementation exactly', () => {
  const got = runPort().map((r) => ({
    sourceFile: r.invoice?.sourceFile ?? null,
    invoiceNumber: r.invoice?.invoiceNumber ?? null,
    ledgerRowIndex: r.ledgerRow?.rowIndex ?? null,
    extraRowIndexes: r.extraRows.map((x) => x.rowIndex),
    flags: r.flags as string[],
  }))
  expect(got).toEqual(data.expected)
})

/**
 * Flag counts asserted by name so a regression says which finding broke
 * rather than just changing a total. The counts come from the reference.
 */
test('flag counts match the reference by name', () => {
  const counts: Record<string, number> = {}
  for (const r of runPort()) for (const f of r.flags) counts[f] = (counts[f] ?? 0) + 1
  expect(counts).toEqual(data.flagCounts)
})

test('the planted payment shapes are recognised, not reported as errors', () => {
  const results = runPort()
  const instalments = results.filter((r) => (r.flags as string[]).includes('paid_in_instalments'))
  expect(instalments.length).toBe(data.flagCounts.paid_in_instalments ?? 0)
  for (const r of instalments) {
    expect(r.extraRows.length).toBeGreaterThan(0)
    expect(r.flags).not.toContain('amount_mismatch')
  }
})
