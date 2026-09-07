# Frontend architecture

The browser build of `ledger-reconciler`. Same job as the Python package in
the repo root: invoice PDFs plus a ledger export in, a reviewed
reconciliation and an `.xlsx` report out. The difference is where the work
happens. Nothing is uploaded, there is no server, and the whole pipeline
runs in the tab.

React 19, TypeScript, Vite 8, hand-rolled CSS, Vitest 4. No component
library, no state library, no CSS framework. 2,700 lines of source, 76
tests across 8 files.

## The one structural rule

Three layers, and the dependency arrows only ever point one way:

```
ui/  ──────►  lib/  ──────►  (browser APIs, pdf.js, SheetJS)
 │
 └──────────► domain/         (no browser APIs, no I/O, pure TypeScript)
```

`domain/` is the reconciliation logic and it is not allowed to know it is
in a browser. No `File`, no `fetch`, no DOM, no `Date` (more on that
below). `lib/` owns every impure edge: it turns a `File` into text or into
a cell grid and hands that to the domain layer. `ui/` renders, and holds
no logic of its own worth testing.

This is why the test suite runs under `environment: 'node'` with no DOM
and no jsdom. It is not a shortcut. It is the layering being enforced: if
a domain test ever needed a DOM, something had leaked downward.

## Modules

### `domain/` — the reconciliation logic

| File | Responsibility |
|---|---|
| `types.ts` | `Invoice`, `LedgerRow`, `MatchResult`, `Flag`. Mirrors `ledger_reconciler/models.py` |
| `dates.ts` | `PlainDate` (`{year, month, day}`) and the four accepted date formats |
| `extract.ts` | Invoice text to structured fields, by labelled-pattern lists |
| `ledgerProfiles.ts` | Column-name profiles for Xero, Wave, FreshBooks, QuickBooks, generic |
| `ledger.ts` | Cell grid to `LedgerRow[]`, with platform auto-detection |
| `similarity.ts` | Port of Python's `difflib.SequenceMatcher.ratio()` |
| `match.ts` | Reference-first then amount-and-date matching, plus the flags |

### `lib/` — the impure edges

| File | Responsibility |
|---|---|
| `pdf.ts` | `File` to page-1 text via pdf.js, with line reassembly |
| `sheet.ts` | `File` to a dense cell grid via SheetJS |
| `xlsx.ts` | Shared on-demand SheetJS loader, so reader and writer share one fetch |
| `export.ts` | Results to an `.xlsx` workbook (Summary and Detail sheets) |

### `ui/` — rendering and orchestration

| File | Responsibility |
|---|---|
| `pipeline.ts` | Files to results, reporting progress; also the flag labels and the sample loader |
| `DropZone.tsx` | One drop target for both file kinds, plus the sample-data button |
| `ExtractionReview.tsx` | What was read from each invoice, shown before any matching |
| `ResultsTable.tsx` | Figures, match meter, flag filters, drill-down rows, report download |
| `App.tsx` | The three-state machine and the empty state |

`pipeline.ts` deliberately sits in `ui/` but contains no JSX. Components
render it, they do not implement it, so the orchestration is testable
without mounting anything.

## Application state

Three states, held in `App.tsx` as a single `Stage` union:

```
idle ──drop files or try sample──► reading ──reconcile──► results
  ▲                                                         │
  └──────────────────── start over ─────────────────────────┘
```

Extraction and matching are separate stages on purpose. Extraction is the
fragile step, so what was read from each PDF is shown *before* anything is
matched. A user who never sees extraction fail will blame the matching
instead, and a bad scan then reads as "this tool is wrong" rather than
"this file could not be read".

Validation happens on the drop, before any work starts: no spreadsheet,
more than one spreadsheet, and no PDFs are each named as a specific error
rather than being discovered halfway through a batch.

## Invariants worth knowing

**Nothing is silently dropped.** `reconcile()` ends by asserting that
every invoice and every ledger row came back out exactly once, and throws
`CoverageError` if not. A wrong flag gets noticed; a missing row does not.

**"Could not verify" is not "verified absent".** An invoice with no
number, no amount and no date carries `unreadable_invoice`, and
`no_ledger_entry` is deliberately *not* added. Claiming a missing payment
would assert that a search happened and came up empty, when there was
nothing to search on.

**No OCR, and no guessing in place of it.** A scanned image is reported as
unreadable. Every extractor returns `null` on no match rather than a
best-effort value, because a wrong figure a user trusts is worse than an
admitted gap.

