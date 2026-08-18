"""Render reconciliation results to a formatted Excel workbook."""
from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .models import MatchResult

_HEADER_FILL = PatternFill("solid", fgColor="1F3864")
_HEADER_FONT = Font(color="FFFFFF", bold=True)
_FLAG_FILL = PatternFill("solid", fgColor="FCE4E4")
_OK_FILL = PatternFill("solid", fgColor="E6F4EA")

_DETAIL_HEADERS = [
    "Status", "Invoice #", "Vendor", "Invoice Date", "Invoice Amount",
    "Ledger Row", "Ledger Date", "Ledger Description", "Ledger Amount", "Source File",
]


def _safe_write(cell, value) -> None:
    """Write a value that may come from untrusted document content (a vendor
    name, a ledger description) without letting Excel reinterpret it as a
    formula. openpyxl treats any string starting with '=' (also '+', '-',
    '@' in some Excel versions) as a formula rather than a label — a vendor
    literally named "=SUM(A1:A9)" or a memo field a malicious PDF crafted on
    purpose would otherwise silently execute as a formula, or render as
    #NAME? / blank instead of the actual text. Prefixing a single quote
    forces it back to a text label; openpyxl strips the quote from display,
    Excel does not treat it as formula input."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        cell.value = "'" + value
    else:
        cell.value = value


def _style_header(ws, headers: list[str]) -> None:
    for col, title in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col, value=title)
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT
        cell.alignment = Alignment(horizontal="left")
    for col in range(1, len(headers) + 1):
        ws.column_dimensions[get_column_letter(col)].width = 20


def _write_summary(ws, results: list[MatchResult]) -> None:
    matched = sum(1 for r in results if not r.flags)
    flagged = len(results) - matched
    counts: dict[str, int] = {}
    for r in results:
        for f in r.flags:
            counts[f] = counts.get(f, 0) + 1

    ws["A1"] = "Reconciliation Summary"
    ws["A1"].font = Font(bold=True, size=14)
    rows = [
        ("Total items", len(results)),
        ("Matched clean", matched),
        ("Flagged", flagged),
        ("Match rate", f"{matched / len(results):.0%}" if results else "n/a"),
        ("", ""),
    ] + [(f"  {flag}", n) for flag, n in sorted(counts.items())]

    for i, (label, value) in enumerate(rows, start=3):
        ws.cell(row=i, column=1, value=label)
        ws.cell(row=i, column=2, value=value)
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 12


def build_report(results: list[MatchResult], out_path: Path) -> None:
    wb = Workbook()
    summary_ws = wb.active
    summary_ws.title = "Summary"
    _write_summary(summary_ws, results)

    detail_ws = wb.create_sheet("Detail")
    _style_header(detail_ws, _DETAIL_HEADERS)

    for i, r in enumerate(results, start=2):
        inv, row = r.invoice, r.ledger_row
        values = [
            r.status,
            inv.invoice_number if inv else None,
            inv.vendor if inv else None,
            inv.invoice_date.isoformat() if inv and inv.invoice_date else None,
            inv.amount if inv else None,
            row.row_index if row else None,
            row.ledger_date.isoformat() if row and row.ledger_date else None,
            row.description if row else None,
            row.amount if row else None,
            inv.source_file if inv else None,
        ]
        fill = _OK_FILL if not r.flags else _FLAG_FILL
        for col, value in enumerate(values, start=1):
            cell = detail_ws.cell(row=i, column=col)
            _safe_write(cell, value)
            cell.fill = fill

    wb.save(out_path)
