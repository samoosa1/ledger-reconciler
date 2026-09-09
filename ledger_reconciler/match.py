"""Match invoices against ledger rows and flag anything that doesn't line up.

Matching order:
1. Exact: ledger reference == invoice number.
2. Fallback: same amount, ledger date within DATE_WINDOW_DAYS of the invoice
   date, and the vendor name shows up (fuzzily) in the ledger description.

Anything left over on either side is unmatched. Matched pairs still get
checked for amount drift, and invoice numbers that appear more than once
are flagged as duplicates regardless of whether they matched.

Two payment shapes that are common in practice and look like errors to a
naive matcher are recognised explicitly, and reported as informational
flags rather than as amount mismatches:

- ``paid_in_instalments``: several ledger rows carry the same reference and
  together sum to the invoice.
- ``combined_payment``: one ledger row's reference names several invoice
  numbers and its amount is their sum.
"""
from __future__ import annotations

import re
from datetime import timedelta
from difflib import SequenceMatcher

from docguard.coverage import CoverageError

from .models import Invoice, LedgerRow, MatchResult

DATE_WINDOW_DAYS = 5
AMOUNT_TOLERANCE = 0.01
VENDOR_SIMILARITY_THRESHOLD = 0.5


def _vendor_in_description(vendor: str | None, description: str) -> bool:
    if not vendor:
        return False
    vendor_l, desc_l = vendor.lower(), description.lower()
    if vendor_l in desc_l:
        return True
    return SequenceMatcher(None, vendor_l, desc_l).ratio() >= VENDOR_SIMILARITY_THRESHOLD


