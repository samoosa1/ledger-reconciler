"""Score the extractor against sample_data/EXPECTED.json, the ground truth
the generator wrote. Run directly for a per-field report; test_sample_truth.py
pins the thresholds.

    .venv/bin/python -m tests.oracle_sample_truth
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from ledger_reconciler.extract import extract_invoice

ROOT = Path(__file__).resolve().parent.parent
TRUTH = ROOT / "sample_data" / "EXPECTED.json"


def score(only: str | None = None) -> dict:
    truth = json.loads(TRUTH.read_text())["invoices"]
    rows = []
    for t in truth:
        kind = "scan" if t["scanned"] else "clean"
        if only and kind != only:
            continue
        inv = extract_invoice(ROOT / "sample_data" / "invoices" / t["file"])
        rows.append({
            "file": t["file"], "kind": kind, "template": t["template"],
            "number": inv.invoice_number == t["invoice_number"],
            "vendor": (inv.vendor or "").casefold() == t["vendor"].casefold(),
            "date": inv.invoice_date == date.fromisoformat(t["invoice_date"]),
            "amount": inv.amount is not None and abs(inv.amount - t["amount"]) < 0.005,
            "got": (inv.invoice_number, inv.vendor, str(inv.invoice_date), inv.amount),
            "want": (t["invoice_number"], t["vendor"], t["invoice_date"], t["amount"]),
        })
    return {"rows": rows, **{f: sum(r[f] for r in rows) / max(1, len(rows)) for f in ("number", "vendor", "date", "amount")}}


if __name__ == "__main__":
    for kind in ("clean", "scan"):
        s = score(kind)
        print(f"{kind:5s} n={len(s['rows']):3d}  number {s['number']:.0%}  vendor {s['vendor']:.0%}  date {s['date']:.0%}  amount {s['amount']:.0%}")
        by_tpl = {}
        for r in s["rows"]:
            by_tpl.setdefault(r["template"], []).append(r)
        for tpl, rs in sorted(by_tpl.items()):
            print(f"   {tpl:24s} n={len(rs):2d} " + "  ".join(f"{f} {sum(r[f] for r in rs)}/{len(rs)}" for f in ("number", "vendor", "date", "amount")))
        for r in [r for r in s["rows"] if not all(r[f] for f in ("number", "vendor", "date", "amount"))][:6]:
            print("     miss", r["file"], "got", r["got"], "want", r["want"])
