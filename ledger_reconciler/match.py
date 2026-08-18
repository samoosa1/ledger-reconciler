"""Match invoices against ledger rows and flag anything that doesn't line up.

Matching order:
1. Exact: ledger reference == invoice number.
2. Fallback: same amount, ledger date within DATE_WINDOW_DAYS of the invoice
   date, and the vendor name shows up (fuzzily) in the ledger description.

Anything left over on either side is unmatched. Matched pairs still get
checked for amount drift, and invoice numbers that appear more than once
are flagged as duplicates regardless of whether they matched.
"""
from __future__ import annotations

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

    for inv in invoices:
        flags: list[str] = []
        if inv.invoice_number is None or inv.vendor is None or inv.invoice_date is None or inv.amount is None:
            flags.append("unreadable_invoice")

        # Both matching strategies need either an invoice number or an
        # amount+date pair. If neither is present, there's nothing to
        # search with — reporting "no_ledger_entry" on top of that would
        # claim a real finding (searched, found nothing) when actually
        # nothing was searched at all. Distinguishing these two matters:
        # one means "the payment might genuinely be missing," the other
        # means "we can't say anything about this invoice."
        can_attempt = bool(inv.invoice_number) or (inv.amount is not None and inv.invoice_date is not None)
        match = None
        if can_attempt:
            match = _find_by_reference(inv, unmatched_ledger) or _find_by_amount_and_date(inv, unmatched_ledger)
            if match:
                unmatched_ledger.remove(match)
                if not _amounts_close(inv.amount, match.amount):
                    flags.append("amount_mismatch")
            else:
                flags.append("no_ledger_entry")

        if inv.invoice_number and number_counts[inv.invoice_number] > 1:
            flags.append("duplicate_invoice")

        results.append(MatchResult(invoice=inv, ledger_row=match, flags=flags))

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
    seen_ledger = [r.ledger_row for r in results if r.ledger_row is not None]

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
