import { Fragment, useState } from 'react'
import { toISO } from '../domain/dates'
import type { MatchResult } from '../domain/types'
import { downloadReport } from '../lib/export'
import { FLAG_EXPLANATIONS, FLAG_LABELS, summarise } from './pipeline'

interface Props {
  results: MatchResult[]
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ResultsTable({ results }: Props) {
  const [filter, setFilter] = useState<string | null>(null)
  // Keyed by stable identity, not list index: filtering reorders the list,
  // so an index would leave a different row expanded than the one clicked.
  const [openRow, setOpenRow] = useState<string | null>(null)
  const summary = summarise(results)

  const shown = filter
    ? results.filter((r) => (r.flags as string[]).includes(filter))
    : results

  return (
    <section className="rise">
      <div className="figures">
        <Figure value={String(summary.total)} label="items" />
        <Figure value={String(summary.matched)} label="reconciled" tone="ok" />
        <Figure
          value={String(summary.flagged)}
          label="to review"
          tone={summary.flagged > 0 ? 'warn' : undefined}
        />
        <Figure value={`${Math.round(summary.matchRate * 100)}%`} label="match rate" />
      </div>

      {summary.flagged === 0 ? (
        <p className="notice ok">
          Everything reconciled. Every invoice has a matching ledger entry, and
          every ledger entry has an invoice.
        </p>
      ) : (
        <div className="filters">
          <button
            type="button"
            className={`chip${filter === null ? ' on' : ''}`}
            onClick={() => setFilter(null)}
          >
            Everything {results.length}
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
              <th>Invoice</th>
              <th>Vendor</th>
              <th>Date</th>
              <th className="num">Invoice</th>
              <th className="num">Ledger</th>
              <th className="num">Row</th>
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
                  <tr className="clickable" onClick={() => setOpenRow(isOpen ? null : id)}>
                    <td>
                      {clean ? (
                        <span className="tag ok">reconciled</span>
                      ) : (
                        r.flags.map((f) => (
                          <span className="tag warn" key={f}>
                            {FLAG_LABELS[f] ?? f}
                          </span>
                        ))
                      )}
                    </td>
                    <td className="mono">{inv?.invoiceNumber ?? <span className="faint">—</span>}</td>
                    <td className="clip">{inv?.vendor ?? <span className="faint">—</span>}</td>
                    <td className="mono">
                      {inv?.invoiceDate ? toISO(inv.invoiceDate) : <span className="faint">—</span>}
                    </td>
                    <td className="num mono">{money(inv?.amount)}</td>
                    <td className="num mono">{money(row?.amount)}</td>
                    {/* Just the row number: the description repeated the
                        vendor two columns left and pushed the Status column
                        out of view on a 1280px screen. The full description
                        is in the drill-down, where there is room for it. */}
                    <td className="num mono faint">
                      {row ? row.rowIndex : <span className="faint">—</span>}
                    </td>
                    <td className="chev">
                      {/* A real button, not just a clickable <tr>: a table row
                          is not focusable, so without this the finding
                          explanations are unreachable by keyboard. The row
                          click stays as a convenience for pointer users. */}
                      <button
                        type="button"
                        className="disclose"
                        aria-expanded={isOpen}
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenRow(isOpen ? null : id)
                        }}
                      >
                        <span className="sr-only">
                          {isOpen ? 'Hide details for' : 'Show details for'}{' '}
                          {inv?.invoiceNumber ?? `ledger row ${row?.rowIndex}`}
                        </span>
                        <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
                      </button>
                    </td>
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
                              <>
                                {' '}Difference:{' '}
                                <span className="mono">
                                  {money(Math.abs((inv.amount ?? 0) - (row.amount ?? 0)))}
                                </span>.
                              </>
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
        <span className="muted">
          A flag is a record to review, not a confirmed error.
        </span>
        <button className="btn primary push" type="button" onClick={() => downloadReport(results)}>
          Download .xlsx
        </button>
      </div>
    </section>
  )
}

function Figure({ value, label, tone }: { value: string; label: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`figure${tone ? ` ${tone}` : ''}`}>
      <div className="figure-value">{value}</div>
      <div className="figure-label">{label}</div>
    </div>
  )
}
