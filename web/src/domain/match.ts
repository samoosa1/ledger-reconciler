/**
 * Matches invoices against ledger rows and flags what does not line up.
 * Mirrors ledger_reconciler/match.py.
 *
 * Matching order:
 *   1. Exact: ledger reference equals the invoice number.
 *   2. Fallback: same amount, ledger date within DATE_WINDOW_DAYS of the
 *      invoice date, and the vendor name appears (fuzzily) in the ledger
 *      description.
 *
 * Anything left over on either side is reported as unmatched.
 */

import { daysBetween } from './dates'
import { sequenceRatio } from './similarity'
import type { Flag, Invoice, LedgerRow, MatchResult } from './types'

export const DATE_WINDOW_DAYS = 5
export const AMOUNT_TOLERANCE = 0.01
export const VENDOR_SIMILARITY_THRESHOLD = 0.5

/**
 * Raised when an invoice or ledger row goes into reconcile() and does not
 * come back out. That is a bug in the matching logic, not a data problem.
 * A silent drop is worse than a wrong flag, because a wrong flag gets
 * noticed and a missing row does not.
 */
export class CoverageError extends Error {}

function vendorInDescription(vendor: string | null, description: string): boolean {
  if (!vendor) return false
  const v = vendor.toLowerCase()
  const d = description.toLowerCase()
  if (d.includes(v)) return true
  // Argument order matters: sequenceRatio is asymmetric. See
  // tests/similarity.test.ts, which pins both directions.
  return sequenceRatio(v, d) >= VENDOR_SIMILARITY_THRESHOLD
}

function amountsClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false
  return Math.abs(a - b) <= AMOUNT_TOLERANCE
}

function findByReference(invoice: Invoice, rows: LedgerRow[]): LedgerRow | null {
  if (!invoice.invoiceNumber) return null
  for (const row of rows) {
    if (row.reference && row.reference === invoice.invoiceNumber) return row
  }
  return null
}

function findByAmountAndDate(invoice: Invoice, rows: LedgerRow[]): LedgerRow | null {
  if (invoice.amount === null || invoice.invoiceDate === null) return null

  const candidates: LedgerRow[] = []
  for (const row of rows) {
    if (!amountsClose(row.amount, invoice.amount) || row.ledgerDate === null) continue
    if (Math.abs(daysBetween(row.ledgerDate, invoice.invoiceDate)) > DATE_WINDOW_DAYS) continue
    candidates.push(row)
  }
  if (candidates.length === 1) return candidates[0]

  // Ambiguous (none, or several) — narrow by vendor name if that resolves
  // it to exactly one. Otherwise report no match rather than pick.
  const byVendor = candidates.filter((r) => vendorInDescription(invoice.vendor, r.description))
  return byVendor.length === 1 ? byVendor[0] : null
}

export function reconcile(invoices: Invoice[], ledgerRows: LedgerRow[]): MatchResult[] {
  const results: MatchResult[] = []
  const unmatchedLedger = [...ledgerRows]

  const numberCounts = new Map<string, number>()
  for (const inv of invoices) {
    if (inv.invoiceNumber) {
      numberCounts.set(inv.invoiceNumber, (numberCounts.get(inv.invoiceNumber) ?? 0) + 1)
    }
  }

  for (const inv of invoices) {
    const flags: Flag[] = []
    if (
      inv.invoiceNumber === null || inv.vendor === null ||
      inv.invoiceDate === null || inv.amount === null
    ) {
      flags.push('unreadable_invoice')
    }

    // Both strategies need either an invoice number or an amount+date pair.
    // With neither there is nothing to search on, and reporting
    // "no_ledger_entry" would assert a finding that was never tested: it
    // would claim a search happened and came up empty. One means the
    // payment may genuinely be missing, the other means nothing can be
    // said about this invoice at all.
    const canAttempt =
      Boolean(inv.invoiceNumber) || (inv.amount !== null && inv.invoiceDate !== null)

    let match: LedgerRow | null = null
    if (canAttempt) {
      match = findByReference(inv, unmatchedLedger) ?? findByAmountAndDate(inv, unmatchedLedger)
      if (match) {
        unmatchedLedger.splice(unmatchedLedger.indexOf(match), 1)
        if (!amountsClose(inv.amount, match.amount)) flags.push('amount_mismatch')
      } else {
        flags.push('no_ledger_entry')
      }
    }

    if (inv.invoiceNumber && (numberCounts.get(inv.invoiceNumber) ?? 0) > 1) {
      flags.push('duplicate_invoice')
    }

    results.push({ invoice: inv, ledgerRow: match, flags })
  }

  for (const row of unmatchedLedger) {
    results.push({ invoice: null, ledgerRow: row, flags: ['no_invoice'] })
  }

  assertFullCoverage(invoices, ledgerRows, results)
  return results
}

/**
 * reconcile()'s invariant is not the same shape as a rule-based bucket
 * classification: there is no pattern matching here, only "did every input
 * row make it into the output exactly once".
 */
function assertFullCoverage(
  invoices: Invoice[], ledgerRows: LedgerRow[], results: MatchResult[],
): void {
  const seenInvoices = results.filter((r) => r.invoice !== null).length
  const seenLedger = results.filter((r) => r.ledgerRow !== null).length

  if (seenInvoices !== invoices.length) {
    throw new CoverageError(
      `${invoices.length} invoices went in, ${seenInvoices} came back out — ` +
        `reconcile() dropped ${invoices.length - seenInvoices}.`,
    )
  }
  if (seenLedger !== ledgerRows.length) {
    throw new CoverageError(
      `${ledgerRows.length} ledger rows went in, ${seenLedger} came back out — ` +
        `reconcile() dropped ${ledgerRows.length - seenLedger}.`,
    )
  }
}
