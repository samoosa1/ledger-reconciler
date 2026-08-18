"""Shared data types for invoices, ledger rows, and match results."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class Invoice:
    source_file: str
    invoice_number: str | None
    vendor: str | None
    invoice_date: date | None
    amount: float | None


@dataclass
class LedgerRow:
    row_index: int  # 1-based, matches the spreadsheet row for traceability
    ledger_date: date | None
    description: str
    reference: str | None
    amount: float | None


@dataclass
class MatchResult:
    invoice: Invoice | None
    ledger_row: LedgerRow | None
    flags: list[str] = field(default_factory=list)

    @property
    def status(self) -> str:
        if not self.flags:
            return "matched"
        return ", ".join(self.flags)
