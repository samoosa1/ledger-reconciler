import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { readPdfText } from '../src/lib/pdf'
import { readSheetGrid } from '../src/lib/sheet'
import { extractFromText } from '../src/domain/extract'
import { buildLedger } from '../src/domain/ledger'
import { reconcile } from '../src/domain/match'
import oracle from './fixtures/reconcile-oracle.json'

/**
 * Phase 2's real question: does the browser edge feed the domain layer the
 * same thing Python's did?
 *
 * pdf.js and pypdf are unrelated implementations. pdf.js returns
 * positioned fragments rather than lines, so lib/pdf.ts reassembles them
 * by vertical position. If that reassembly differs from pypdf's, the
 * extraction patterns silently stop matching. This test reads the actual
 * sample files and asserts the whole pipeline still lands on the
 * reference results.
 */

const SAMPLE = resolve(__dirname, '../public/sample')
const blob = (path: string): Blob => new Blob([readFileSync(path)])

interface Oracle {
  invoices: Array<{ sourceFile: string; text: string }>
  expected: Array<{
    sourceFile: string | null
    invoiceNumber: string | null
    ledgerRowIndex: number | null
    extraRowIndexes: number[]
    flags: string[]
  }>
  ledgerRowCount: number
}
const data = oracle as Oracle

/**
 * pdf.js and pypdf do not produce byte-identical text (pypdf sometimes
 * glues a label to its value, pdf.js keeps the space), so the comparison is
 * on the extracted fields, over every text-layer file in the subset. A
 * reassembly regression shows up as a field going null or changing.
 */
test('pdf.js text drives the same extraction as pypdf text', async () => {
  const textLayer = data.invoices.filter((i) => i.text.trim() !== '')
  expect(textLayer.length).toBeGreaterThan(10)
  for (const { sourceFile, text } of textLayer) {
    const got = extractFromText(await readPdfText(blob(`${SAMPLE}/invoices/${sourceFile}`), sourceFile), sourceFile)
    const ref = extractFromText(text, sourceFile)
    expect(got, sourceFile).toEqual(ref)
  }
}, 30_000)

test('a scanned PDF has no text layer and reads as empty', async () => {
  const scan = data.invoices.find((i) => i.text.trim() === '')!
  expect(await readPdfText(blob(`${SAMPLE}/invoices/${scan.sourceFile}`), scan.sourceFile)).toBe('')
})

test('an empty file yields empty text rather than throwing', async () => {
  expect(await readPdfText(new Blob([]), 'empty.pdf')).toBe('')
})

test('a non-PDF yields empty text rather than throwing', async () => {
  const notAPdf = new Blob([new TextEncoder().encode('this is not a pdf')])
  expect(await readPdfText(notAPdf, 'fake.pdf')).toBe('')
})

test('SheetJS grid drives the same ledger rows', async () => {
  const grid = await readSheetGrid(blob(`${SAMPLE}/ledger.xlsx`), 'ledger.xlsx')
  const rows = buildLedger(grid)
  expect(rows).toHaveLength(data.ledgerRowCount)
  expect(rows[0].rowIndex).toBe(2)
  expect(rows.every((r) => r.ledgerDate !== null)).toBe(true)
  expect(rows.every((r) => r.amount !== null)).toBe(true)
})

/**
 * The whole thing, from real files to final flags, against the reference.
 * This is the test that would catch a text-reassembly regression, since
 * every intermediate difference eventually shows up as a changed flag.
 */
test('real files through the full pipeline match the Python reference', async () => {
  const names = data.invoices.map((i) => i.sourceFile)
  const invoices = []
  for (const name of names) {
    const text = await readPdfText(blob(`${SAMPLE}/invoices/${name}`), name)
    invoices.push(extractFromText(text, name))
  }

  const grid = await readSheetGrid(blob(`${SAMPLE}/ledger.xlsx`), 'ledger.xlsx')
  const results = reconcile(invoices, buildLedger(grid))

  const got = results.map((r) => ({
    sourceFile: r.invoice?.sourceFile ?? null,
    invoiceNumber: r.invoice?.invoiceNumber ?? null,
    ledgerRowIndex: r.ledgerRow?.rowIndex ?? null,
    extraRowIndexes: r.extraRows.map((x) => x.rowIndex),
    flags: r.flags as string[],
  }))
  expect(got).toEqual(data.expected)
}, 30_000)
