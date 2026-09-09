import { expect, test } from 'vitest'
import { buildStatements, latestDate } from '../src/domain/statement'
import type { Invoice, LedgerRow, MatchResult } from '../src/domain/types'

const inv = (o: Partial<Invoice> = {}): Invoice => ({
  sourceFile: 'a.pdf',
  invoiceNumber: 'INV-1',
  vendor: 'Acme Supplies',
  invoiceDate: { year: 2025, month: 1, day: 1 },
  amount: 100,
  extractionMethod: 'text',
  ...o,
})

const row = (o: Partial<LedgerRow> = {}): LedgerRow => ({
  rowIndex: 2,
  ledgerDate: { year: 2025, month: 1, day: 5 },
  description: 'payment',
  reference: 'INV-1',
  amount: 100,
  ...o,
})

const res = (o: Partial<MatchResult> = {}): MatchResult => ({
  invoice: inv(),
  ledgerRow: null,
  flags: [],
  extraRows: [],
  ...o,
})

const ASOF = { year: 2025, month: 3, day: 2 } // 60 days after 2025-01-01

test('a settled invoice leaves nothing outstanding', () => {
  const [s] = buildStatements([res({ ledgerRow: row() })], ASOF)
  expect(s.billed).toBe(100)
  expect(s.settled).toBe(100)
  expect(s.outstanding).toBe(0)
  expect(s.buckets.d31_60).toBe(0)
})

test('an unpaid invoice ages into the bucket for its invoice date', () => {
  const [s] = buildStatements([res()], ASOF)
  expect(s.outstanding).toBe(100)
  expect(s.lines[0].ageDays).toBe(60)
  expect(s.lines[0].bucket).toBe('d31_60')
  expect(s.buckets.d31_60).toBe(100)
})

test('bucket edges land on the lower band', () => {
  const at = (day: number) =>
    buildStatements([res({ invoice: inv({ invoiceDate: { year: 2025, month: 1, day: day } }) })], {
      year: 2025,
      month: 1,
      day: 31,
    })[0].lines[0].bucket
  expect(at(1)).toBe('d0_30') // exactly 30 days
  expect(at(31)).toBe('d0_30') // same day, 0 days
})

test('a short payment leaves only the gap outstanding', () => {
  const [s] = buildStatements([res({ ledgerRow: row({ amount: 40 }) })], ASOF)
  expect(s.settled).toBe(40)
  expect(s.outstanding).toBe(60)
})

test('instalments across several rows settle the invoice', () => {
  const [s] = buildStatements(
    [res({ ledgerRow: row({ amount: 60 }), extraRows: [row({ rowIndex: 3, amount: 40 })] })],
    ASOF,
  )
  expect(s.outstanding).toBe(0)
})

test('an overpayment is reported separately, never netted into what is owed', () => {
  const [s] = buildStatements([res({ ledgerRow: row({ amount: 150 }) })], ASOF)
  expect(s.outstanding).toBe(0)
  expect(s.overpaid).toBe(50)
  expect(s.lines[0].outstanding).toBe(-50) // the per-invoice figure stays signed
})

test('an overpayment on one invoice does not cancel a shortfall on another', () => {
  const [s] = buildStatements(
    [
      res({ invoice: inv({ invoiceNumber: 'A', amount: 100 }), ledgerRow: row({ amount: 400 }) }),
      res({ invoice: inv({ invoiceNumber: 'B', sourceFile: 'b.pdf', amount: 100 }) }),
    ],
    ASOF,
  )
  expect(s.outstanding).toBe(100)
  expect(s.overpaid).toBe(300)
})

test('an overpayment is not aged, because it is a query rather than a debt', () => {
  const [s] = buildStatements([res({ ledgerRow: row({ amount: 150 }) })], ASOF)
  expect(Object.values(s.buckets).every((v) => v === 0)).toBe(true)
})

test('an unreadable amount is declared and kept out of every total', () => {
  const [s] = buildStatements(
    [res({ invoice: inv({ amount: null }), flags: ['unreadable_invoice'] })],
    ASOF,
  )
  expect(s.unreadableCount).toBe(1)
  expect(s.invoiceCount).toBe(1)
  expect(s.billed).toBe(0)
  expect(s.outstanding).toBe(0)
})

test('an invoice with no readable date is undated, not assumed current', () => {
  const [s] = buildStatements([res({ invoice: inv({ invoiceDate: null }) })], ASOF)
  expect(s.lines[0].bucket).toBe('undated')
  expect(s.lines[0].ageDays).toBeNull()
  expect(s.buckets.undated).toBe(100)
  expect(s.buckets.d0_30).toBe(0)
})

test('an unreadable vendor gets its own statement and sorts last', () => {
  const stmts = buildStatements(
    [res({ invoice: inv({ vendor: null, amount: 5000 }) }), res()],
    ASOF,
  )
  expect(stmts.map((s) => s.vendor)).toEqual(['Acme Supplies', null])
})

test('vendors sort by outstanding, largest first', () => {
  const stmts = buildStatements(
    [
      res({ invoice: inv({ vendor: 'Small Co', amount: 10 }) }),
      res({ invoice: inv({ vendor: 'Big Co', amount: 900 }) }),
    ],
    ASOF,
  )
  expect(stmts.map((s) => s.vendor)).toEqual(['Big Co', 'Small Co'])
})

test('a ledger row with no invoice belongs to the exception report, not a statement', () => {
  const stmts = buildStatements([{ invoice: null, ledgerRow: row(), flags: ['no_invoice'], extraRows: [] }], ASOF)
  expect(stmts).toEqual([])
})

test('the ageing date defaults to the latest date in the data, not the clock', () => {
  const results = [res({ ledgerRow: row({ ledgerDate: { year: 2025, month: 4, day: 10 } }) })]
  expect(latestDate(results)).toEqual({ year: 2025, month: 4, day: 10 })
  const [s] = buildStatements([res()], null)
  expect(s.lines[0].ageDays).toBe(0) // only date present is the invoice's own
})
