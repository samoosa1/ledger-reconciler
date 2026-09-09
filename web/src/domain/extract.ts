/**
 * Pulls structured fields out of invoice text. Mirrors
 * ledger_reconciler/extract.py, minus the PDF reading and OCR, which live
 * in lib/ so this module stays free of browser APIs and testable in Node.
 *
 * Real invoices disagree about everything: where the number sits, what the
 * total is called, whether 1.234,56 or 1,234.56 is the amount, whether
 * 03/04 is March or April. Each field tries an ordered list of label
 * patterns and value shapes; the first hit wins. A field that cannot be
 * read with confidence is null so the reconciler reports it instead of
 * guessing: a wrong value a user trusts is worse than an admitted gap.
 */

import { parseDate, type PlainDate } from './dates'
import type { ExtractionMethod, Invoice } from './types'

/**
 * A money value in any of the three common shapes, with optional sign,
 * symbol and ISO code around it. Group 1 is the numeric part.
 */
const MONEY = String.raw`(?:[-−]\s*)?(?:[$€£₺]\s*)?(?:[A-Z]{3}\s*)?(-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})|-?\d+[.,]\d{2})(?:\s*[A-Z]{3})?`

/**
 * '1,234.56' / '1.234,56' / '1234.56' / '16.396,10' -> number. The LAST
 * separator and the digit count after it decide which one is the decimal
 * point; a lone separator followed by exactly three digits is a thousands
 * group. Anything else is null, never a guess.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, '').replace(/−/g, '-')
  const neg = s.startsWith('-')
  s = s.replace(/^-+/, '')
  if (!s) return null
  const pos = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
  let digits: string
  if (pos === -1) {
    digits = s
  } else {
    const tail = s.slice(pos + 1)
    if (tail.length === 2) digits = s.slice(0, pos).replace(/[.,]/g, '') + '.' + tail
    else if (tail.length === 3) digits = s.replace(/[.,]/g, '')
    else return null
  }
  if (!/^\d+(\.\d+)?$/.test(digits)) return null
  const v = Number(digits)
  return neg ? -v : v
}

const DATE_VALUE = String.raw`(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})`

/**
 * `[ \t]*` (never `\s*`) between label and value: text extraction of a
 * multi-column layout puts the NEXT column's label or value on the line
 * below, so crossing a newline reads a customer number as the invoice
 * number. The value must contain a digit, so "Invoice date" is never read
 * as an invoice number.
 */
