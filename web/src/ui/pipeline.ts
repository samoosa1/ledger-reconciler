/**
 * Orchestrates files -> results, reporting progress as it goes.
 *
 * Kept out of the React components so it can be reasoned about and tested
 * on its own: components render this, they do not implement it.
 */

import { extractFromText } from '../domain/extract'
import { buildLedger } from '../domain/ledger'
import { reconcile } from '../domain/match'
import type { Invoice, LedgerRow, MatchResult } from '../domain/types'
import { readPdfText } from '../lib/pdf'
import { isPdfFile, isSpreadsheetFile, readSheetGrid } from '../lib/sheet'

export type FileStatus = 'pending' | 'reading' | 'done' | 'failed'

export interface FileProgress {
  name: string
  status: FileStatus
  invoice?: Invoice
  error?: string
}

export interface PipelineOutput {
  invoices: Invoice[]
  rows: LedgerRow[]
  results: MatchResult[]
}

/** Sorts a dropped set into invoices and a ledger, by extension. */
export function sortDroppedFiles(files: File[]): {
  invoices: File[]
  ledgers: File[]
  ignored: File[]
} {
  const invoices: File[] = []
  const ledgers: File[] = []
  const ignored: File[] = []
  for (const f of files) {
    if (isPdfFile(f.name)) invoices.push(f)
    else if (isSpreadsheetFile(f.name)) ledgers.push(f)
    else ignored.push(f)
  }
  invoices.sort((a, b) => a.name.localeCompare(b.name))
  return { invoices, ledgers, ignored }
}

/**
 * Reads every invoice, one at a time.
 *
 * Sequential rather than Promise.all deliberately: a folder of scanned
 * invoices decoded concurrently can exhaust memory on a modest machine,
 * and progress reported from parallel work is not honest about what is
 * actually finished.
 */
export async function readInvoices(
  files: File[],
  onProgress: (progress: FileProgress[]) => void,
): Promise<FileProgress[]> {
  const progress: FileProgress[] = files.map((f) => ({ name: f.name, status: 'pending' }))
  onProgress([...progress])

  for (let i = 0; i < files.length; i++) {
    progress[i] = { ...progress[i], status: 'reading' }
    onProgress([...progress])
    try {
      const text = await readPdfText(files[i], files[i].name)
      progress[i] = {
        name: files[i].name,
        status: 'done',
        invoice: extractFromText(text, files[i].name),
      }
    } catch (e) {
      progress[i] = {
        name: files[i].name,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      }
    }
    onProgress([...progress])
  }
  return progress
}

/** Reconciles already-read invoices against a ledger file. */
export async function reconcileAgainstLedger(
  invoices: Invoice[],
  ledgerFile: File,
): Promise<PipelineOutput> {
  const grid = await readSheetGrid(ledgerFile, ledgerFile.name)
  const rows = buildLedger(grid)
  return { invoices, rows, results: reconcile(invoices, rows) }
}

export interface Summary {
  total: number
  matched: number
  flagged: number
  matchRate: number
  counts: Record<string, number>
}

export function summarise(results: MatchResult[]): Summary {
  const matched = results.filter((r) => r.flags.length === 0).length
  const counts: Record<string, number> = {}
  for (const r of results) {
    for (const f of r.flags) counts[f] = (counts[f] ?? 0) + 1
  }
  return {
    total: results.length,
    matched,
    flagged: results.length - matched,
    matchRate: results.length === 0 ? 0 : matched / results.length,
    counts,
  }
}

/** Plain-language labels; the raw flag names are for code, not people. */
export const FLAG_LABELS: Record<string, string> = {
  unreadable_invoice: 'Could not read invoice',
  no_ledger_entry: 'No matching payment',
  no_invoice: 'Payment with no invoice',
  amount_mismatch: 'Amount differs',
  duplicate_invoice: 'Duplicate invoice',
}

export const FLAG_EXPLANATIONS: Record<string, string> = {
  unreadable_invoice:
    'No usable text could be extracted from this PDF. It is most likely a scan; this tool reads text, not images.',
  no_ledger_entry:
    'The invoice exists but no matching payment appears in the ledger.',
  no_invoice:
    'A payment appears in the ledger with no invoice on file to support it.',
  amount_mismatch:
    'The invoice and the ledger entry were matched, but the amounts differ.',
  duplicate_invoice:
    'This invoice number appears more than once, so the same invoice may be recorded twice.',
}

/** Loads the bundled synthetic sample set so the tool can be tried without files. */
export async function loadSampleFiles(baseUrl: string): Promise<{
  invoices: File[]
  ledger: File
}> {
  const manifest = (await (await fetch(`${baseUrl}sample/manifest.json`)).json()) as {
    invoices: string[]
    ledger: string
  }

  const invoices: File[] = []
  for (const name of manifest.invoices) {
    const blob = await (await fetch(`${baseUrl}sample/invoices/${name}`)).blob()
    invoices.push(new File([blob], name, { type: 'application/pdf' }))
  }
  const ledgerBlob = await (await fetch(`${baseUrl}sample/${manifest.ledger}`)).blob()
  return {
    invoices,
    ledger: new File([ledgerBlob], manifest.ledger, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  }
}