def _amounts_close(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= AMOUNT_TOLERANCE


def _find_by_reference(invoice: Invoice, ledger_rows: list[LedgerRow]) -> LedgerRow | None:
    if not invoice.invoice_number:
        return None
    for row in ledger_rows:
        if row.reference and row.reference == invoice.invoice_number:
            return row
    return None


def _find_all_by_reference(invoice: Invoice, ledger_rows: list[LedgerRow]) -> list[LedgerRow]:
    if not invoice.invoice_number:
        return []
    return [row for row in ledger_rows if row.reference and row.reference == invoice.invoice_number]


def _reference_tokens(reference: str | None) -> list[str]:
    return re.split(r"[\s,;+/&]+", reference.strip()) if reference else []


def _find_combined(invoice: Invoice, ledger_rows: list[LedgerRow]) -> LedgerRow | None:
    """A row whose reference lists this invoice number among others."""
    if not invoice.invoice_number:
        return None
    for row in ledger_rows:
        toks = _reference_tokens(row.reference)
        if len(toks) >= 2 and invoice.invoice_number in toks:
            return row
    return None


def _find_by_amount_and_date(invoice: Invoice, ledger_rows: list[LedgerRow]) -> LedgerRow | None:
    if invoice.amount is None or invoice.invoice_date is None:
        return None
    candidates = []
    for row in ledger_rows:
        if not _amounts_close(row.amount, invoice.amount) or row.ledger_date is None:
            continue
        if abs((row.ledger_date - invoice.invoice_date).days) > DATE_WINDOW_DAYS:
            continue
        candidates.append(row)
    if len(candidates) == 1:
        return candidates[0]
    # Ambiguous (0 or >1 candidates) — narrow by vendor name if we can.
    vendor_matches = [r for r in candidates if _vendor_in_description(invoice.vendor, r.description)]
    return vendor_matches[0] if len(vendor_matches) == 1 else None


def reconcile(invoices: list[Invoice], ledger_rows: list[LedgerRow]) -> list[MatchResult]:
    results: list[MatchResult] = []
    unmatched_ledger = list(ledger_rows)

    number_counts: dict[str, int] = {}
    for inv in invoices:
        if inv.invoice_number:
            number_counts[inv.invoice_number] = number_counts.get(inv.invoice_number, 0) + 1

    # Combined payments are resolved first, across invoices: one ledger row
    # settles several invoices, so it is consumed once and every invoice it
    # names gets the same row.
    combined: dict[int, tuple[LedgerRow, list[Invoice]]] = {}
    for inv in invoices:
        row = _find_combined(inv, unmatched_ledger)
        if row is not None:
            combined.setdefault(id(row), (row, []))[1].append(inv)
    combined_rows: dict[int, LedgerRow] = {}
    for row, inv_list in combined.values():
        if len(inv_list) < 2 or any(i.amount is None for i in inv_list):
            continue
        if _amounts_close(sum(i.amount for i in inv_list), row.amount):
            unmatched_ledger.remove(row)
            for i in inv_list:
                combined_rows[id(i)] = row

    for inv in invoices:
        flags: list[str] = []
        if inv.invoice_number is None or inv.vendor is None or inv.invoice_date is None or inv.amount is None:
            flags.append("unreadable_invoice")

        can_attempt = bool(inv.invoice_number) or (inv.amount is not None and inv.invoice_date is not None)
        match = None
        extra: list[LedgerRow] = []
        if id(inv) in combined_rows:
            match = combined_rows[id(inv)]
            flags.append("combined_payment")
        elif can_attempt:
            same_ref = _find_all_by_reference(inv, unmatched_ledger)
            if len(same_ref) >= 2 and inv.amount is not None and _amounts_close(sum(r.amount or 0.0 for r in same_ref), inv.amount):
                match, extra = same_ref[0], same_ref[1:]
                for r in same_ref:
                    unmatched_ledger.remove(r)
                flags.append("paid_in_instalments")
            else:
                match = _find_by_reference(inv, unmatched_ledger) or _find_by_amount_and_date(inv, unmatched_ledger)
                if match:
                    unmatched_ledger.remove(match)
                    # An unread amount is already reported as unreadable_invoice;
                    # calling it a mismatch would assert a comparison never made.
                    if inv.amount is not None and not _amounts_close(inv.amount, match.amount):
                        flags.append("amount_mismatch")
                else:
                    flags.append("no_ledger_entry")

        if inv.invoice_number and number_counts[inv.invoice_number] > 1:
            flags.append("duplicate_invoice")

        results.append(MatchResult(invoice=inv, ledger_row=match, flags=flags, extra_rows=extra))

    for row in unmatched_ledger:
        results.append(MatchResult(invoice=None, ledger_row=row, flags=["no_invoice"]))

    _assert_full_coverage(invoices, ledger_rows, results)
    return results


# reconcile()'s own invariant isn't the same shape as docguard.coverage's
# rule-based bucketing (there's no regex classification here, just "did
# every input row make it into the output"), so this check stays local —
# only the exception type is shared, so callers of either library catch
# the same thing.
def _assert_full_coverage(invoices: list[Invoice], ledger_rows: list[LedgerRow],
                           results: list[MatchResult]) -> None:
    seen_invoices = [r.invoice for r in results if r.invoice is not None]
    seen_ledger_ids = set()
    for r in results:
        if r.ledger_row is not None:
            seen_ledger_ids.add(id(r.ledger_row))
        for x in r.extra_rows:
            seen_ledger_ids.add(id(x))
    seen_ledger = [row for row in ledger_rows if id(row) in seen_ledger_ids]

    if len(seen_invoices) != len(invoices):
        raise CoverageError(
            f"{len(invoices)} invoices went in, {len(seen_invoices)} came back out "
            f"in the results — reconcile() dropped {len(invoices) - len(seen_invoices)}."
        )
    if len(seen_ledger) != len(ledger_rows):
        raise CoverageError(
            f"{len(ledger_rows)} ledger rows went in, {len(seen_ledger)} came back out "
            f"in the results — reconcile() dropped {len(ledger_rows) - len(seen_ledger)}."
        )
