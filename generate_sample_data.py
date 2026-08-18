"""Builds a synthetic sample_data/ set: invented invoices + a matching ledger,
with a handful of deliberately broken rows so the demo actually has something
to catch. No real company, person, or transaction data anywhere in here.
"""
from __future__ import annotations

import random
from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
INVOICE_DIR = HERE / "sample_data" / "invoices"
LEDGER_PATH = HERE / "sample_data" / "ledger.xlsx"

VENDORS = [
    "Bluefern Supplies Ltd",
    "Nordway Logistics",
    "Cedar & Finch Consulting",
    "Pinehollow Office Co",
    "Meridian Print Services",
    "Amberlake Facilities",
]

random.seed(7)  # reproducible sample set


def _write_invoice_pdf(path: Path, invoice_number: str, vendor: str, invoice_date: date, amount: float) -> None:
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, 740, "INVOICE")
    c.setFont("Helvetica", 11)
    c.drawString(72, 700, f"Invoice #: {invoice_number}")
    c.drawString(72, 682, f"Date: {invoice_date.isoformat()}")
    c.drawString(72, 664, f"Vendor: {vendor}")
    c.drawString(72, 646, f"Amount Due: ${amount:,.2f}")
    c.drawString(72, 600, "Thank you for your business.")
    c.save()


def generate() -> None:
    INVOICE_DIR.mkdir(parents=True, exist_ok=True)
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)

    start = date(2025, 1, 6)
    ledger_rows = []  # (date, description, reference, amount)

    invoices = []
    for i in range(1, 17):
        vendor = VENDORS[i % len(VENDORS)]
        inv_date = start + timedelta(days=i * 4)
        amount = round(random.uniform(120, 2400), 2)
        number = f"INV-{1000 + i}"
        invoices.append((number, vendor, inv_date, amount))

    # --- write clean invoice PDFs + matching ledger rows for all but the broken cases ---
    for number, vendor, inv_date, amount in invoices:
        _write_invoice_pdf(INVOICE_DIR / f"{number}.pdf", number, vendor, inv_date, amount)
        ledger_rows.append([inv_date, f"Payment to {vendor}", number, amount])

    # 1. Missing ledger entry: invoice exists, payment was never recorded.
    missing_number = invoices[3][0]
    ledger_rows = [r for r in ledger_rows if r[2] != missing_number]

    # 2. Undocumented ledger entry: a payment with no invoice on file.
    ledger_rows.append([start + timedelta(days=30), "Wire transfer - Amberlake Facilities", None, 875.00])

    # 3. Amount mismatch: ledger was recorded with a typo'd amount.
    mismatch_number, _, _, mismatch_amount = invoices[7]
    for row in ledger_rows:
        if row[2] == mismatch_number:
            row[3] = round(mismatch_amount + 50.00, 2)

    # 4. Duplicate invoice: same invoice submitted/scanned twice.
    dup_number, dup_vendor, dup_date, dup_amount = invoices[10]
    _write_invoice_pdf(INVOICE_DIR / f"{dup_number}_rescan.pdf", dup_number, dup_vendor, dup_date, dup_amount)

    wb = Workbook()
    ws = wb.active
    ws.title = "Ledger"
    ws.append(["Date", "Description", "Reference", "Amount"])
    for row in sorted(ledger_rows, key=lambda r: r[0]):
        ws.append(row)
    wb.save(LEDGER_PATH)

    print(f"Wrote {len(list(INVOICE_DIR.glob('*.pdf')))} invoice PDFs to {INVOICE_DIR}")
    print(f"Wrote {len(ledger_rows)} ledger rows to {LEDGER_PATH}")
    print("Planted issues: 1 missing ledger entry, 1 undocumented payment, "
          "1 amount mismatch, 1 duplicate invoice.")


if __name__ == "__main__":
    generate()
