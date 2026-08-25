import { toISO } from '../domain/dates'
import type { FileProgress } from './pipeline'

interface Props {
  progress: FileProgress[]
  ledgerName: string | null
  onContinue: () => void
  onReset: () => void
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Shows what was read out of each invoice BEFORE any matching happens.
 *
 * Extraction is the failure-prone step, and a user who never sees it fail
 * will blame the matching instead. Surfacing it here means a bad scan
 * reads as "this PDF could not be read" rather than "this tool is wrong",
 * and it puts the no-OCR limitation in front of them at the only moment
 * it is relevant.
 */
export function ExtractionReview({ progress, ledgerName, onContinue, onReset }: Props) {
  const done = progress.filter((p) => p.status === 'done' || p.status === 'failed').length
  const finished = done === progress.length
  const unreadable = progress.filter(
    (p) => p.status === 'failed' || (p.invoice && p.invoice.invoiceNumber === null && p.invoice.amount === null),
  ).length

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>What was read from each invoice</h2>
        <span className="muted">
          {done} of {progress.length} files
          {ledgerName ? ` · ledger: ${ledgerName}` : ''}
        </span>
      </div>

      {finished && unreadable > 0 && (
        <p className="notice warn">
          {unreadable} {unreadable === 1 ? 'file' : 'files'} could not be read. That
          usually means a scanned image rather than a text PDF; this tool reads
          text and does not run OCR. Those invoices are reported as unverifiable
          rather than silently dropped.
        </p>
      )}

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>File</th>
              <th>Invoice #</th>
              <th>Vendor</th>
              <th>Date</th>
              <th className="num">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {progress.map((p) => {
              const inv = p.invoice
              const bad = p.status === 'failed'
              const partial =
                inv && (inv.invoiceNumber === null || inv.amount === null || inv.invoiceDate === null)
              return (
                <tr key={p.name} className={bad ? 'row-bad' : partial ? 'row-warn' : ''}>
                  <td className="mono">{p.name}</td>
                  <td className="mono">{inv?.invoiceNumber ?? '—'}</td>
                  <td>{inv?.vendor ?? '—'}</td>
                  <td className="mono">{inv?.invoiceDate ? toISO(inv.invoiceDate) : '—'}</td>
                  <td className="num mono">{money(inv?.amount)}</td>
                  <td>
                    {p.status === 'pending' && <span className="pill">waiting</span>}
                    {p.status === 'reading' && <span className="pill reading">reading…</span>}
                    {p.status === 'done' && !partial && <span className="pill ok">read</span>}
                    {p.status === 'done' && partial && <span className="pill warn">partial</span>}
                    {p.status === 'failed' && <span className="pill bad">failed</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="actions">
        <button className="btn" onClick={onReset} type="button">
          Start over
        </button>
        <button className="btn primary" onClick={onContinue} disabled={!finished} type="button">
          {finished ? 'Reconcile against ledger' : 'Reading…'}
        </button>
      </div>
    </section>
  )
}
