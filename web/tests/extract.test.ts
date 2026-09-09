import { expect, test } from 'vitest'
import { extractFromText } from '../src/domain/extract'
import { toISO } from '../src/domain/dates'
import oracle from './fixtures/extraction-oracle.json'

/**
 * Oracle test. Every expected value in extraction-oracle.json was produced
 * by running the Python implementation over these exact PDFs, then storing
 * the extracted page text alongside its result. Nothing here was written
 * by hand, so a divergence means the port drifted, not that someone
 * mis-typed an expectation.
 *
 * The seven cases deliberately span the range:
 *  - three layouts the sample generator never produces (different labels,
 *    prose dates, a bare "Ref#", no Vendor tag at all)
 *  - two genuinely real published sample invoices, including a
 *    multi-column layout where text extraction scrambles reading order
 *  - two ordinary invoices from the shipped sample_data
 */

interface OracleCase {
  name: string
  sourceFile: string
  text: string
  expected: {
    invoiceNumber: string | null
    vendor: string | null
    invoiceDate: string | null
    amount: number | null
  }
}

const cases = oracle as OracleCase[]

test('oracle fixtures are present', () => {
  expect(cases.length).toBe(7)
})

test.each(cases.map((c) => [c.name, c] as const))(
  'matches the Python implementation on %s',
  (_name, c) => {
    const got = extractFromText(c.text, c.sourceFile)
    expect(got.invoiceNumber).toBe(c.expected.invoiceNumber)
    expect(got.vendor).toBe(c.expected.vendor)
    expect(got.invoiceDate ? toISO(got.invoiceDate) : null).toBe(c.expected.invoiceDate)
    expect(got.amount).toBe(c.expected.amount)
  },
)

/**
 * The multi-column case is called out separately because the correct
 * behaviour is counter-intuitive: only the amount survives. The other
 * fields come back null because text extraction interleaves the columns,
 * so a label ends up adjacent to a different column's value. Returning
 * null there is the feature. Any change that starts "improving" these to
 * non-null is a regression, however plausible the values look.
 */
test('multi-column layout degrades to null rather than guessing', () => {
  const c = cases.find((x) => x.name === 'canadapost')!
  const got = extractFromText(c.text, c.sourceFile)
  expect(got.amount).toBe(1673.01)
  expect(got.invoiceNumber).toBeNull()
  expect(got.vendor).toBeNull()
  // The date column is labelled "(Y-M-D)" and its value is the only
  // year-first date alone on a line: reading it is not a guess.
  expect(got.invoiceDate).toEqual({ year: 2025, month: 6, day: 21 })
})

test('empty text yields an all-null invoice, not an exception', () => {
  const got = extractFromText('', 'nothing.pdf')
  expect(got.sourceFile).toBe('nothing.pdf')
  expect(got.invoiceNumber).toBeNull()
  expect(got.vendor).toBeNull()
  expect(got.invoiceDate).toBeNull()
  expect(got.amount).toBeNull()
})

/** CRLF input must behave identically, or the next-line vendor rule dies. */
test('CRLF line endings are handled like LF', () => {
  const lf = 'From:\nAcme Trading Co\nInvoice #: INV-1\nAmount Due: $10.00\n'
  const crlf = lf.replace(/\n/g, '\r\n')
  expect(extractFromText(crlf, 'x.pdf')).toEqual(extractFromText(lf, 'x.pdf'))
  expect(extractFromText(crlf, 'x.pdf').vendor).toBe('Acme Trading Co')
})
