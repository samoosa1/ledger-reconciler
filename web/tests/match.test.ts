import { expect, test } from 'vitest'
import { reconcile } from '../src/domain/match'
import { parseDate } from '../src/domain/dates'
import { status } from '../src/domain/types'
import type { Invoice, LedgerRow } from '../src/domain/types'

/** Ports tests/test_match.py and tests/test_coverage_and_safety.py. */

const inv = (o: Partial<Invoice> = {}): Invoice => ({
  sourceFile: 'a.pdf',
  invoiceNumber: 'INV-1',
  vendor: 'Acme Co',
  invoiceDate: parseDate('2025-01-10'),
  amount: 100.0,
  ...o,
})

const row = (o: Partial<LedgerRow> = {}): LedgerRow => ({
  rowIndex: 2,
  ledgerDate: parseDate('2025-01-10'),
  description: 'Payment to Acme Co',
  reference: 'INV-1',
  amount: 100.0,
  ...o,
})

test('exact reference match is clean', () => {
  const [r] = reconcile([inv()], [row()])
  expect(r.flags).toEqual([])
  expect(status(r)).toBe('matched')
})

test('missing ledger entry is flagged', () => {
  const [r] = reconcile([inv()], [])
  expect(r.flags).toEqual(['no_ledger_entry'])
})

test('undocumented ledger row is flagged', () => {
  const [r] = reconcile([], [row()])
  expect(r.flags).toEqual(['no_invoice'])
})

test('amount mismatch still matches but flags', () => {
  const ledgerRow = row({ amount: 150.0 })
  const [r] = reconcile([inv({ amount: 100.0 })], [ledgerRow])
  expect(r.ledgerRow).toBe(ledgerRow)
  expect(r.flags).toContain('amount_mismatch')
})

test('duplicate invoice number flags both copies, only one claims the row', () => {
  const results = reconcile(
    [inv({ sourceFile: 'a.pdf' }), inv({ sourceFile: 'a_rescan.pdf' })],
    [row()],
  )
  expect(results.every((r) => r.flags.includes('duplicate_invoice'))).toBe(true)
  expect(results.filter((r) => r.ledgerRow !== null)).toHaveLength(1)
})

test('falls back to amount and date when there is no reference', () => {
  const ledgerRow = row({ reference: null, amount: 250.0, ledgerDate: parseDate('2025-02-03') })
  const [r] = reconcile(
    [inv({ invoiceNumber: 'INV-9', amount: 250.0, invoiceDate: parseDate('2025-02-01') })],
    [ledgerRow],
  )
  expect(r.ledgerRow).toBe(ledgerRow)
  expect(r.flags).toEqual([])
})

test('date outside the window does not match', () => {
  const ledgerRow = row({ reference: null, ledgerDate: parseDate('2025-01-20') })
  const [r] = reconcile([inv({ invoiceNumber: null })], [ledgerRow])
  expect(r.ledgerRow).toBeNull()
})

/**
 * An invoice with no number and no amount/date cannot be searched for at
 * all, so it must be flagged unreadable and ONLY unreadable. Adding
 * no_ledger_entry would assert a finding that was never actually tested.
 */
test('a wholly unreadable invoice gets no false finding', () => {
  const [r] = reconcile(
    [inv({ invoiceNumber: null, vendor: null, invoiceDate: null, amount: null })],
    [],
  )
  expect(r.flags).toEqual(['unreadable_invoice'])
})

test('a partially readable invoice still earns a real no_ledger_entry', () => {
  const [r] = reconcile(
    [inv({ invoiceNumber: 'INV-9', vendor: null, invoiceDate: null, amount: null })],
    [],
  )
  expect(r.flags).toContain('unreadable_invoice')
  expect(r.flags).toContain('no_ledger_entry')
})

test('never silently drops a row', () => {
  const invoices = [inv()]
  const rows = [row({ reference: null, description: 'unrelated payment', amount: 999.0 })]
  const results = reconcile(invoices, rows)
  expect(results.filter((r) => r.invoice !== null)).toHaveLength(invoices.length)
  expect(results.filter((r) => r.ledgerRow !== null)).toHaveLength(rows.length)
})

/**
 * Two ledger rows with the same amount and date are ambiguous. The vendor
 * name in the description is what resolves it; if it cannot, the correct
 * answer is no match rather than an arbitrary pick.
 */
test('ambiguous candidates are resolved by vendor, or not at all', () => {
  const invoice = inv({ invoiceNumber: null, vendor: 'Bluefern Supplies Ltd' })
  const resolvable = reconcile(
    [invoice],
    [
      row({ rowIndex: 2, reference: null, description: 'Payment to Bluefern Supplies Ltd' }),
      row({ rowIndex: 3, reference: null, description: 'Payment to Nordway Logistics' }),
    ],
  )
  expect(resolvable[0].ledgerRow?.rowIndex).toBe(2)

  const unresolvable = reconcile(
    [invoice],
    [
      row({ rowIndex: 2, reference: null, description: 'Bluefern Supplies Ltd payment' }),
      row({ rowIndex: 3, reference: null, description: 'Payment to Bluefern Supplies Ltd' }),
    ],
  )
  expect(unresolvable[0].ledgerRow).toBeNull()
  expect(unresolvable[0].flags).toContain('no_ledger_entry')
})
