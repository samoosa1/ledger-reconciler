# ledger-reconciler

Reconciles a folder of invoice PDFs against a general ledger export (xlsx),
flags what doesn't line up, and produces a formatted Excel report.

Built as a demonstration of a document-automation pattern: messy PDFs and a
spreadsheet in, a validated report out. All data in this repo is invented —
no real company, invoice, or transaction anywhere in it.

## What it catches

- **Missing ledger entry** — invoice exists, no matching payment was recorded
- **Undocumented payment** — a ledger entry with no invoice on file
- **Amount mismatch** — matched, but the recorded amount differs from the invoice
- **Duplicate invoice** — the same invoice number appears more than once
- **Unreadable invoice** — a PDF the extractor genuinely couldn't parse (flagged, not guessed at)

## How matching works

1. Exact: ledger reference column equals the invoice number.
2. Fallback: same amount, ledger date within 5 days of the invoice date, and
   the vendor name shows up (fuzzily) in the ledger description.

Anything left over on either side is unmatched and reported as such.

## Extraction

Text-layer PDF parsing (`pypdf`), not OCR. Each field (invoice number,
vendor, date, amount) tries a short list of common real-world label
variants and date formats before giving up — see `tests/test_extract_realism.py`,
which checks this against invoice layouts the sample-data generator never
produced, including one deliberately unparseable scan that should fail
honestly rather than be guessed at.

## Usage

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m ledger_reconciler sample_data/invoices sample_data/ledger.xlsx -o report.xlsx
```

To regenerate the synthetic sample data:

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python generate_sample_data.py
```

## Tests

```bash
.venv/bin/python -m pytest tests/ -q
```

## Structure

```
ledger_reconciler/
  extract.py    invoice PDF -> structured fields
  ledger.py     ledger xlsx -> structured rows
  match.py      reconciliation + flagging logic
  report.py     results -> formatted Excel workbook
  cli.py        command-line entry point
generate_sample_data.py   builds sample_data/ (synthetic, seeded, reproducible)
```
