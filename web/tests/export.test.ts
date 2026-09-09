import { expect, test } from 'vitest'
import * as XLSX from 'xlsx'
import { buildWorkbook, workbookBytes } from '../src/lib/export'
import { parseDate } from '../src/domain/dates'
import { reconcile } from '../src/domain/match'
import type { Invoice, LedgerRow, MatchResult } from '../src/domain/types'

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

/** Round-trips through real bytes, not the in-memory object. */
async function readBack(results: MatchResult[]) {
  const wb = XLSX.read(await workbookBytes(results), { type: 'array' })
  return {
    names: wb.SheetNames,
    detail: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Detail, { header: 1 }) as (string | number)[][],
    summary: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Summary, { header: 1 }) as (string | number)[][],
  }
}

test('produces a Summary and a Detail sheet', async () => {
  const { names } = await readBack(reconcile([inv()], [row()]))
  expect(names).toEqual(['Summary', 'Detail'])
})

test('detail sheet has one header row plus one row per result', async () => {
  const results = reconcile([inv()], [row({ rowIndex: 3, reference: null, amount: 999 })])
  const { detail } = await readBack(results)
  expect(detail[0][0]).toBe('Status')
  expect(detail.length).toBe(results.length + 1)
})

test('a clean match is reported as matched, with both amounts', async () => {
  const { detail } = await readBack(reconcile([inv()], [row()]))
  const [status, number, vendor, date, invAmt, ledgerRow] = detail[1]
  expect(status).toBe('matched')
  expect(number).toBe('INV-1')
  expect(vendor).toBe('Acme Co')
  expect(date).toBe('2025-01-10')
  expect(invAmt).toBe(100)
  expect(ledgerRow).toBe(2)
})

test('flags are written in plain language, not internal names', async () => {
  const { detail } = await readBack(reconcile([inv()], []))
  expect(detail[1][0]).toBe('No matching payment')
  expect(String(detail[1][0])).not.toContain('no_ledger_entry')
})

test('summary reports the counts and the match rate', async () => {
  const results = reconcile([inv(), inv({ sourceFile: 'b.pdf', invoiceNumber: 'INV-2' })], [row()])
  const { summary } = await readBack(results)
  const find = (label: string) => summary.find((r) => r[0] === label)?.[1]
  expect(find('Total items')).toBe(2)
  expect(find('Matched clean')).toBe(1)
  expect(find('Flagged')).toBe(1)
  expect(find('Match rate')).toBe('50%')
})

/**
 * A vendor name or description is lifted straight out of a document
 * supplied by someone else, so it can begin with a formula trigger.
 *
 * Two things are asserted, and the second is the one that caught a real
 * bug. First, the cell must not be a formula. Second, the value must
 * survive EXACTLY: an earlier version of this exporter prefixed an
 * apostrophe, copying the guard the Python side needs for openpyxl.
 * SheetJS does not share that failure mode (a cell is a formula only with
 * an explicit <f> element), so the apostrophe was not protecting anything
 * and was stored as literal text, leaving '=SUM(A1:A9) in the delivered
 * report.
 */
test.each(['=SUM(A1:A9)', '+1+1', '-1-1', '@SUM(A1)'])(
  'writes %s as text, unchanged and not as a formula',
  async (hostile) => {
    const results = reconcile([inv({ vendor: hostile })], [])
    const wb = XLSX.read(await workbookBytes(results), { type: 'array' })
    const cell = wb.Sheets.Detail.C2

    expect(cell.t).toBe('s')
    expect(cell.f).toBeUndefined()
    expect(cell.v).toBe(hostile) // no apostrophe, no mangling
  },
)

/** No <f> element anywhere is the format-level statement of the above. */
test('the emitted sheet contains no formula cells at all', async () => {
  const results = reconcile([inv({ vendor: '=SUM(A1:A9)' })], [row()])
  const wb = XLSX.read(await workbookBytes(results), { type: 'array' })
  const detail = wb.Sheets.Detail
  const formulaCells = Object.keys(detail)
    .filter((k) => !k.startsWith('!'))
    .filter((k) => (detail[k] as XLSX.CellObject).f !== undefined)
  expect(formulaCells).toEqual([])
})

test('an ordinary vendor name is written unchanged', async () => {
  const { detail } = await readBack(reconcile([inv({ vendor: 'Acme Co' })], []))
  expect(detail[1][2]).toBe('Acme Co')
})

test('a payment with no invoice leaves the invoice columns empty', async () => {
  const { detail } = await readBack(reconcile([], [row({ description: 'Wire transfer' })]))
  const r = detail[1]
  expect(r[0]).toBe('Payment with no invoice')
  expect(r[1] ?? '').toBe('') // invoice number
  expect(r[7]).toBe('Wire transfer')
})

test('column widths are written into the file', async () => {
  const wb = await buildWorkbook(reconcile([inv()], [row()]))
  expect(wb.Sheets.Detail['!cols']).toHaveLength(11)
})
