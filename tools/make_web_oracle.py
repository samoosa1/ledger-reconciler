"""Regenerate web/tests/fixtures/reconcile-oracle.json from the browser
sample subset, using the Python implementation as the reference.

Text comes from pypdf so the fixture exercises the domain layer only (the
browser's pdf.js text differs slightly and is covered by lib tests).
Scanned files carry an empty text: the reference runs with OCR disabled so
the fixture is deterministic and needs no tesseract to regenerate, and the
port must report those as unreadable exactly like the reference does.

    PYTHONPATH=. .venv/bin/python tools/make_web_oracle.py
"""
from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import openpyxl

import ledger_reconciler.extract as ex
from ledger_reconciler.ledger import read_ledger
from ledger_reconciler.match import reconcile

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "web" / "public" / "sample"
OUT = ROOT / "web" / "tests" / "fixtures" / "reconcile-oracle.json"

ex.ocr_pdf_text = lambda p: None  # reference without OCR: deterministic, no tesseract needed

manifest = json.loads((SAMPLE / "manifest.json").read_text())
invoices, texts = [], []
for name in manifest["invoices"]:
    path = SAMPLE / "invoices" / name
    try:
        text, _ = ex.read_pdf_text(path)
    except ex.SourceError:
        text = ""
    texts.append({"sourceFile": name, "text": text})
    invoices.append(ex.extract_invoice(path))

rows = read_ledger(SAMPLE / "ledger.xlsx")
results = reconcile(invoices, rows)

ws = openpyxl.load_workbook(SAMPLE / "ledger.xlsx", data_only=True).active
grid = []
for r in ws.iter_rows(values_only=True):
    grid.append([{"__date": v.date().isoformat() if isinstance(v, datetime) else v.isoformat()}
                 if isinstance(v, (date, datetime)) else v for v in r])

expected = [{
    "sourceFile": r.invoice.source_file if r.invoice else None,
    "invoiceNumber": r.invoice.invoice_number if r.invoice else None,
    "ledgerRowIndex": r.ledger_row.row_index if r.ledger_row else None,
    "extraRowIndexes": [x.row_index for x in r.extra_rows],
    "flags": r.flags,
} for r in results]

counts: dict[str, int] = {}
for r in results:
    for f in r.flags:
        counts[f] = counts.get(f, 0) + 1

OUT.write_text(json.dumps({
    "invoices": texts, "ledgerGrid": grid, "expected": expected,
    "flagCounts": counts, "invoiceCount": len(invoices), "ledgerRowCount": len(rows),
}, indent=1, ensure_ascii=False))
print(f"{len(invoices)} invoices, {len(rows)} rows, {len(results)} results, flags {counts}")
