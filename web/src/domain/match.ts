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
 *
 * Two payment shapes that are common in practice and look like errors to a
 * naive matcher are recognised explicitly and reported as informational
 * flags rather than as amount mismatches:
 *   - paid_in_instalments: several rows carry the same reference and
 *     together sum to the invoice.
 *   - combined_payment: one row's reference names several invoice numbers
 *     and its amount is their sum.
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

function findAllByReference(invoice: Invoice, rows: LedgerRow[]): LedgerRow[] {
  if (!invoice.invoiceNumber) return []
  return rows.filter((row) => row.reference !== null && row.reference === invoice.invoiceNumber)
}

function referenceTokens(reference: string | null): string[] {
  return reference ? reference.trim().split(/[\s,;+/&]+/).filter(Boolean) : []
}

/** A row whose reference lists this invoice number among others. */
function findCombined(invoice: Invoice, rows: LedgerRow[]): LedgerRow | null {
  if (!invoice.invoiceNumber) return null
  for (const row of rows) {
    const toks = referenceTokens(row.reference)
    if (toks.length >= 2 && toks.includes(invoice.invoiceNumber)) return row
  }
  return null
}

function remove(rows: LedgerRow[], row: LedgerRow): void {
  rows.splice(rows.indexOf(row), 1)
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

  // Combined payments are resolved first, across invoices: one ledger row
  // settles several invoices, so it is consumed once and every invoice it
  // names gets the same row.
  const combined = new Map<LedgerRow, Invoice[]>()
  for (const inv of invoices) {
    const row = findCombined(inv, unmatchedLedger)
    if (row) combined.set(row, [...(combined.get(row) ?? []), inv])
  }
  const combinedRows = new Map<Invoice, LedgerRow>()
  for (const [row, invList] of combined) {
    if (invList.length < 2 || invList.some((i) => i.amount === null)) continue
    const total = invList.reduce((acc, i) => acc + (i.amount as number), 0)
    if (amountsClose(total, row.amount)) {
      remove(unmatchedLedger, row)
      for (const i of invList) combinedRows.set(i, row)
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
    // "no_ledger_entry" would assert a finding that was never tested.
    const canAttempt =
      Boolean(inv.invoiceNumber) || (inv.amount !== null && inv.invoiceDate !== null)

    let match: LedgerRow | null = null
    let extraRows: LedgerRow[] = []
    const combinedRow = combinedRows.get(inv)
    if (combinedRow) {
      match = combinedRow
      flags.push('combined_payment')
    } else if (canAttempt) {
      const sameRef = findAllByReference(inv, unmatchedLedger)
      const refSum = sameRef.reduce((acc, r) => acc + (r.amount ?? 0), 0)
      if (sameRef.length >= 2 && inv.amount !== null && amountsClose(refSum, inv.amount)) {
        match = sameRef[0]
        extraRows = sameRef.slice(1)
        for (const r of sameRef) remove(unmatchedLedger, r)
        flags.push('paid_in_instalments')
      } else {
        match = findByReference(inv, unmatchedLedger) ?? findByAmountAndDate(inv, unmatchedLedger)
        if (match) {
          remove(unmatchedLedger, match)
          // An unread amount is already reported as unreadable_invoice;
          // calling it a mismatch would assert a comparison never made.
          if (inv.amount !== null && !amountsClose(inv.amount, match.amount)) {
            flags.push('amount_mismatch')
          }
        } else {
          flags.push('no_ledger_entry')
        }
      }
    }

    if (inv.invoiceNumber && (numberCounts.get(inv.invoiceNumber) ?? 0) > 1) {
      flags.push('duplicate_invoice')
    }

    results.push({ invoice: inv, ledgerRow: match, flags, extraRows })
  }

  for (const row of unmatchedLedger) {
    results.push({ invoice: null, ledgerRow: row, flags: ['no_invoice'], extraRows: [] })
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
  // A combined payment's row appears on several results and an instalment
  // sits in extraRows, so count distinct rows rather than result rows.
  const seenRows = new Set<LedgerRow>()
  for (const r of results) {
    if (r.ledgerRow) seenRows.add(r.ledgerRow)
    for (const x of r.extraRows) seenRows.add(x)
  }
  const seenLedger = seenRows.size

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