const NUMBER_PATTERNS = [
  /\b(?:invoice|receipt|credit\s*note|credit\s*memo|tax\s*invoice|bill)[ \t]*(?:number|no\.?|nr\.?|num\.?|#|id)[ \t]*[:.]?[ \t]*([A-Z0-9][A-Z0-9/-]*\d[A-Z0-9/-]*)/gi,
  /\b(?:ref(?:erence)?|our[ \t]*ref)[ \t]*(?:number|no\.?|#)?[ \t]*[:.]?[ \t]*([A-Z0-9][A-Z0-9/-]*\d[A-Z0-9/-]*)/gi,
  /\b(?:invoice|receipt)[ \t]*#?[ \t]*([A-Z]{1,5}[-/]?\d[A-Z0-9/-]*|\d{3,})\b(?![ \t]*(?:date|due))/gi,
]

/**
 * Ordered from most to least specific. "Subtotal" is excluded by the
 * lookbehind so a subtotal line can never be mistaken for the total. JUNK
 * absorbs OCR debris between a label and its value ('- °  « ') but never
 * letters or digits, so a total label cannot reach past a real word.
 */
const TOTAL_LABELS = [
  String.raw`total\s*payable`, String.raw`total\s*amount\s*due`, String.raw`balance\s*due`,
  String.raw`amount\s*due`, String.raw`total\s*due`, String.raw`grand\s*total`,
  String.raw`(?<!sub)(?<!sub\s)total\s*(?:incl\.?\s*(?:vat|tax|gst)|ttc|brutto)?`,
]
const JUNK = String.raw`[^\w\n]{0,14}?`
const AMOUNT_PATTERNS = TOTAL_LABELS.map((lab) => new RegExp(String.raw`\b` + lab + String.raw`\b` + JUNK + MONEY, 'i'))
AMOUNT_PATTERNS.push(new RegExp(MONEY + String.raw`\s*due\b`, 'i')) // "$875.00 due"

const DATE_LABEL_PATTERNS = [
  new RegExp(String.raw`\b(?:invoice\s*date|issue\s*date|issued|date\s*of\s*issue|tax\s*point)\s*[:.]?\s*` + DATE_VALUE, 'gi'),
  new RegExp(String.raw`(?<!due\s)(?<!due)\bdate\s*[:.]?\s*` + DATE_VALUE, 'gi'),
  new RegExp(String.raw`\breceipt\s*#?\s*\d+\s+` + DATE_VALUE, 'gi'), // thermal: "Receipt #478 01/16/25"
]
/** Last resort: an unlabelled, unambiguous (year-first) date alone on a line. */
const DATE_BARE_LINE = /^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*$/m

const VENDOR_LABEL_SAMELINE = /^(?:vendor|from|sold\s*by|supplier|company)\s*:?\s*(\S.*)$/im
const VENDOR_LABEL_NEXTLINE = /^(?:vendor|from|sold\s*by|supplier|company)\s*:?\s*$\n(.+)$/im

/** A line starting with any of these is boilerplate, not a company name. */
const BOILERPLATE_START = [
  'invoice', 'receipt', 'bill to', 'ship to', 'page', 'payment', 'customer', 'credit',
  'contact', 'thanks', 'please', 'terms', 'note', 'due', 'total', 'order', 'tax invoice',
  'date', 'ref', 'document', 'account', 'register', 'for ', 'issued', 'commercial',
]
const VENDOR_SCAN_WINDOW = 6
const US_HINTS = /\b(?:USD|EIN|\$|Sales tax|Net 30|, [A-Z]{2} \d{5})/i
const ABBREV_END = /\b(?:ltd|inc|co|corp|gmbh|a\.ş|s\.a|s\.r\.l|as|llc|plc|pty|bv|nv|oy|ab|sas|sarl|kg|ag)\.$/i

/** Python's str.isupper(): all cased chars upper, and at least one exists. */
function isUpper(s: string): boolean {
  return /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s)
}

function looksLikeAName(line: string): boolean {
  const low = line.toLowerCase()
  if (BOILERPLATE_START.some((w) => low.startsWith(w))) return false
  const words = line.trim().split(/\s+/).filter(Boolean)
  if (words.length < 1 || words.length > 6) return false
  if (!/\p{L}/u.test(line)) return false
  if (line === low || (words.length === 1 && !/^\p{Lu}/u.test(line))) return false // "name": a column label
  if (words.length === 1 && ['name', 'address', 'number', 'total', 'amount', 'description', 'quantity'].includes(low)) return false
  if ((line.match(/\d/g) ?? []).length > 3) return false // addresses, tax ids, phone numbers
  const letters = (line.match(/\p{L}/gu) ?? []).length
  if (letters / Math.max(1, line.replace(/\s/g, '').length) < 0.75) return false // OCR debris
  if (words.filter((w) => w.length >= 3).length < Math.max(1, Math.floor(words.length / 2))) return false
  if (low.endsWith('.') && !isUpper(line) && !ABBREV_END.test(low)) return false
  return true
}

function cleanVendor(name: string): string {
  let s = name.replace(/^[^\p{L}\p{N}(]+/u, '') // OCR debris in front
  s = s.replace(/\s*[·|\-–—:.]*\s*(?:tax\s*)?(?:invoice|credit\s*note|receipt|statement)\s*$/i, '')
  // a logo square or stamp in front of the letterhead comes out as "P|", "@B", "(BB";
  // a glued table header comes out as "Pinehollow Office Co Document type"
  s = s.split(/\s+(?:Document|Invoice|Customer|Tax\s+invoice|Date|VAT|Bill\s+to)\b/i)[0]
  const tokens = s.split(/\s+/).filter(Boolean)
  while (tokens.length > 1 && (/[^\p{L}\p{N}&'.-]/u.test(tokens[0]) || (tokens[0].length <= 2 && !['A', 'I'].includes(tokens[0])))) {
    tokens.shift()
  }
  while (tokens.length && (!/\p{L}/u.test(tokens[tokens.length - 1]) || /[+?*=<>|~^_@#%]/.test(tokens[tokens.length - 1]))) {
    tokens.pop()
  }
  s = tokens.join(' ').replace(/\s{2,}/g, ' ').replace(/^[\s,\-·]+|[\s,\-·]+$/g, '')
  if (s.endsWith('.') && !ABBREV_END.test(s)) s = s.slice(0, -1)
  return s
}

function extractNumber(text: string): string | null {
  for (const pattern of NUMBER_PATTERNS) {
    pattern.lastIndex = 0
    for (const m of text.matchAll(pattern)) {
      const cand = m[1].replace(/[.,:]+$/, '')
      if (parseDate(cand, true) !== null) continue // that was a date, not a number
      if (cand.length >= 3) return cand
    }
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
  const preferUS = US_HINTS.test(text)
  for (const pattern of DATE_LABEL_PATTERNS) {
    pattern.lastIndex = 0
    for (const m of text.matchAll(pattern)) {
      const d = parseDate(m[1], preferUS)
      if (d) return d
    }
  }
  const bare = DATE_BARE_LINE.exec(text)
  return bare ? parseDate(bare[1], preferUS) : null
}

function extractVendor(text: string): string | null {
  const sameLine = VENDOR_LABEL_SAMELINE.exec(text)
  if (sameLine && looksLikeAName(sameLine[1].trim())) return cleanVendor(sameLine[1])
  const nextLine = VENDOR_LABEL_NEXTLINE.exec(text)
  if (nextLine && looksLikeAName(nextLine[1].trim())) return cleanVendor(nextLine[1])
  // Positional: the letterhead is the first line that reads like a name.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines.slice(0, VENDOR_SCAN_WINDOW)) {
    const cand = cleanVendor(line)
    if (cand && looksLikeAName(cand)) return cand
  }
  return null
}

/**
 * Normalises line endings (VENDOR_LABEL_NEXTLINE depends on `$\n`) and
 * separates a label glued to its value ("Invoice numberWS-0622"), which
 * both pypdf and pdf.js produce for tightly set table cells.
 */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/([a-z])([A-Z]{2,}|\d)/g, '$1 $2')
    .replace(/ /g, ' ')
}

/**
 * Text in, structured invoice out. Callers that have a File use lib/pdf.ts
 * (and lib/ocr.ts for scans) to get the text first. An empty string is a
 * valid input and yields an invoice with every field null, which downstream
 * reconciliation reports as unreadable rather than as a missing payment.
 */
export function extractFromText(text: string, sourceFile: string, method: ExtractionMethod = 'text'): Invoice {
  const t = normalise(text)
  return {
    sourceFile,
    invoiceNumber: extractNumber(t),
    vendor: extractVendor(t),
    invoiceDate: extractDate(t),
    amount: extractAmount(t),
    extractionMethod: method,
  }
}
