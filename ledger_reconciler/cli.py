"""Command-line entry point.

Usage:
    python -m ledger_reconciler <invoice_dir> <ledger.xlsx> [-o report.xlsx]
"""
from __future__ import annotations

import argparse
from pathlib import Path

from .extract import extract_invoices
from .ledger import read_ledger
from .match import reconcile
from .report import build_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Reconcile invoice PDFs against a ledger export.")
    parser.add_argument("invoice_dir", type=Path, help="Folder of invoice PDFs")
    parser.add_argument("ledger_xlsx", type=Path, help="Ledger export (.xlsx)")
    parser.add_argument("-o", "--out", type=Path, default=Path("reconciliation_report.xlsx"))
    args = parser.parse_args()

    invoices = extract_invoices(args.invoice_dir)
    ledger_rows = read_ledger(args.ledger_xlsx)
    results = reconcile(invoices, ledger_rows)
    build_report(results, args.out)

    matched = sum(1 for r in results if not r.flags)
    print(f"{len(invoices)} invoices, {len(ledger_rows)} ledger rows -> "
          f"{matched}/{len(results)} matched clean, {len(results) - matched} flagged")
    print(f"Report written to {args.out}")


if __name__ == "__main__":
    main()
