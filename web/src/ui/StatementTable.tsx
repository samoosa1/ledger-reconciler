/**
 * Per-supplier statement with ageing: the question a payables clerk asks
 * after the exception report, which is "who is owed what, and how long
 * has it been sitting".
 *
 * Same match results, different projection. Every column here is derived,
 * so nothing can disagree with the exception report.
 */

import { Fragment, useState } from 'react'
import { toISO } from '../domain/dates'
import { AGE_BUCKETS, BUCKET_LABELS, buildStatements, latestDate } from '../domain/statement'
import type { MatchResult } from '../domain/types'

interface Props {
  results: MatchResult[]
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function StatementTable({ results }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const asOf = latestDate(results)
  const statements = buildStatements(results, asOf)

  const totals = AGE_BUCKETS.map((b) => ({
    bucket: b,
    value: statements.reduce((sum, s) => sum + s.buckets[b], 0),
  })).filter((t) => t.value !== 0)

  const outstanding = statements.reduce((sum, s) => sum + s.outstanding, 0)
  const overpaid = statements.reduce((sum, s) => sum + s.overpaid, 0)
  const overpaidCount = statements.reduce(
    (n, s) => n + s.lines.filter((l) => l.outstanding < 0).length,
    0,
  )
  const unreadable = statements.reduce((sum, s) => sum + s.unreadableCount, 0)

  if (statements.length === 0) {
    return <p className="muted">No invoices to summarise.</p>
  }

  return (
    <section className="rise">
      <div className="stage-head">
        <h2>What is still open, by supplier</h2>
        <span className="muted">
          aged at {asOf ? toISO(asOf) : 'no date in the data'}
        </span>
      </div>

      <p className="notice">
        <strong>{money(outstanding)}</strong> still open across{' '}
        {statements.length} {statements.length === 1 ? 'supplier' : 'suppliers'}.
        {overpaid > 0 && (
          <>
            {' '}
            A further <strong>{money(overpaid)}</strong> was paid beyond what
            was invoiced on {overpaidCount}{' '}
            {overpaidCount === 1 ? 'invoice' : 'invoices'}, reported on its own
            rather than credited against unpaid balances.
          </>
        )}
        {unreadable > 0 && (
          <>
            {' '}
            {unreadable} {unreadable === 1 ? 'invoice' : 'invoices'} could not
            be read and {unreadable === 1 ? 'is' : 'are'} in no total, listed
            against {unreadable === 1 ? 'its' : 'their'} supplier as
            unreadable.
          </>
        )}
      </p>

      {totals.length > 0 && (
        <div className="filters" role="list">
          {totals.map((t) => (
            <span className="chip" key={t.bucket} role="listitem">
              {BUCKET_LABELS[t.bucket]} {money(t.value)}
            </span>
          ))}
        </div>
      )}

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>Supplier</th>
              <th className="num">Invoices</th>
              <th className="num">Billed</th>
              <th className="num">Settled</th>
              <th className="num">Open</th>
              <th className="num">Overpaid</th>
              {AGE_BUCKETS.map((b) => (
                <th className="num" key={b}>
                  {BUCKET_LABELS[b]}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {statements.map((s) => {
              const id = s.vendor ?? '__unattributed'
              const isOpen = open === id
              return (
                <Fragment key={id}>
                  <tr className="clickable" onClick={() => setOpen(isOpen ? null : id)}>
                    <td className="clip">
                      {s.vendor ?? (
                        <span className="faint">vendor could not be read</span>
                      )}
                    </td>
                    <td className="num mono">
                      {s.invoiceCount}
                      {s.unreadableCount > 0 && (
                        <span className="faint"> ({s.unreadableCount} unreadable)</span>
                      )}
                    </td>
                    <td className="num mono">{money(s.billed)}</td>
                    <td className="num mono">{money(s.settled)}</td>
                    <td className="num mono">{money(s.outstanding)}</td>
                    <td className="num mono">
                      {s.overpaid === 0 ? <span className="faint">—</span> : money(s.overpaid)}
                    </td>
                    {AGE_BUCKETS.map((b) => (
                      <td className="num mono" key={b}>
                        {s.buckets[b] === 0 ? <span className="faint">—</span> : money(s.buckets[b])}
                      </td>
                    ))}
                    <td className="chev">
                      <button
                        className="disclose"
                        type="button"
                        aria-expanded={isOpen}
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpen(isOpen ? null : id)
                        }}
                      >
                        <span className="sr-only">
                          {isOpen ? 'Hide invoices for' : 'Show invoices for'}{' '}
                          {s.vendor ?? 'the unreadable supplier'}
                        </span>
                        <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="detail">
                      <td colSpan={7 + AGE_BUCKETS.length}>
                        <table className="grid inner">
                          <thead>
                            <tr>
                              <th>File</th>
                              <th>Invoice</th>
                              <th>Date</th>
                              <th className="num">Amount</th>
                              <th className="num">Open</th>
              <th className="num">Overpaid</th>
                              <th className="num">Age</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.lines.map((l) => (
                              <tr key={l.sourceFile}>
                                <td className="mono clip">{l.sourceFile}</td>
                                <td className="mono">
                                  {l.invoiceNumber ?? <span className="faint">—</span>}
                                </td>
                                <td className="mono">
                                  {l.invoiceDate ? (
                                    toISO(l.invoiceDate)
                                  ) : (
                                    <span className="faint">unreadable</span>
                                  )}
                                </td>
                                <td className="num mono">
                                  {l.amount === null ? (
                                    <span className="faint">unreadable</span>
                                  ) : (
                                    money(l.amount)
                                  )}
                                </td>
                                <td className="num mono">
                                  {l.amount === null ? (
                                    <span className="faint">—</span>
                                  ) : (
                                    money(l.outstanding)
                                  )}
                                </td>
                                <td className="num mono">
                                  {l.ageDays === null ? (
                                    <span className="faint">—</span>
                                  ) : (
                                    `${l.ageDays}d`
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
