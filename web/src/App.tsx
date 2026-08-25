import { useCallback, useState } from 'react'
import './App.css'
import { UnrecognisedLedgerError } from './domain/ledger'
import type { MatchResult } from './domain/types'
import { DropZone } from './ui/DropZone'
import { ExtractionReview } from './ui/ExtractionReview'
import { ResultsTable } from './ui/ResultsTable'
import {
  loadSampleFiles,
  readInvoices,
  reconcileAgainstLedger,
  sortDroppedFiles,
  type FileProgress,
} from './ui/pipeline'

type Stage = 'idle' | 'reading' | 'results'

export default function App() {
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState<FileProgress[]>([])
  const [ledger, setLedger] = useState<File | null>(null)
  const [results, setResults] = useState<MatchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = useCallback(() => {
    setStage('idle')
    setProgress([])
    setLedger(null)
    setResults([])
    setError(null)
    setBusy(false)
  }, [])

  const start = useCallback(async (invoiceFiles: File[], ledgerFile: File) => {
    setError(null)
    setBusy(true)
    setLedger(ledgerFile)
    setStage('reading')
    try {
      await readInvoices(invoiceFiles, setProgress)
    } finally {
      setBusy(false)
    }
  }, [])

  const handleFiles = useCallback(
    (files: File[]) => {
      const { invoices, ledgers, ignored } = sortDroppedFiles(files)

      // Name what is wrong before doing any work, rather than after.
      if (ledgers.length === 0) {
        setError(
          ignored.length > 0
            ? `No spreadsheet found. Add a ledger export (.xlsx or .csv). Ignored: ${ignored.map((f) => f.name).join(', ')}`
            : 'No spreadsheet found. Add your ledger export (.xlsx or .csv) alongside the invoice PDFs.',
        )
        return
      }
      if (ledgers.length > 1) {
        setError(
          `Found ${ledgers.length} spreadsheets (${ledgers.map((f) => f.name).join(', ')}). Drop exactly one ledger.`,
        )
        return
      }
      if (invoices.length === 0) {
        setError('No PDF invoices found. Add the invoice PDFs to reconcile against the ledger.')
        return
      }
      void start(invoices, ledgers[0])
    },
    [start],
  )

  const handleSample = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const { invoices, ledger: sampleLedger } = await loadSampleFiles(import.meta.env.BASE_URL)
      await start(invoices, sampleLedger)
    } catch (e) {
      setError(`Could not load the sample data: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }, [start])

  const handleReconcile = useCallback(async () => {
    if (!ledger) return
    setBusy(true)
    setError(null)
    try {
      const invoices = progress.flatMap((p) => (p.invoice ? [p.invoice] : []))
      const out = await reconcileAgainstLedger(invoices, ledger)
      setResults(out.results)
      setStage('results')
    } catch (e) {
      // The unrecognised-columns error already names the headers it found
      // and which platforms are supported, so it is shown verbatim.
      setError(
        e instanceof UnrecognisedLedgerError
          ? e.message
          : `Could not reconcile: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setBusy(false)
    }
  }, [ledger, progress])

  return (
    <div className="shell">
      <aside className="rail">
        <div className="masthead">
          <h1>Reconcile invoices against your ledger</h1>
          <p>
            Drop a folder of invoice PDFs and your ledger export. Whatever
            doesn&rsquo;t tie out is listed for review.
          </p>
        </div>

        <DropZone onFiles={handleFiles} onTrySample={handleSample} busy={busy} />

        {stage !== 'idle' && (
          <button className="btn" type="button" onClick={reset}>
            Start over
          </button>
        )}

        <p className="privacy">
          <strong>Your files never leave this browser.</strong> There is no
          server to send them to. Disconnect from the internet and it still
          works.
        </p>
      </aside>

      <main className="stage">
        {error && (
          <p className="notice bad" role="alert">
            {error}
          </p>
        )}

        {stage === 'idle' && <EmptyState />}

        {stage === 'reading' && (
          <ExtractionReview
            progress={progress}
            ledgerName={ledger?.name ?? null}
            onContinue={handleReconcile}
            busy={busy}
          />
        )}

        {stage === 'results' && <ResultsTable results={results} />}
      </main>
    </div>
  )
}

/**
 * Teaches the interface rather than saying "nothing here": naming the five
 * findings up front means the output area is legible before it has output,
 * and a visitor understands what the tool looks for without running it.
 */
function EmptyState() {
  const findings: [string, string][] = [
    ['Missing payment', 'An invoice with no matching entry in the ledger.'],
    ['Undocumented payment', 'A ledger entry with no invoice to support it.'],
    ['Amount differs', 'Matched, but the two figures disagree.'],
    ['Duplicate invoice', 'The same invoice number appears more than once.'],
    ['Could not read', 'A PDF with no extractable text, reported rather than guessed at.'],
  ]
  return (
    <section className="empty rise">
      <h2>What this looks for</h2>
      <ol>
        {findings.map(([name, detail]) => (
          <li key={name}>
            <b>{name}</b>
            <span>{detail}</span>
          </li>
        ))}
      </ol>
      <p className="muted" style={{ marginTop: 'var(--sp-5)' }}>
        Reads text-based PDFs. Scanned images aren&rsquo;t run through OCR;
        they&rsquo;re reported as unreadable instead of silently dropped.
      </p>
    </section>
  )
}
