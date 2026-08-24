import { expect, test } from 'vitest'
import { buildLedger, UnrecognisedLedgerError, type CellValue } from '../src/domain/ledger'
import { detectProfile } from '../src/domain/ledgerProfiles'

/**
 * Ports tests/test_ledger_profiles.py. The Python version writes real xlsx
 * files; here the grid is built directly, because reading the file is
 * lib/sheet.ts's job and this layer is deliberately free of I/O.
 *
 * Dates are constructed at UTC midnight, which is what a spreadsheet
 * reader produces for a date cell: xlsx stores a timezone-less serial day
 * number.
 */
const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`)

test('generic Date/Description/Reference/Amount layout', () => {
  const rows = buildLedger([
    ['Date', 'Description', 'Reference', 'Amount'],
    [d('2025-03-01'), 'Payment to Acme Co', 'INV-1', 100.0],
  ] as CellValue[][])
  expect(rows).toHaveLength(1)
  expect(rows[0].ledgerDate).toEqual({ year: 2025, month: 3, day: 1 })
  expect(rows[0].reference).toBe('INV-1')
  expect(rows[0].amount).toBe(100.0)
  expect(rows[0].rowIndex).toBe(2)
})

test('Xero layout, debit/credit split', () => {
  const rows = buildLedger([
    ['Date', 'Source', 'Reference', 'Description', 'Debit', 'Credit'],
    [d('2025-03-01'), 'Accounts Payable', 'INV-1', 'Acme Co invoice', 250.0, null],
    [d('2025-03-03'), 'Accounts Payable', 'INV-2', 'Bexley Ltd invoice', null, 75.5],
  ] as CellValue[][])
  expect(rows[0].amount).toBe(250.0)
  expect(rows[0].reference).toBe('INV-1')
  expect(rows[1].amount).toBe(75.5) // credit-side row, no debit value
})

test('Wave layout has no reference column', () => {
  const rows = buildLedger([
    ['Date', 'Description', 'Amount', 'Account'],
    [d('2025-03-01'), 'Payment to Acme Co', 100.0, 'Business Checking'],
  ] as CellValue[][])
  expect(rows[0].amount).toBe(100.0)
  expect(rows[0].reference).toBeNull()
})

test('FreshBooks layout uses vendor as the description', () => {
  const rows = buildLedger([
    ['Date', 'Vendor', 'Category', 'Amount', 'Currency', 'Tax'],
    [d('2025-03-01'), 'Acme Co', 'Office Supplies', 100.0, 'USD', 0.0],
  ] as CellValue[][])
  expect(rows[0].amount).toBe(100.0)
  expect(rows[0].description).toBe('Acme Co')
})

test('QuickBooks layout maps Num to reference', () => {
  const rows = buildLedger([
    ['Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Account', 'Amount'],
    [d('2025-03-01'), 'Bill Payment', '1001', 'Acme Co', 'March invoice', 'Checking', 100.0],
  ] as CellValue[][])
  expect(rows[0].amount).toBe(100.0)
  expect(rows[0].reference).toBe('1001')
})

test('unrecognised layout throws, naming what it actually found', () => {
  expect(() =>
    buildLedger([['Foo', 'Bar', 'Baz'], ['x', 'y', 'z']] as CellValue[][]),
  ).toThrow(UnrecognisedLedgerError)
  expect(() =>
    buildLedger([['Foo', 'Bar', 'Baz'], ['x', 'y', 'z']] as CellValue[][]),
  ).toThrow(/Foo/)
})

/**
 * Regression for the detection rule. A generic sheet also satisfies Wave's
 * looser requirements, and a first-match-wins detector picked Wave and
 * silently dropped the Reference column, quietly downgrading exact-
 * reference matching to amount-and-date guessing.
 */
test('picks the profile explaining the most columns, not the first that fits', () => {
  const detection = detectProfile(['date', 'description', 'reference', 'amount'])!
  expect(detection.profile.name).toBe('Generic')
  expect(detection.columns.reference).toBe(2)
})

test('blank rows are skipped without shifting row numbers', () => {
  const rows = buildLedger([
    ['Date', 'Description', 'Reference', 'Amount'],
    [null, null, null, null],
    [d('2025-03-05'), 'Payment', 'INV-9', 42.0],
  ] as CellValue[][])
  expect(rows).toHaveLength(1)
  expect(rows[0].rowIndex).toBe(3) // still points at the real spreadsheet row
})

/**
 * Python writes `str(value or "")`, so a description cell holding 0 yields
 * an empty string. Using `??` in the port instead of `||` would produce
 * the text "0" and silently change what gets fuzzy-matched.
 */
test('a zero in the description cell becomes empty, matching Python truthiness', () => {
  const rows = buildLedger([
    ['Date', 'Description', 'Reference', 'Amount'],
    [d('2025-03-01'), 0, 'INV-1', 100.0],
  ] as CellValue[][])
  expect(rows[0].description).toBe('')
})

/** A zero debit must fall through to the credit column, as in Python. */
test('zero debit falls through to credit', () => {
  const rows = buildLedger([
    ['Date', 'Description', 'Debit', 'Credit'],
    [d('2025-03-01'), 'Acme', 0, 88.0],
  ] as CellValue[][])
  expect(rows[0].amount).toBe(88.0)
})
