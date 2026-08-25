/**
 * File -> page-1 text, via pdf.js. The browser edge of extraction; the
 * parsing itself lives in domain/extract.ts.
 *
 * Only page 1 is read, matching the Python version: an invoice's headline
 * fields are always on the first page, and reading further only risks
 * pulling a later page's text into the match.
 */

import type * as PdfjsTypes from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

/**
 * pdf.js is loaded on first read, not at module scope. It is the heaviest
 * dependency in the app and nothing on the landing page needs it: a
 * visitor who never drops a file never pays for a PDF engine.
 *
 * The worker URL stays a static import. `?url` is the Vite-specific way to
 * get an asset's final hashed URL, and it emits only that string into the
 * bundle, not the worker itself. It has to be an import: `new
 * URL('pdfjs-dist/...', import.meta.url)` looks equivalent but is not,
 * because Vite does not resolve bare package specifiers inside `new
 * URL()`. That form silently produces a path relative to this file and
 * pdf.js then fails to start its worker.
 *
 * Under Node (the test run) there is no worker to fetch. The legacy build
 * parses inline, and handing it a browser asset URL makes it try to import
 * a path that does not exist there.
 */
const isBrowser = typeof window !== 'undefined'

let cached: typeof PdfjsTypes | undefined

async function loadPdfjs(): Promise<typeof PdfjsTypes> {
  if (!cached) {
    cached = await import('pdfjs-dist')
    if (isBrowser) {
      cached.GlobalWorkerOptions.workerSrc = workerUrl
    }
  }
  return cached
}

/**
 * Failures that mean "this file has no readable text", not "the reader
 * broke". These degrade to an empty string so one unreadable file among
 * dozens does not abort the batch.
 */
const BENIGN_READ_FAILURE = /InvalidPDF|Invalid PDF|Corrupt|password|Missing PDF|Empty file/i

export class PdfReadError extends Error {}

/** Distinguishes a real text item from the marked-content entries pdf.js
 * interleaves into the same array. */
function isTextItem(item: unknown): item is TextItem {
  return typeof item === 'object' && item !== null && 'str' in item
}

/**
 * Reassembles page text with line breaks preserved.
 *
 * pdf.js hands back positioned fragments, not lines. Joining them with
 * spaces would destroy every newline, and domain/extract.ts depends on
 * newlines for the next-line vendor rule and for its line-window scan. So
 * fragments are grouped by their vertical position, using the transform
 * matrix' translateY, and each group becomes one line.
 *
 * `hasEOL` alone is not enough: it is set per-fragment by the text layer
 * and is absent in plenty of real documents, including ones in this
 * project's own fixtures.
 */
function assemble(items: unknown[]): string {
  const lines: Array<{ y: number; parts: string[] }> = []
  const TOLERANCE = 2 // points; fragments within this are the same line

  for (const item of items) {
    if (!isTextItem(item)) continue
    if (item.str === '') continue
    const y = item.transform[5] as number

    const existing = lines.find((l) => Math.abs(l.y - y) <= TOLERANCE)
    if (existing) existing.parts.push(item.str)
    else lines.push({ y, parts: [item.str] })
  }

  // PDF y-coordinates grow upward, so descending y is top-to-bottom.
  lines.sort((a, b) => b.y - a.y)
  return lines.map((l) => l.parts.join('').trim()).join('\n')
}

/**
 * Returns page-1 text, or an empty string when there is none to extract.
 *
 * A corrupt file, a zero-byte upload, or a scanned image with no text
 * layer all degrade to "" rather than throwing, so one bad file among
 * dozens does not abort the batch. Downstream that surfaces as
 * `unreadable_invoice`, which is a visible, honest result. Only a genuine
 * pdf.js failure is rethrown as PdfReadError.
 */
export async function readPdfText(file: Blob, fileName: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length === 0) return ''

  const pdfjs = await loadPdfjs()

  // The loading task, not the document proxy, owns teardown in pdf.js v6:
  // the proxy exposes only cleanup(), which frees page resources but
  // leaves the worker's document alive.
  const task = pdfjs.getDocument({ data: bytes })
  try {
    const doc = await task.promise
    if (doc.numPages < 1) return ''
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    return assemble(content.items)
  } catch (cause) {
    // pdf.js puts the identifier on `name` (InvalidPDFException) while
    // `message` reads "Invalid PDF structure.", so both must be checked:
    // matching only the message misses the class of error entirely.
    if (cause instanceof Error && BENIGN_READ_FAILURE.test(`${cause.name} ${cause.message}`)) {
      return ''
    }
    throw new PdfReadError(`Could not read ${fileName}: ${String(cause)}`, { cause })
  } finally {
    // Must run on every path, including the numPages early return and the
    // swallowed-corrupt-file return. Processing a folder of invoices
    // otherwise leaks one live worker document per file.
    await task.destroy()
  }
}
