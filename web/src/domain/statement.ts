/**
 * Per-counterparty statement with ageing, derived from reconciliation.
 *
 * Reconciliation answers "does this invoice tie out". A payables clerk
 * then asks the next question: per supplier, what is still open and how
 * old is it. Both answers come from the same match results, so this is a
 * projection of them rather than a second pass over the documents.
 *
 * The rule that governs the rest of this project governs it here too: a
 * figure that cannot be established is declared, never estimated. An
 * invoice whose amount could not be read is counted in
 * `unreadableCount` and kept out of the money columns, and one with no
 * readable date lands in the `undated` bucket instead of being assumed
 * current. A statement that quietly rounded those into zero would look
 * tidier and would be a lie.
 */

import { daysBetween } from './dates'
import type { PlainDate } from './dates'
import { AMOUNT_TOLERANCE } from './match'
import type { MatchResult } from './types'

/** Ageing bands, in days since the invoice date. */
export type AgeBucket = 'd0_30' | 'd31_60' | 'd61_90' | 'd90_plus' | 'undated'

export const AGE_BUCKETS: AgeBucket[] = ['d0_30', 'd31_60', 'd61_90', 'd90_plus', 'undated']

export const BUCKET_LABELS: Record<AgeBucket, string> = {
  d0_30: '0-30 days',
  d31_60: '31-60 days',
  d61_90: '61-90 days',
  d90_plus: 'over 90 days',
  undated: 'no readable date',
}

export interface StatementLine {
  sourceFile: string
  invoiceNumber: string | null
  invoiceDate: PlainDate | null
  /** Invoiced amount, or null when it could not be read. */
  amount: number | null
  /** Still open. Negative means the ledger paid more than the invoice. */
  outstanding: number
  /** Days since the invoice date, or null when there is no readable date. */
  ageDays: number | null
  bucket: AgeBucket
}

export interface CounterpartyStatement {
  /** null when the vendor could not be read off the document. */
  vendor: string | null
  invoiceCount: number
  /** Invoices whose amount could not be read, so they are in no total. */
  unreadableCount: number
  billed: number
  settled: number
  /**
   * Still owed. Only shortfalls, never netted against an overpayment
   * somewhere else on the account.
   */
  outstanding: number
  /**
   * Paid beyond what was invoiced, as a positive figure. Kept out of
   * `outstanding` on purpose: a ledger row ten times its invoice is a
   * query to raise, not credit against an unrelated unpaid invoice.
   * Netting the two produces a balance that is arithmetically true and
   * operationally meaningless.
   */
  overpaid: number
  /** Ageing covers the outstanding side only; an overpayment has no age. */
  buckets: Record<AgeBucket, number>
  lines: StatementLine[]
}

function emptyBuckets(): Record<AgeBucket, number> {
  return { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, undated: 0 }
}

function bucketFor(ageDays: number | null): AgeBucket {
  if (ageDays === null) return 'undated'
  if (ageDays <= 30) return 'd0_30'
  if (ageDays <= 60) return 'd31_60'
  if (ageDays <= 90) return 'd61_90'
  return 'd90_plus'
}

/**
 * How much of an invoice the ledger did not settle.
 *
 * A matched row settles its invoice, and instalments settle it across
 * several rows, so the settled figure is the sum of every row attached to
 * the result. Under the tolerance the invoice is closed; a real gap stays
 * open, and an overpayment is reported as a negative rather than clamped
 * to zero, because "we paid more than we were billed" is a finding.
 */
function openAmount(result: MatchResult): number {
  if (result.invoice?.amount == null) return 0
  const rows = [result.ledgerRow, ...result.extraRows]
  const settled = rows.reduce((sum, r) => sum + (r?.amount ?? 0), 0)
  const gap = result.invoice.amount - settled
  return Math.abs(gap) <= AMOUNT_TOLERANCE ? 0 : gap
}

/**
 * The most recent date anywhere in the data, used as the ageing date.
 *
 * Deliberately not the clock: a statement built from a fixed set of
 * documents should not change its ageing because it was opened a week
 * later, and a test whose expectations drift daily is not a test.
 */
export function latestDate(results: MatchResult[]): PlainDate | null {
  let latest: PlainDate | null = null
  for (const r of results) {
    for (const d of [r.invoice?.invoiceDate, r.ledgerRow?.ledgerDate]) {
      if (d && (latest === null || daysBetween(d, latest) > 0)) latest = d
    }
  }
  return latest
}

/**
 * Groups the results by counterparty. Invoices with no readable vendor are
 * collected under `vendor: null` rather than dropped, so every document
 * that entered the pipeline appears in exactly one statement.
 *
 * Ledger rows with no invoice are not represented here: they belong to the
 * exception report, which names them individually. A statement that folded
 * them into a supplier balance would be attributing a payment to a
 * counterparty nobody confirmed.
 */
export function buildStatements(
  results: MatchResult[],
  asOf: PlainDate | null = null,
): CounterpartyStatement[] {
  const ageDate = asOf ?? latestDate(results)
  const byVendor = new Map<string | null, CounterpartyStatement>()

  for (const result of results) {
    const invoice = result.invoice
    if (!invoice) continue

    const key = invoice.vendor
    let stmt = byVendor.get(key)
    if (!stmt) {
      stmt = {
        vendor: key,
        invoiceCount: 0,
        unreadableCount: 0,
        billed: 0,
        settled: 0,
        outstanding: 0,
        overpaid: 0,
        buckets: emptyBuckets(),
        lines: [],
      }
      byVendor.set(key, stmt)
    }

    const outstanding = openAmount(result)
    const ageDays =
      invoice.invoiceDate && ageDate ? daysBetween(ageDate, invoice.invoiceDate) : null
    const bucket = bucketFor(ageDays)

    stmt.invoiceCount += 1
    if (invoice.amount === null) {
      stmt.unreadableCount += 1
    } else {
      stmt.billed += invoice.amount
      stmt.settled += invoice.amount - outstanding
      if (outstanding < 0) {
        stmt.overpaid += -outstanding
      } else {
        stmt.outstanding += outstanding
        stmt.buckets[bucket] += outstanding
      }
    }

    stmt.lines.push({
      sourceFile: invoice.sourceFile,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      amount: invoice.amount,
      outstanding,
      ageDays,
      bucket,
    })
  }

  // Largest exposure first; a clerk works down the list. Exposure counts
  // an overpayment too, since money paid twice is as worth chasing as
  // money not paid. Unattributed invoices sort last regardless, being a
  // data problem rather than a balance to chase.
  return [...byVendor.values()].sort((a, b) => {
    if ((a.vendor === null) !== (b.vendor === null)) return a.vendor === null ? 1 : -1
    return b.outstanding + b.overpaid - (a.outstanding + a.overpaid)
  })
}