**`Date` is never used in the domain layer.** `new Date("2025-01-15")`
parses to UTC midnight and `new Date("January 15, 2025")` to *local*
midnight, so mixing the supported formats produces off-by-one-day errors
that appear only in some timezones. The domain layer works on `PlainDate`
records, and `Date.UTC` appears once, for day differencing, where it is
timezone-independent by definition. `ledger.ts` reads xlsx date cells with
the `getUTC*` accessors for the same reason.

**`null`, not `undefined`, throughout.** Mirrors Python's `| None`: a
field is present or explicitly absent. `undefined` would add a third
state ("key missing") the reference model has no equivalent for.

**Colour is never the only signal.** Every status pairs a colour with a
word, and the match meter splits its two segments by lightness plus a
hairline border rather than by hue alone, so it still reads under
red-green deficiency.

## Parity with the Python reference

The two implementations are meant to produce the same output on the same
input, which constrains some choices that would otherwise look odd:

- `similarity.ts` is a hand port of Ratcliff-Obershelp rather than an npm
  package, because `string-similarity` computes the Dice coefficient and
  most others compute a Levenshtein ratio. Different numbers for the same
  pair would silently change which vendors match.
- The `difflib` autojunk heuristic is reproduced even though it cannot
  trigger on these inputs (it needs 200+ elements), so the port does not
  diverge on some future long input.
- `ledger.ts` keeps Python's truthiness semantics where they are
  observable: `||` not `??` for the description cell, and a debit of
  exactly `0` falling through to the credit column.
- Two deliberate divergences, both documented at their call site.
  SheetJS's community build writes no cell styles, so the report is not
  row-filled the way openpyxl's is (column widths do reach the file). And
  the Python exporter's apostrophe guard against formula injection is
  *not* ported, because SheetJS types every string as a string cell and
  carrying the guard across would store the apostrophe as data. That
  exemption is xlsx-only: a CSV path would need the escaping back.

`tests/fixtures/reconcile-oracle.json` and `extraction-oracle.json` pin
the expected output so drift is caught by the suite rather than by eye.

## Loading strategy

The two parsers are the whole weight of the app and neither is needed
until a file is dropped, so both sit behind cached dynamic imports
(`cached ??= await import(...)`, which the module registry dedupes).
`isPdfFile` and `isSpreadsheetFile` stay synchronous because they are what
the landing page calls and they are two regexes.

Measured, current build:

| Chunk | Raw | gzip | When it loads |
|---|---|---|---|
| `index.js` | 217.15 kB | 68.48 kB | Immediately |
| `pdf.js` | 427.30 kB | 127.39 kB | First PDF |
| `xlsx.js` | 492.52 kB | 160.52 kB | First spreadsheet, and the report writer |
| `pdf.worker.mjs` | 2,222.99 kB | (worker) | First PDF |
| `index.css` | 12.13 kB | 3.43 kB | Immediately |

A visitor who reads the page and leaves downloads 68 kB of JavaScript.

Fonts are self-hosted (`@fontsource-variable/archivo`,
`@fontsource/ibm-plex-mono`) rather than linked from Google Fonts, and
that is a product decision, not a preference: the page tells the visitor
their files never leave the browser and that it works with the network
off. A stylesheet fetched from `fonts.googleapis.com` would make that
visibly false the moment anyone checked.

SheetJS is installed from `cdn.sheetjs.com`, not npm. The npm-published
`xlsx` stopped at 0.18.5 and carries unpatched prototype-pollution and
ReDoS advisories, which matters when the input is a spreadsheet from
someone you do not trust.

## Build, test, deploy

```bash
npm run dev      # VITE_BASE=/ vite
npm run build    # tsc -b && vite build
npm test         # vitest run, 76 tests
npm run lint     # oxlint
```

`vite.config.ts` sets `base` to `/ledger-reconciler/` for GitHub Pages
project-site hosting. Override with `VITE_BASE=/` for a root deploy
(Vercel, Netlify) or local preview.

Vitest aliases `pdfjs-dist` to its legacy build **for tests only**: the
modern build reaches for `DOMMatrix` at import time and Node has none. The
alias lives under the `test` key so the app bundle still gets the modern
build.

## Known gaps

- `domain/types.ts` refers to `tools/crosscheck.mjs` as the thing that
  diffs this implementation against the Python one. That file does not
  exist in the repo. Either the cross-check is manual or the comment is
  stale.
- The QuickBooks column profile is the well-known common column set but
  was never verified against a live export, and is marked lower-confidence
  in `ledgerProfiles.ts`. If a real export disagrees, the fix is one alias
  entry, not a code change.
- Only page 1 of each PDF is read, matching the Python version.
- Sequential extraction, not parallel: a folder of scanned invoices
  decoded concurrently can exhaust memory on a modest machine, and
  progress reported from parallel work is not honest about what is
  actually finished.
