import { toISO } from '../domain/dates'
import type { FileProgress } from './pipeline'

interface Props {
  progress: FileProgress[]
  ledgerName: string | null
  onContinue: () => void
  busy: boolean
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * What was read from each invoice, shown BEFORE any matching happens.
 *
 * Extraction is the fragile step, and a user who never sees it fail will
 * blame the matching instead. Surfacing it here means a bad scan reads as
 * "this file could not be read" rather than "this tool is wrong", and it
 * puts the no-OCR limitation in front of the reader at the only moment it
 * is relevant.
 */
export function ExtractionReview({ progress, ledgerName, onContinue, busy }: Props) {
  const done = progress.filter((p) => p.status === 'done' || p.status === 'failed').length
  const finished = done === progress.length
  const unreadable = progress.filter(
    (p) =>
      p.status === 'failed' ||
      (p.invoice && p.invoice.invoiceNumber === null && p.invoice.amount === null),
  ).length

  return (
    <section className="rise">
      <div className="stage-head">
        <h2>What was read from each invoice</h2>
        <span className="muted">
          {done} of {progress.length}
          {ledgerName && <span className="faint"> · {ledgerName}</span>}
        </span>
      </div>

      {finished && unreadable > 0 && (
        <p className="notice warn">
          {unreadable} {unreadable === 1 ? 'file' : 'files'} could not be read.
          That usually means a scanned image rather than a text PDF. These are
          reported as unverifiable rather than silently dropped.
        </p>
      )}

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>File</th>
              <th>Invoice</th>
              <th>Vendor</th>
              <th>Date</th>
              <th className="num">Amount</th>
              <th>Read</th>
            </tr>
          </thead>
          <tbody>
            {progress.map((p) => {
              const inv = p.invoice
              const partial =
                inv !== undefined &&
                (inv.invoiceNumber === null || inv.amount === null || inv.invoiceDate === null)
              return (
                <tr key={p.name}>
                  <td className="mono clip">{p.name}</td>
                  <td className="mono">{inv?.invoiceNumber ?? <span className="faint">—</span>}</td>
                  <td className="clip">{inv?.vendor ?? <span className="faint">—</span>}</td>
                  <td className="mono">
                    {inv?.invoiceDate ? toISO(inv.invoiceDate) : <span className="faint">—</span>}
                  </td>
                  <td className="num mono">{money(inv?.amount)}</td>
                  <td>
                    {p.status === 'pending' && <span className="tag idle">queued</span>}
                    {p.status === 'reading' && <span className="tag live">reading</span>}
                    {p.status === 'done' && !partial && <span className="tag ok">read</span>}
                    {p.status === 'done' && partial && <span className="tag warn">partial</span>}
                    {p.status === 'failed' && <span className="tag bad">failed</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="actions">
        <span className="muted">
          {finished
            ? 'Nothing has been matched yet.'
            : 'Reading each file in turn…'}
        </span>
        <button
          className="btn primary push"
          onClick={onContinue}
          disabled={!finished || busy}
          type="button"
        >
          {finished ? 'Reconcile against ledger' : 'Reading…'}
        </button>
      </div>
    </section>
  )
}
