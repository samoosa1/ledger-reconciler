"""Invoice layouts deliberately DIFFERENT from generate_sample_data.py's own
format — different labels, prose dates, no explicit 'Vendor:' tag, and one
genuinely unparseable OCR-style scan. Used by test_extract_realism.py to
check the extractor generalizes instead of having memorized its own format.
"""
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


def write_format_b(path: Path) -> None:
    """Different labels, prose date, 'Total Due' instead of 'Amount Due'."""
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(72, 750, "Nordway Logistics")
    c.setFont("Helvetica", 10)
    c.drawString(72, 730, "1220 Harbor Rd, Suite 4, Portland OR")
    c.setFont("Helvetica-Bold", 13)
    c.drawString(72, 690, "INVOICE")
    c.setFont("Helvetica", 11)
    c.drawString(72, 665, "Bill To: Acme Retail Group")
    c.drawString(72, 648, "Invoice No: NW-88231")
    c.drawString(72, 631, "Issue Date: March 14, 2025")
    c.drawString(72, 614, "Due Date: April 13, 2025")
    c.drawString(72, 580, "Description                          Total")
    c.drawString(72, 564, "Freight services, Q1 route              $1,940.00")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(300, 530, "Total Due: $1,940.00")
    c.save()


def write_format_c(path: Path) -> None:
    """Sparse receipt style, 'Ref#' instead of 'Invoice #', bare slash date,
    no explicit 'Vendor:' label anywhere."""
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, 760, "Cedar & Finch Consulting")
    c.setFont("Helvetica", 10)
    c.drawString(72, 745, "Receipt / Invoice")
    c.drawString(72, 700, "Ref#  CF-2025-014")
    c.drawString(72, 685, "2025/03/22")
    c.drawString(72, 660, "Consulting retainer - March")
    c.drawString(72, 645, "$875.00 due")
    c.save()


def write_format_d_bad_scan(path: Path) -> None:
    """No machine-parseable structure at all — simulates a bad phone-camera
    scan that only yields a couple of usable text fragments."""
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setFont("Helvetica", 9)
    c.drawString(80, 700, "invoice")
    c.drawString(80, 680, "amberlake")
    c.drawString(80, 660, "279 27")  # OCR dropped the decimal point
    c.save()
