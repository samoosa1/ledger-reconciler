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

from docguard.safe_pdf import SourceError, read_pdf_text

from .models import Invoice

# [ \t]* (not \s*) between label and value deliberately stays on one line —
# text-layer extraction doesn't preserve visual column layout, so letting a
# match cross a newline risks grabbing the next field's label instead of a
# value (this is exactly how a real multi-column invoice broke this before:
# "Invoice number" was immediately followed in the text stream by the next
# column's "Customer ref. 1" label, not by its own value).
_NUMBER_PATTERNS = [
    re.compile(r"Invoice\s*(?:#|No\.?|Number)[ \t]*:?[ \t]*([A-Za-z0-9\-]+)", re.I),
    re.compile(r"Ref(?:erence)?\s*(?:#|No\.?)?[ \t]*:?[ \t]*([A-Za-z0-9\-]+)", re.I),
]

_AMOUNT_PATTERNS = [
    re.compile(r"(?:Amount\s*Due|Total\s*Due|Balance\s*Due)\s*:?\s*\$?\s*([0-9][0-9,]*\.[0-9]{2})", re.I),
    re.compile(r"Total\s*:?\s*\$?\s*([0-9][0-9,]*\.[0-9]{2})", re.I),
    re.compile(r"\$\s*([0-9][0-9,]*\.[0-9]{2})\s*due", re.I),
]

_DATE_LABEL = r"(?:Invoice\s*Date|Issue\s*Date|Date)\s*:?\s*"
_DATE_LABEL_PATTERNS = [
    re.compile(_DATE_LABEL + r"([0-9]{4}-[0-9]{2}-[0-9]{2})", re.I),
    re.compile(_DATE_LABEL + r"([A-Za-z]+ [0-9]{1,2},? [0-9]{4})", re.I),
]
_DATE_BARE_PATTERN = re.compile(r"\b([0-9]{4}/[0-9]{2}/[0-9]{2})\b")

# Same-line: "Vendor: Acme Co" / "From: Acme Co". Next-line: a bare label
# line ("From:") followed by the name on the line below — very common when
# the letterhead sits under a "From" field instead of inline with it.
_VENDOR_LABEL_SAMELINE = re.compile(r"^(?:Vendor|From|Sold\s*By|Company)\s*:?\s*(\S.*)$", re.I | re.M)
_VENDOR_LABEL_NEXTLINE = re.compile(r"^(?:Vendor|From|Sold\s*By|Company)\s*:?\s*$\n(.+)$", re.I | re.M)

# Words/phrases that mean "this line is boilerplate, not a company name" —
# checked against the START of a candidate line.
_BOILERPLATE_START = (
    "invoice", "receipt", "bill to", "ship to", "page", "payment", "customer",
    "contact", "thanks", "please", "terms", "note", "due", "total", "order",
    "date", "ref",
)
_VENDOR_SCAN_WINDOW = 6  # only trust a positional guess this close to the top


def _looks_like_a_name(line: str) -> bool:
    low = line.lower()
    if any(low.startswith(w) for w in _BOILERPLATE_START):
        return False
    words = line.split()
    if not (1 <= len(words) <= 6):
        return False  # real disclaimers/sentences run long; names don't
    if not any(c.isalpha() for c in line):
        return False  # pure numbers/dates aren't a company name
    if low.endswith(".") and not line.isupper():
        return False  # reads like the end of a prose sentence
    return True


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
    m = _VENDOR_LABEL_SAMELINE.search(text)
    if m:
        return m.group(1).strip()
    m = _VENDOR_LABEL_NEXTLINE.search(text)
    if m:
        return m.group(1).strip()

    # No explicit label — only trust a positional guess near the very top
    # of the document, and only if it actually looks like a name rather
    # than boilerplate. Text-layer extraction doesn't preserve visual
    # column layout, so scanning deeper into the document risks grabbing
    # something from an unrelated column; better to report "not found"
    # than to confidently return the wrong company.
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for line in lines[:_VENDOR_SCAN_WINDOW]:
        if _looks_like_a_name(line):
            return line
    return None


def extract_invoice(pdf_path: Path) -> Invoice:
    # require_text=False and a broad except: a corrupt file, a zero-byte
    # upload, or a scanned image with no text layer should all degrade to
    # "nothing extracted" (surfaced downstream as unreadable_invoice) rather
    # than crash the whole batch over one bad file among possibly dozens.
    try:
        text, _ = read_pdf_text(pdf_path, require_text=False, max_pages=1)
    except SourceError:
        text = ""
    return Invoice(
        source_file=pdf_path.name,
        invoice_number=_extract_number(text),
        vendor=_extract_vendor(text),
        invoice_date=_extract_date(text),
        amount=_extract_amount(text),
    )


def extract_invoices(invoice_dir: Path) -> list[Invoice]:
    return [extract_invoice(p) for p in sorted(invoice_dir.glob("*.pdf"))]
