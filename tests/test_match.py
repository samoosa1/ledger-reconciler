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


def test_unread_amount_is_unreadable_not_a_mismatch():
    row = _row(amount=150.0)
    [result] = reconcile([_inv(amount=None)], [row])
    assert result.ledger_row is row
    assert "unreadable_invoice" in result.flags
    assert "amount_mismatch" not in result.flags


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


def test_two_instalments_with_same_reference_are_not_a_mismatch():
    a = _row(idx=2, amount=60.0)
    b = _row(idx=3, d=date(2025, 1, 24), desc="Payment to Acme Co (balance)", amount=40.0)
    [result] = reconcile([_inv(amount=100.0)], [a, b])
    assert result.flags == ["paid_in_instalments"]
    assert result.ledger_row is a and result.extra_rows == [b]


def test_instalments_that_do_not_sum_are_still_a_mismatch():
    a = _row(idx=2, amount=60.0)
    b = _row(idx=3, amount=30.0)
    results = reconcile([_inv(amount=100.0)], [a, b])
    inv_result = next(r for r in results if r.invoice is not None)
    assert "amount_mismatch" in inv_result.flags
    assert sum(1 for r in results if r.flags == ["no_invoice"]) == 1


def test_one_transfer_settling_two_invoices_matches_both():
    inv_a = _inv(number="INV-1", amount=100.0, source="a.pdf")
    inv_b = _inv(number="INV-2", amount=50.0, source="b.pdf")
    row = _row(desc="Wire transfer INV-1 + INV-2", ref="INV-1 INV-2", amount=150.0)
    results = reconcile([inv_a, inv_b], [row])
    assert [r.flags for r in results] == [["combined_payment"], ["combined_payment"]]
    assert all(r.ledger_row is row for r in results)


def test_combined_reference_with_wrong_total_falls_back_to_no_match():
    inv_a = _inv(number="INV-1", amount=100.0, source="a.pdf")
    inv_b = _inv(number="INV-2", amount=50.0, source="b.pdf")
    row = _row(ref="INV-1 INV-2", amount=140.0)
    results = reconcile([inv_a, inv_b], [row])
    flags = sorted(tuple(r.flags) for r in results)
    assert ("no_invoice",) in flags
    assert all("combined_payment" not in r.flags for r in results)
