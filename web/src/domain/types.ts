import type { PlainDate } from './dates'

/**
 * Mirrors ledger_reconciler/models.py.
 *
 * Field names are camelCase rather than the Python snake_case, because
 * this is idiomatic TypeScript and the two codebases are read separately.
 * tools/crosscheck.mjs maps between the two when diffing outputs.
 *
 * `null` is used rather than `undefined` throughout, mirroring Python's
 * `| None`: a field is either present or explicitly absent. `undefined`
 * would additionally mean "key missing", a third state the Python model
 * has no equivalent for.
 */

/** How the fields were obtained. Mirrors Invoice.extraction_method. */
export type ExtractionMethod = 'text' | 'ocr' | 'none'

export interface Invoice {
  sourceFile: string
  invoiceNumber: string | null
  vendor: string | null
  invoiceDate: PlainDate | null
  amount: number | null
  /** 'ocr' means the values came from image recognition and deserve a second look. */
  extractionMethod: ExtractionMethod
}

export interface LedgerRow {
  /** 1-based, matches the spreadsheet row so a finding is traceable. */
  rowIndex: number
  ledgerDate: PlainDate | null
  description: string
  reference: string | null
  amount: number | null
}

/** The flags a result can carry. Mirrors the Python string literals. */
export type Flag =
  | 'unreadable_invoice'
  | 'no_ledger_entry'
  | 'no_invoice'
  | 'amount_mismatch'
  | 'duplicate_invoice'
  | 'paid_in_instalments'
  | 'combined_payment'

export interface MatchResult {
  invoice: Invoice | null
  ledgerRow: LedgerRow | null
  flags: Flag[]
  /**
   * Further ledger rows that settle the same invoice (instalments). The
   * first row stays in ledgerRow so single-row consumers keep working.
   */
  extraRows: LedgerRow[]
}

/** Equivalent to MatchResult.status in the Python model. */
export function status(result: MatchResult): string {
  return result.flags.length === 0 ? 'matched' : result.flags.join(', ')
}
