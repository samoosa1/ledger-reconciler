/**
 * Pulls structured fields out of invoice text. Mirrors
 * ledger_reconciler/extract.py, minus the PDF reading, which lives in
 * lib/pdf.ts so this module stays free of browser APIs and testable in
 * plain Node.
 *
 * Each field tries a short list of real-world label variants in order and
 * takes the first hit. When nothing matches, the field is null rather than
 * guessed: a wrong value a user trusts is worse than an admitted gap.
 */

import { parseDate, type PlainDate } from './dates'
import type { Invoice } from './types'

/**
 * `[ \t]*` rather than `\s*` between label and value deliberately keeps the
 * match on one line. Text-layer extraction does not preserve visual column
 * layout, so allowing a match to cross a newline risks capturing the next
 * column's label as this field's value. A real multi-column invoice broke
 * the Python version exactly this way: "Invoice number" was followed in the
 * text stream by "Customer ref. 1", not by its own value.
 */
const NUMBER_PATTERNS = [
  /Invoice\s*(?:#|No\.?|Number)[ \t]*:?[ \t]*([A-Za-z0-9-]+)/i,
  /Ref(?:erence)?\s*(?:#|No\.?)?[ \t]*:?[ \t]*([A-Za-z0-9-]+)/i,
]

const AMOUNT_PATTERNS = [
  /(?:Amount\s*Due|Total\s*Due|Balance\s*Due)\s*:?\s*\$?\s*([0-9][0-9,]*\.[0-9]{2})/i,
  /Total\s*:?\s*\$?\s*([0-9][0-9,]*\.[0-9]{2})/i,
  /\$\s*([0-9][0-9,]*\.[0-9]{2})\s*due/i,
]

const DATE_LABEL = String.raw`(?:Invoice\s*Date|Issue\s*Date|Date)\s*:?\s*`
const DATE_LABEL_PATTERNS = [
  new RegExp(DATE_LABEL + String.raw`([0-9]{4}-[0-9]{2}-[0-9]{2})`, 'i'),
  new RegExp(DATE_LABEL + String.raw`([A-Za-z]+ [0-9]{1,2},? [0-9]{4})`, 'i'),
]
const DATE_BARE_PATTERN = /\b([0-9]{4}\/[0-9]{2}\/[0-9]{2})\b/

// Same-line: "Vendor: Acme Co". Next-line: a bare "From:" with the name on
// the line below, common when the letterhead sits under the field label.
const VENDOR_LABEL_SAMELINE = /^(?:Vendor|From|Sold\s*By|Company)\s*:?\s*(\S.*)$/im
const VENDOR_LABEL_NEXTLINE = /^(?:Vendor|From|Sold\s*By|Company)\s*:?\s*$\n(.+)$/im

/** A line starting with any of these is boilerplate, not a company name. */
const BOILERPLATE_START = [
  'invoice', 'receipt', 'bill to', 'ship to', 'page', 'payment', 'customer',
  'contact', 'thanks', 'please', 'terms', 'note', 'due', 'total', 'order',
  'date', 'ref',
]
const VENDOR_SCAN_WINDOW = 6

/**
 * Normalises line endings before any matching. VENDOR_LABEL_NEXTLINE
 * depends on `$\n`, and with CRLF input `$` sits before the `\r`, so the
 * pattern silently never fires on a Windows-authored document.
 */
function normalise(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** Python's str.isupper(): all cased chars upper, and at least one exists. */
function isUpper(s: string): boolean {
  return /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s)
}

function looksLikeAName(line: string): boolean {
  const low = line.toLowerCase()
  if (BOILERPLATE_START.some((w) => low.startsWith(w))) return false

  // Python's str.split() collapses runs of whitespace and drops empties;
  // a naive JS split(/\s+/) yields a leading "" on indented lines.
  const words = line.trim().split(/\s+/).filter(Boolean)
  if (words.length < 1 || words.length > 6) return false

  // Unicode-aware, matching Python's str.isalpha(), so accented and
  // non-Latin company names still count as names.
  if (!/\p{L}/u.test(line)) return false

  if (low.endsWith('.') && !isUpper(line)) return false
  return true
}

function parseAmount(raw: string): number {
  return Number(raw.replace(/,/g, ''))
}

function extractNumber(text: string): string | null {
  for (const pattern of NUMBER_PATTERNS) {
    const m = pattern.exec(text)
    if (m) return m[1].trim()
  }
  return null
}

function extractAmount(text: string): number | null {
  for (const pattern of AMOUNT_PATTERNS) {
    const m = pattern.exec(text)
    if (m) return parseAmount(m[1])
  }
  return null
}

function extractDate(text: string): PlainDate | null {
  for (const pattern of DATE_LABEL_PATTERNS) {
    const m = pattern.exec(text)
    if (m) {
      const parsed = parseDate(m[1].trim())
      if (parsed) return parsed
    }
  }
  const bare = DATE_BARE_PATTERN.exec(text)
  return bare ? parseDate(bare[1]) : null
}

function extractVendor(text: string): string | null {
  const sameLine = VENDOR_LABEL_SAMELINE.exec(text)
  if (sameLine) return sameLine[1].trim()

  const nextLine = VENDOR_LABEL_NEXTLINE.exec(text)
  if (nextLine) return nextLine[1].trim()

  // No explicit label. Only trust a positional guess near the very top of
  // the document, and only if it looks like a name rather than boilerplate.
  // Text extraction does not preserve column layout, so scanning deeper
  // risks lifting text from an unrelated column. Reporting "not found"
  // beats confidently returning the wrong company.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines.slice(0, VENDOR_SCAN_WINDOW)) {
    if (looksLikeAName(line)) return line
  }
  return null
}

/**
 * Text in, structured invoice out. Callers that have a File or a path use
 * lib/pdf.ts to get the text first. An empty string is a valid input and
 * yields an invoice with every field null, which downstream reconciliation
 * reports as unreadable rather than as a missing payment.
 */
export function extractFromText(text: string, sourceFile: string): Invoice {
  const t = normalise(text)
  return {
    sourceFile,
    invoiceNumber: extractNumber(t),
    vendor: extractVendor(t),
    invoiceDate: extractDate(t),
    amount: extractAmount(t),
  }
}
