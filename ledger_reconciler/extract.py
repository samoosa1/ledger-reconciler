"""Pull structured fields out of invoice PDFs.

Real invoices disagree about everything: where the number sits, what the
total is called, whether 1.234,56 or 1,234.56 is the amount, whether 03/04
is March or April. Each field therefore tries an ordered list of label
patterns and value shapes, and the first hit wins. Layout is not modelled
(no table understanding), and a field that cannot be read with confidence
comes back as ``None`` so the reconciler reports it instead of guessing.

Scanned PDFs have no text layer. When the optional OCR dependency
(pytesseract + a tesseract binary) is installed, page 1 is rasterised and
read; the invoice then carries ``extraction_method == "ocr"`` so a reader
knows the fields came from image recognition and deserve a second look.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

from docguard.safe_pdf import SourceError, read_pdf_text

from .models import Invoice

# ---------------------------------------------------------------- helpers

_MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"], start=1)}
_MONTHS.update({k[:3]: v for k, v in list(_MONTHS.items())})
_MONTHS["sept"] = 9

# A money value in any of the three common shapes, with optional sign,
# symbol and ISO code around it. Group 1 is the numeric part.
_MONEY = r"(?:[-−]\s*)?(?:[$€£₺]\s*)?(?:[A-Z]{3}\s*)?(-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})|-?\d+[.,]\d{2})(?:\s*[A-Z]{3})?"


def parse_amount(raw: str) -> float | None:
    """'1,234.56' / '1.234,56' / '1234.56' / '16.396,10' -> float. Decides
    which separator is the decimal one from the LAST separator and the
    number of digits after it; a lone separator followed by exactly three
    digits is a thousands group."""
    s = raw.strip().replace(" ", "").replace("−", "-")
    neg = s.startswith("-")
    s = s.lstrip("-")
    if not s:
        return None
    last_dot, last_com = s.rfind("."), s.rfind(",")
    if last_dot == -1 and last_com == -1:
        digits = s
    else:
        pos = max(last_dot, last_com)
        tail = s[pos + 1:]
        if len(tail) == 2:
            digits = re.sub(r"[.,]", "", s[:pos]) + "." + tail
        elif len(tail) == 3:
            digits = re.sub(r"[.,]", "", s)
        else:
            return None
    try:
        v = float(digits)
    except ValueError:
        return None
    return -v if neg else v


def parse_date(raw: str, *, prefer_us: bool) -> date | None:
    raw = raw.strip().rstrip(".,")
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", raw)
    if m:
        y, mo, d = map(int, m.groups())
        return _safe_date(y, mo, d)
    m = re.fullmatch(r"(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})", raw)
    if m:
        a, b, y = map(int, m.groups())
        if y < 100:
            y += 2000
        if a > 12 and b <= 12:
            return _safe_date(y, b, a)          # unambiguous day-first
        if b > 12 and a <= 12:
            return _safe_date(y, a, b)          # unambiguous month-first
        return _safe_date(y, a, b) if prefer_us else _safe_date(y, b, a)
    m = re.fullmatch(r"(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})", raw)     # 21 January 2025
    if m and m.group(2).lower() in _MONTHS:
        return _safe_date(int(m.group(3)), _MONTHS[m.group(2).lower()], int(m.group(1)))
    m = re.fullmatch(r"([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})", raw)      # January 17, 2025 / Mar 12, 2025
    if m and m.group(1).lower() in _MONTHS:
        return _safe_date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)))
    return None


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


_DATE_VALUE = r"(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})"

# ---------------------------------------------------------------- fields

# Labels the number can sit behind. "Invoice date" must not be read as an
# invoice number, so the value has to contain a digit and the label is
# followed by an optional number-word, never by "date".
_NUMBER_PATTERNS = [
    # [ \t]* (never \s*) between label and value: text extraction of a
    # multi-column layout puts the NEXT column's label or value on the line
    # below, so crossing a newline reads a customer number as the invoice number.
    re.compile(r"\b(?:invoice|receipt|credit\s*note|credit\s*memo|tax\s*invoice|bill)[ \t]*(?:number|no\.?|nr\.?|num\.?|#|id)[ \t]*[:.]?[ \t]*([A-Z0-9][A-Z0-9/\-]*\d[A-Z0-9/\-]*)", re.I),
    re.compile(r"\b(?:ref(?:erence)?|our[ \t]*ref)[ \t]*(?:number|no\.?|#)?[ \t]*[:.]?[ \t]*([A-Z0-9][A-Z0-9/\-]*\d[A-Z0-9/\-]*)", re.I),
    re.compile(r"\b(?:invoice|receipt)[ \t]*#?[ \t]*([A-Z]{1,5}[\-/]?\d[A-Z0-9/\-]*|\d{3,})\b(?![ \t]*(?:date|due))", re.I),
]

# Ordered from most to least specific. "Subtotal" is excluded by the
# leading (?<!sub) so a subtotal line can never be mistaken for the total.
_TOTAL_LABELS = [
    r"total\s*payable", r"total\s*amount\s*due", r"balance\s*due", r"amount\s*due", r"total\s*due",
    r"grand\s*total", r"(?<!sub)(?<!sub\s)total\s*(?:incl\.?\s*(?:vat|tax|gst)|ttc|brutto)?",
]
_JUNK = r"[^\w\n]{0,14}?"   # OCR debris between a label and its value ('- °  « '), never letters or digits
_AMOUNT_PATTERNS = [re.compile(r"\b" + lab + r"\b" + _JUNK + _MONEY, re.I) for lab in _TOTAL_LABELS]
_AMOUNT_PATTERNS.append(re.compile(_MONEY + r"\s*due\b", re.I))                 # "$875.00 due"

_DATE_LABEL_PATTERNS = [
    re.compile(r"\b(?:invoice\s*date|issue\s*date|issued|date\s*of\s*issue|tax\s*point)\s*[:.]?\s*" + _DATE_VALUE, re.I),
    re.compile(r"(?<!due\s)(?<!due)\bdate\s*[:.]?\s*" + _DATE_VALUE, re.I),
    re.compile(r"\breceipt\s*#?\s*\d+\s+" + _DATE_VALUE, re.I),   # thermal: "Receipt #478 01/16/25"
]
# Last resort: an unlabelled, unambiguous (year-first) date alone on a line.
_DATE_BARE_LINE = re.compile(r"^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*$", re.M)

_VENDOR_LABEL_SAMELINE = re.compile(r"^(?:vendor|from|sold\s*by|supplier|company)\s*:?\s*(\S.*)$", re.I | re.M)
_VENDOR_LABEL_NEXTLINE = re.compile(r"^(?:vendor|from|sold\s*by|supplier|company)\s*:?\s*$\n(.+)$", re.I | re.M)

_BOILERPLATE_START = (
    "invoice", "receipt", "bill to", "ship to", "page", "payment", "customer", "credit",
    "contact", "thanks", "please", "terms", "note", "due", "total", "order", "tax invoice",
    "date", "ref", "document", "account", "register", "for ", "issued", "commercial",
)
_VENDOR_SCAN_WINDOW = 6
_US_HINTS = re.compile(r"\b(?:USD|EIN|\$|Sales tax|Net 30|, [A-Z]{2} \d{5})", re.I)


def _looks_like_a_name(line: str) -> bool:
    low = line.lower()
    if any(low.startswith(w) for w in _BOILERPLATE_START):
        return False
    words = line.split()
    if not (1 <= len(words) <= 6):
        return False
    if not any(c.isalpha() for c in line):
        return False
    if line.islower() or (len(words) == 1 and not line[0].isupper()):
        return False                       # "name", "address": a column label, not a company
    if len(words) == 1 and low in ("name", "address", "number", "total", "amount", "description", "quantity"):
        return False
    if sum(c.isdigit() for c in line) > 3:
        return False                       # addresses, tax ids, phone numbers
    letters = sum(c.isalpha() for c in line)
    if letters / max(1, len(line.replace(" ", ""))) < 0.75:
        return False                       # OCR debris: "* J goo a", "Ps a o@ ” s"
    if sum(1 for w in words if len(w) >= 3) < max(1, len(words) // 2):
        return False
    if low.endswith(".") and not line.isupper() and not re.search(r"\b(ltd|inc|co|gmbh|a\.ş|s\.a|as|llc)\.?$", low):
        return False
    return True


_ABBREV_END = re.compile(r"\b(?:ltd|inc|co|corp|gmbh|a\.ş|s\.a|s\.r\.l|as|llc|plc|pty|bv|nv|oy|ab|sas|sarl|kg|ag)\.$", re.I)


def _clean_vendor(name: str) -> str:
    name = re.sub(r"^[^\w(]+", "", name)                       # OCR debris in front
    name = re.sub(r"\s*[·|\-–—:.]*\s*(?:tax\s*)?(?:invoice|credit\s*note|receipt|statement)\s*$", "", name, flags=re.I)
    # OCR trailing debris: drop tokens from the end that carry no letters
    # or contain characters a company name never has.
    # a logo square or stamp in front of the letterhead comes out as "P|", "@B", "(BB"
    name = re.split(r"\s+(?:Document|Invoice|Customer|Tax\s+invoice|Date|VAT|Bill\s+to)\b", name, maxsplit=1, flags=re.I)[0]
    tokens = name.split()
    while len(tokens) > 1 and (re.search(r"[^\w&'.-]", tokens[0]) or (len(tokens[0]) <= 2 and tokens[0] not in ("A", "I"))):
        tokens.pop(0)
    while tokens and (not re.search(r"[A-Za-zÀ-ÿĀ-žİıŞşĞğ]", tokens[-1]) or re.search(r"[+?*=<>|~^_@#%]", tokens[-1])):
        tokens.pop()
    if len(tokens) > 1 and len(tokens[0]) == 1 and tokens[0] not in ("A", "I"):
        tokens = tokens[1:]                                    # "@B Meridian" -> "B Meridian" -> "Meridian"
    name = " ".join(tokens)
    name = re.sub(r"\s{2,}", " ", name).strip(" ,-·")
    if name.endswith(".") and not _ABBREV_END.search(name):
        name = name[:-1]
    return name


def _extract_number(text: str) -> str | None:
    for pattern in _NUMBER_PATTERNS:
        for m in pattern.finditer(text):
            cand = m.group(1).rstrip(".,:")
            if parse_date(cand, prefer_us=True) is not None:
                continue                                       # that was a date, not a number
            if len(cand) >= 3:
                return cand
    return None


def _extract_amount(text: str) -> float | None:
    for pattern in _AMOUNT_PATTERNS:
        m = pattern.search(text)
        if m:
            return parse_amount(m.group(1))
    return None


def _extract_date(text: str) -> date | None:
    prefer_us = bool(_US_HINTS.search(text))
    for pattern in _DATE_LABEL_PATTERNS:
        for m in pattern.finditer(text):
            d = parse_date(m.group(1), prefer_us=prefer_us)
            if d:
                return d
    m = _DATE_BARE_LINE.search(text)
    return parse_date(m.group(1), prefer_us=prefer_us) if m else None


def _extract_vendor(text: str) -> str | None:
    m = _VENDOR_LABEL_SAMELINE.search(text)
    if m and _looks_like_a_name(m.group(1).strip()):
        return _clean_vendor(m.group(1))
    m = _VENDOR_LABEL_NEXTLINE.search(text)
    if m and _looks_like_a_name(m.group(1).strip()):
        return _clean_vendor(m.group(1))
    # Positional: the letterhead is the first line that reads like a name.
    for line in [ln.strip() for ln in text.splitlines() if ln.strip()][:_VENDOR_SCAN_WINDOW]:
        cand = _clean_vendor(line)
        if cand and _looks_like_a_name(cand):
            return cand
    return None


def _normalise(text: str) -> str:
    # pypdf glues label and value together sometimes ("Invoice numberWS-0622");
    # insert a space between a lowercase letter and an uppercase/digit run.
    text = re.sub(r"([a-z])([A-Z]{2,}|\d)", r"\1 \2", text)
    text = text.replace(" ", " ")
    return text

# ---------------------------------------------------------------- OCR

OCR_DPI = 300


def _deskew(img):
    """Small-angle deskew by maximising the variance of row ink sums: a
    straight text block gives sharp light/dark row bands, a tilted one
    smears them. Coarse-to-fine search on a downscaled copy, then rotate
    the full image once."""
    import numpy as np
    from PIL import Image
    small = img.convert("L").resize((max(1, img.width // 4), max(1, img.height // 4)))

    def score(angle: float) -> float:
        arr = np.asarray(small.rotate(angle, resample=Image.BILINEAR, fillcolor=255), dtype=np.float32)
        rows = (255.0 - arr).sum(axis=1)
        return float(rows.var())

    best = max((a / 10 for a in range(-30, 31, 5)), key=score)
    best = max((best + d / 10 for d in range(-4, 5, 2)), key=score)
    return img.rotate(best, resample=Image.BICUBIC, fillcolor=(255, 255, 255)) if abs(best) >= 0.1 else img


def _preprocess(img):
    from PIL import ImageFilter, ImageOps
    g = ImageOps.autocontrast(img.convert("L"), cutoff=2)
    g = g.filter(ImageFilter.MedianFilter(3))          # isolated speckle becomes punctuation in OCR
    # global threshold; scans here are uniformly lit enough for it, and it
    # removes JPEG speckle that otherwise becomes stray punctuation
    return g.point(lambda p: 255 if p > 165 else 0)


def ocr_pdf_text(pdf_path: Path) -> str | None:
    """Rasterise page 1, deskew, binarise and run tesseract twice (block and
    column segmentation), keeping whichever reading yields more fields.
    Returns None when the optional OCR stack is not installed, so the caller
    can still report the file as unreadable rather than crash."""
    try:
        import pymupdf
        import pytesseract
        from PIL import Image
    except ImportError:
        return None
    doc = pymupdf.open(pdf_path)
    pix = doc[0].get_pixmap(dpi=OCR_DPI, colorspace=pymupdf.csRGB)
    raw = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

    def fields(text: str) -> int:
        inv = extract_from_text(text, pdf_path.name, method="ocr")
        return sum(v is not None for v in (inv.invoice_number, inv.vendor, inv.invoice_date, inv.amount))

    # Tesseract's own binarisation copes with a clean desk scan better than
    # ours does with thin or monospace type, so the untouched raster goes
    # first. Deskew + despeckle + threshold is the rescue path for tilted
    # or speckled pages, and column segmentation the last try for sparse
    # layouts.
    attempts = (lambda: (raw, 6), lambda: (_preprocess(_deskew(raw)), 6), lambda: (_preprocess(_deskew(raw)), 4))
    best, best_n = None, -1
    prepared = None
    try:
        for i, make in enumerate(attempts):
            img, psm = make() if i == 0 else (prepared if prepared is not None else make()[0], 6 if i == 1 else 4)
            if i == 1:
                prepared = img
            text = pytesseract.image_to_string(img, config=f"--psm {psm}")
            n = fields(text)
            if n > best_n:
                best, best_n = text, n
            if best_n == 4:
                break
    except pytesseract.TesseractNotFoundError:
        return None
    return best


# ---------------------------------------------------------------- entry

def extract_from_text(text: str, source_file: str, method: str = "text") -> Invoice:
    text = _normalise(text)
    amount = _extract_amount(text)
    return Invoice(
        source_file=source_file,
        invoice_number=_extract_number(text),
        vendor=_extract_vendor(text),
        invoice_date=_extract_date(text),
        amount=amount,
        extraction_method=method,
    )


def extract_invoice(pdf_path: Path) -> Invoice:
    try:
        text, _ = read_pdf_text(pdf_path)
    except SourceError as err:
        if "no extractable text" in str(err):
            ocr = ocr_pdf_text(pdf_path)
            if ocr and ocr.strip():
                return extract_from_text(ocr, pdf_path.name, method="ocr")
        return Invoice(pdf_path.name, None, None, None, None, extraction_method="none")
    return extract_from_text(text, pdf_path.name)


def extract_invoices(invoice_dir: Path) -> list[Invoice]:
    return [extract_invoice(p) for p in sorted(invoice_dir.glob("*.pdf"))]
