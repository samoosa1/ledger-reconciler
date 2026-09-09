/**
 * Who built this, what it is for, and how to start.
 *
 * The demo is the thing a stranger actually plays with, so it is also the
 * only place a reader is already interested enough to want a next step.
 * Before this block existed the page was anonymous: someone impressed by
 * it had no way to find the source or make contact.
 */

import { useState } from 'react'
import { contactAddress } from '../lib/contact'

const REPO = 'https://github.com/samoosa1/ledger-reconciler'

export function Colophon() {
  const [address, setAddress] = useState<string | null>(null)

  return (
    <footer className="colophon">
      <p className="colophon-lede">
        <strong>Musa Ahmedoglu.</strong> I build document automation for
        finance teams. Invoice extraction, ledger and receivables
        reconciliation, and reports that mark what they could not verify
        instead of guessing.
      </p>

      <p>
        <strong>Pilot.</strong> Send 20 documents and one month&rsquo;s
        ledger export. You get the exception report, a written list of what
        your current process misses, and the tool itself. Five business
        days.
      </p>

      <p className="colophon-links">
        <a href={REPO} rel="noreferrer noopener" target="_blank">
          Source on GitHub
        </a>
        <span aria-hidden="true" className="colophon-sep">
          ·
        </span>
        {address === null ? (
          <button
            className="link-btn"
            type="button"
            onClick={() => setAddress(contactAddress())}
          >
            Show email address
          </button>
        ) : (
          <a href={`mailto:${address}`}>{address}</a>
        )}
      </p>

      <p className="colophon-fine">
        Every invoice and figure in the sample data is invented. No real
        company, client or transaction appears anywhere in this tool.
      </p>
    </footer>
  )
}
