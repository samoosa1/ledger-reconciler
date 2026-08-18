from datetime import date

from ledger_reconciler.match import reconcile
from ledger_reconciler.models import Invoice, LedgerRow


def _inv(number="INV-1", vendor="Acme Co", d=date(2025, 1, 10), amount=100.0, source="a.pdf"):
    return Invoice(source_file=source, invoice_number=number, vendor=vendor, invoice_date=d, amount=amount)


def _row(idx=2, d=date(2025, 1, 10), desc="Payment to Acme Co", ref="INV-1", amount=100.0):
    return LedgerRow(row_index=idx, ledger_date=d, description=desc, reference=ref, amount=amount)


def test_exact_reference_match_is_clean():
    [result] = reconcile([_inv()], [_row()])
    assert result.flags == []
    assert result.status == "matched"


def test_missing_ledger_entry_is_flagged():
    [result] = reconcile([_inv()], [])
    assert result.flags == ["no_ledger_entry"]


def test_undocumented_ledger_row_is_flagged():
    [result] = reconcile([], [_row()])
    assert result.flags == ["no_invoice"]


def test_amount_mismatch_still_matches_but_flags():
    row = _row(amount=150.0)
    [result] = reconcile([_inv(amount=100.0)], [row])
    assert result.ledger_row is row
    assert "amount_mismatch" in result.flags


def test_duplicate_invoice_number_flags_both_copies():
    inv_a = _inv(source="a.pdf")
    inv_b = _inv(source="a_rescan.pdf")
    row = _row()
    results = reconcile([inv_a, inv_b], [row])
    assert all("duplicate_invoice" in r.flags for r in results)
    # only one of the two can actually claim the single ledger row
    matched = [r for r in results if r.ledger_row is not None]
    assert len(matched) == 1


def test_amount_and_date_fallback_when_no_reference():
    inv = _inv(number="INV-9", amount=250.0, d=date(2025, 2, 1))
    row = _row(ref=None, amount=250.0, d=date(2025, 2, 3), desc="Payment to Acme Co")
    [result] = reconcile([inv], [row])
    assert result.ledger_row is row
    assert result.flags == []
