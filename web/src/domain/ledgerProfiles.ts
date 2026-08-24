/**
 * Column-name profiles for the ledger exports of the accounting platforms
 * most small US/UK/AU clients actually use. Mirrors
 * ledger_reconciler/ledger_profiles.py.
 *
 * Adding support for a new platform means adding one entry here, not
 * touching the reconciliation logic. Each field lists ALIASES, matched
 * case-insensitively against the header row, because a platform's exact
 * wording varies by region and version.
 *
 * Sourced against documented export formats where confirmed. The
 * QuickBooks entry is the well-known common column set but was not
 * verified against a live export the way the other three were, so it is
 * deliberately marked lower-confidence: if a real export disagrees, the
 * fix is one alias here, not a code change.
 */

export interface LedgerProfile {
  name: string
  dateAliases: string[]
  descriptionAliases: string[]
  amountAliases?: string[]
  /** Used instead of amountAliases when the platform splits debit/credit. */
  debitAliases?: string[]
  creditAliases?: string[]
  referenceAliases?: string[]
}

export function usesDebitCreditSplit(p: LedgerProfile): boolean {
  return Boolean(p.debitAliases?.length || p.creditAliases?.length)
}

export const PROFILES: LedgerProfile[] = [
  {
    name: 'Xero',
    dateAliases: ['date'],
    descriptionAliases: ['description'],
    debitAliases: ['debit'],
    creditAliases: ['credit'],
    referenceAliases: ['reference'],
  },
  {
    name: 'Wave',
    dateAliases: ['date'],
    descriptionAliases: ['description'],
    amountAliases: ['amount'],
  },
  {
    name: 'FreshBooks',
    dateAliases: ['date'],
    descriptionAliases: ['vendor', 'category'],
    amountAliases: ['amount'],
  },
  {
    name: 'QuickBooks', // lower confidence, see module comment
    dateAliases: ['date'],
    descriptionAliases: ['memo/description', 'memo', 'description', 'name'],
    amountAliases: ['amount'],
    referenceAliases: ['num'],
  },
  {
    name: 'Generic',
    dateAliases: ['date'],
    descriptionAliases: ['description'],
    amountAliases: ['amount'],
    referenceAliases: ['reference'],
  },
]

/** Which header index each logical field resolved to. */
export type ResolvedColumns = Partial<
  Record<'date' | 'description' | 'amount' | 'debit' | 'credit' | 'reference', number>
>

export interface Detection {
  profile: LedgerProfile
  columns: ResolvedColumns
}

function firstMatch(headers: string[], aliases: string[] | undefined): number | null {
  for (const alias of aliases ?? []) {
    const i = headers.indexOf(alias)
    if (i !== -1) return i
  }
  return null
}

function tryProfile(p: LedgerProfile, headers: string[]): ResolvedColumns | null {
  const dateIdx = firstMatch(headers, p.dateAliases)
  const descIdx = firstMatch(headers, p.descriptionAliases)
  if (dateIdx === null || descIdx === null) return null

  const columns: ResolvedColumns = { date: dateIdx, description: descIdx }

  if (usesDebitCreditSplit(p)) {
    const debitIdx = firstMatch(headers, p.debitAliases)
    const creditIdx = firstMatch(headers, p.creditAliases)
    if (debitIdx === null && creditIdx === null) return null
    if (debitIdx !== null) columns.debit = debitIdx
    if (creditIdx !== null) columns.credit = creditIdx
  } else {
    const amountIdx = firstMatch(headers, p.amountAliases)
    if (amountIdx === null) return null
    columns.amount = amountIdx
  }

  const refIdx = firstMatch(headers, p.referenceAliases)
  if (refIdx !== null) columns.reference = refIdx

  return columns
}

/**
 * Returns whichever profile resolves the MOST columns, not simply the first
 * whose minimum is satisfied.
 *
 * This mattered in practice: a generic Date/Description/Reference/Amount
 * sheet also satisfies Wave's looser requirements, and first-match-wins
 * picked Wave and silently dropped the reference column that was sitting
 * right there, degrading exact-reference matching to amount-and-date
 * guessing. `headers` must already be lowercased and trimmed.
 */
export function detectProfile(headers: string[]): Detection | null {
  let best: Detection | null = null
  for (const profile of PROFILES) {
    const columns = tryProfile(profile, headers)
    if (!columns) continue
    if (best === null || Object.keys(columns).length > Object.keys(best.columns).length) {
      best = { profile, columns }
    }
  }
  return best
}
