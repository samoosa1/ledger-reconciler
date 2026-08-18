"""Pull structured fields out of invoice PDFs.

Real invoices vary in label wording and date format, so each field tries a
short list of common patterns in order and takes the first hit. This is
still a text-layer parser (no OCR, no layout/table understanding) — a
badly scanned or fully unstructured invoice will legitimately fail to
extract, and that's surfaced as ``unreadable_invoice`` downstream rather
than guessed at.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

from pypdf import PdfReader

from .models import Invoice

_NUMBER_PATTERNS = [
    re.compile(r"Invoice\s*(?:#|No\.?|Number)\s*:?\s*([A-Za-z0-9\-]+)", re.I),
    re.compile(r"Ref(?:erence)?\s*(?:#|No\.?)?\s*:?\s*([A-Za-z0-9\-]+)", re.I),
]

_AMOUNT_PATTERNS = [
    re.compile(r"(?:Amount\s*Due|Total\s*Due|Balance\s*Due)\s*:?\s*\$?\s*([0-9][0-9,]*\.[0-9]{2})", re.I),
    re.compile(r"Total\s*:?\s*\$?\s*([0-9][0-9,]*\.[0-9]{2})", re.I),
    re.compile(r"\$\s*([0-9][0-9,]*\.[0-9]{2})\s*due", re.I),
]

_DATE_LABEL_PATTERNS = [
    re.compile(r"(?:Invoice\s*)?Date\s*:?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})", re.I),
    re.compile(r"Issue\s*Date\s*:?\s*([A-Za-z]+ [0-9]{1,2},? [0-9]{4})", re.I),
]
_DATE_BARE_PATTERN = re.compile(r"\b([0-9]{4}/[0-9]{2}/[0-9]{2})\b")

_VENDOR_LABEL_PATTERN = re.compile(r"^Vendor\s*:?\s*(.+)$", re.I | re.M)
_SKIP_HEADER_WORDS = {"invoice", "receipt", "bill to", "ship to"}


def _parse_amount(raw: str) -> float:
    return float(raw.replace(",", ""))


def _parse_date(raw: str) -> date | None:
    for fmt in ("%Y-%m-%d", "%B %d, %Y", "%B %d %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _extract_number(text: str) -> str | None:
    for pattern in _NUMBER_PATTERNS:
        m = pattern.search(text)
        if m:
            return m.group(1).strip()
    return None


def _extract_amount(text: str) -> float | None:
    for pattern in _AMOUNT_PATTERNS:
        m = pattern.search(text)
        if m:
            return _parse_amount(m.group(1))
    return None


def _extract_date(text: str) -> date | None:
    for pattern in _DATE_LABEL_PATTERNS:
        m = pattern.search(text)
        if m:
            parsed = _parse_date(m.group(1).strip())
            if parsed:
                return parsed
    m = _DATE_BARE_PATTERN.search(text)
    if m:
        return _parse_date(m.group(1))
    return None


def _extract_vendor(text: str) -> str | None:
    m = _VENDOR_LABEL_PATTERN.search(text)
    if m:
        return m.group(1).strip()
    # Fallback: the first non-empty line that isn't a generic document
    # heading is almost always the issuing company's letterhead name.
    for line in text.splitlines():
        line = line.strip()
        if line and line.lower() not in _SKIP_HEADER_WORDS:
            return line
    return None


def extract_invoice(pdf_path: Path) -> Invoice:
    text = PdfReader(str(pdf_path)).pages[0].extract_text() or ""
    return Invoice(
        source_file=pdf_path.name,
        invoice_number=_extract_number(text),
        vendor=_extract_vendor(text),
        invoice_date=_extract_date(text),
        amount=_extract_amount(text),
    )


def extract_invoices(invoice_dir: Path) -> list[Invoice]:
    return [extract_invoice(p) for p in sorted(invoice_dir.glob("*.pdf"))]
