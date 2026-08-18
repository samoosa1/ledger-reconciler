"""Three checks ported from lessons learned building similar tools before:
a never-drop-a-row coverage guarantee, a distinct 'can't verify' state that
doesn't masquerade as a real finding, and defense against a vendor/description
value that happens to start with a formula-trigger character.
"""
from datetime import date

from ledger_reconciler.match import reconcile
from ledger_reconciler.models import Invoice, LedgerRow
from ledger_reconciler.report import _safe_write


def test_completely_unreadable_invoice_gets_no_false_finding():
    """An invoice with no number and no amount/date can't be searched for at
    all — it should be flagged unreadable and ONLY unreadable, not also
    'no_ledger_entry', which would claim a real (and untrue) finding that a
    search happened and came up empty."""
    unreadable = Invoice(source_file="bad.pdf", invoice_number=None, vendor=None,
                          invoice_date=None, amount=None)
    [result] = reconcile([unreadable], [])
    assert result.flags == ["unreadable_invoice"]


def test_partially_readable_invoice_still_gets_a_real_no_ledger_entry_finding():
    """Contrast case: SOME fields present (a number here) means a search is
    actually possible, so a real miss is still a real finding."""
    partial = Invoice(source_file="partial.pdf", invoice_number="INV-9",
                       vendor=None, invoice_date=None, amount=None)
    [result] = reconcile([partial], [])
    assert "unreadable_invoice" in result.flags
    assert "no_ledger_entry" in result.flags


def test_reconcile_never_silently_drops_a_row():
    """Every invoice and every ledger row must appear in the results exactly
    once — reconcile() self-checks this and raises rather than let a bug
    quietly lose a row (see match.CoverageError)."""
    invoices = [Invoice("a.pdf", "INV-1", "Acme", date(2025, 1, 1), 50.0)]
    ledger = [LedgerRow(2, date(2025, 1, 1), "unrelated payment", None, 999.0)]
    results = reconcile(invoices, ledger)
    seen_invoices = [r for r in results if r.invoice is not None]
    seen_ledger = [r for r in results if r.ledger_row is not None]
    assert len(seen_invoices) == len(invoices)
    assert len(seen_ledger) == len(ledger)


def test_formula_like_vendor_name_is_escaped_in_the_report():
    class FakeCell:
        value = None
    cell = FakeCell()
    _safe_write(cell, "=SUM(A1:A9)")
    assert cell.value == "'=SUM(A1:A9)"  # leading quote forces text, not a formula


def test_ordinary_values_pass_through_unchanged():
    class FakeCell:
        value = None
    cell = FakeCell()
    _safe_write(cell, "Acme Co")
    assert cell.value == "Acme Co"
    _safe_write(cell, 42.5)
    assert cell.value == 42.5
