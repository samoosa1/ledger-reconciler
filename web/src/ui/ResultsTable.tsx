import { Fragment, useState } from 'react'
import { toISO } from '../domain/dates'
import type { MatchResult } from '../domain/types'
import { FLAG_EXPLANATIONS, FLAG_LABELS, summarise } from './pipeline'

interface Props {
  results: MatchResult[]
  onReset: () => void
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ResultsTable({ results, onReset }: Props) {
  const [filter, setFilter] = useState<string | null>(null)
  // Keyed by stable identity, not list index: filtering reorders `shown`,
  // so an index would leave a different row expanded than the one clicked.
  const [openRow, setOpenRow] = useState<string | null>(null)
  const summary = summarise(results)

  const shown = filter
    ? results.filter((r) => (r.flags as string[]).includes(filter))
    : results

  return (
    <section className="panel">
      <div className="stat-strip">
        <Stat label="Items" value={String(summary.total)} />
        <Stat label="Matched" value={String(summary.matched)} tone="ok" />
        <Stat label="Flagged" value={String(summary.flagged)} tone={summary.flagged ? 'warn' : undefined} />
        <Stat label="Match rate" value={`${Math.round(summary.matchRate * 100)}%`} />
      </div>

      {summary.flagged === 0 ? (
        <p className="notice ok">
          Everything reconciled. Every invoice has a matching ledger entry and
          every ledger entry has an invoice.
        </p>
      ) : (
        <div className="filters">
          <button
            type="button"
            className={`chip${filter === null ? ' on' : ''}`}
            onClick={() => setFilter(null)}
          >
            All {results.length}
          </button>
          {Object.entries(summary.counts).map(([flag, n]) => (
            <button
              type="button"
              key={flag}
              className={`chip${filter === flag ? ' on' : ''}`}
              onClick={() => setFilter(filter === flag ? null : flag)}
              title={FLAG_EXPLANATIONS[flag]}
            >
              {FLAG_LABELS[flag] ?? flag} {n}
            </button>
          ))}
        </div>
      )}

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>Status</th>
              <th>Invoice #</th>
              <th>Vendor</th>
              <th>Date</th>
              <th className="num">Invoice</th>
              <th className="num">Ledger</th>
              <th>Ledger entry</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const clean = r.flags.length === 0
              const inv = r.invoice
              const row = r.ledgerRow
              const id = `${inv?.sourceFile ?? ''}#${row?.rowIndex ?? ''}`
              const isOpen = openRow === id
              return (
                <Fragment key={id}>
                  <tr
                    className={clean ? 'row-ok' : 'row-warn'}
                    onClick={() => setOpenRow(isOpen ? null : id)}
                  >
                    <td>
                      {clean ? (
                        <span className="pill ok">matched</span>
                      ) : (
                        r.flags.map((f) => (
                          <span className="pill warn" key={f}>
                            {FLAG_LABELS[f] ?? f}
                          </span>
                        ))
                      )}
                    </td>
                    <td className="mono">{inv?.invoiceNumber ?? '—'}</td>
                    <td>{inv?.vendor ?? '—'}</td>
                    <td className="mono">{inv?.invoiceDate ? toISO(inv.invoiceDate) : '—'}</td>
                    <td className="num mono">{money(inv?.amount)}</td>
                    <td className="num mono">{money(row?.amount)}</td>
                    <td className="clip">{row ? `row ${row.rowIndex} · ${row.description}` : '—'}</td>
                    <td className="chev">{isOpen ? '▾' : '▸'}</td>
                  </tr>
                  {isOpen && (
                    <tr className="detail">
                      <td colSpan={8}>
                        <div className="detail-grid">
                          <div>
                            <h4>Invoice</h4>
                            {inv ? (
                              <dl>
                                <dt>File</dt><dd className="mono">{inv.sourceFile}</dd>
                                <dt>Number</dt><dd className="mono">{inv.invoiceNumber ?? '—'}</dd>
                                <dt>Vendor</dt><dd>{inv.vendor ?? '—'}</dd>
                                <dt>Date</dt><dd className="mono">{inv.invoiceDate ? toISO(inv.invoiceDate) : '—'}</dd>
                                <dt>Amount</dt><dd className="mono">{money(inv.amount)}</dd>
                              </dl>
                            ) : (
                              <p className="muted">No invoice on file for this payment.</p>
                            )}
                          </div>
                          <div>
                            <h4>Ledger entry</h4>
                            {row ? (
                              <dl>
                                <dt>Row</dt><dd className="mono">{row.rowIndex}</dd>
                                <dt>Reference</dt><dd className="mono">{row.reference ?? '—'}</dd>
                                <dt>Description</dt><dd>{row.description}</dd>
                                <dt>Date</dt><dd className="mono">{row.ledgerDate ? toISO(row.ledgerDate) : '—'}</dd>
                                <dt>Amount</dt><dd className="mono">{money(row.amount)}</dd>
                              </dl>
                            ) : (
                              <p className="muted">No matching ledger entry was found.</p>
                            )}
                          </div>
                        </div>
                        {r.flags.map((f) => (
                          <p className="why" key={f}>
                            <strong>{FLAG_LABELS[f] ?? f}.</strong> {FLAG_EXPLANATIONS[f]}
                            {f === 'amount_mismatch' && inv && row && (
                              <> Difference: <span className="mono">{money(Math.abs((inv.amount ?? 0) - (row.amount ?? 0)))}</span>.</>
                            )}
                          </p>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="actions">
        <button className="btn" onClick={onReset} type="button">Start over</button>
      </div>
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
