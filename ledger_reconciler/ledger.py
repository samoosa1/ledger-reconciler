"""Read the general ledger export (xlsx)."""
from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

import openpyxl

from .models import LedgerRow

# Expected header row: Date | Description | Reference | Amount
_EXPECTED_HEADERS = ["date", "description", "reference", "amount"]


def read_ledger(xlsx_path: Path) -> list[LedgerRow]:
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb.active

    headers = [str(c.value).strip().lower() if c.value else "" for c in next(ws.iter_rows(min_row=1, max_row=1))]
    missing = [h for h in _EXPECTED_HEADERS if h not in headers]
    if missing:
        raise ValueError(f"Ledger is missing expected column(s): {', '.join(missing)}")
    col = {h: headers.index(h) for h in _EXPECTED_HEADERS}

    rows: list[LedgerRow] = []
    for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
        values = [c.value for c in row]
        if all(v is None for v in values):
            continue

        raw_date = values[col["date"]]
        if isinstance(raw_date, datetime):
            ledger_date = raw_date.date()
        elif isinstance(raw_date, date):
            ledger_date = raw_date
        else:
            ledger_date = None

        raw_amount = values[col["amount"]]
        amount = float(raw_amount) if isinstance(raw_amount, (int, float)) else None

        reference = values[col["reference"]]
        rows.append(LedgerRow(
            row_index=i,
            ledger_date=ledger_date,
            description=str(values[col["description"]] or "").strip(),
            reference=str(reference).strip() if reference else None,
            amount=amount,
        ))
    return rows
