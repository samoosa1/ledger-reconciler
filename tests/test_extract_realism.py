"""Extraction has to generalize past the sample-data generator's own exact
labels, or it isn't proving anything. These invoices use different field
labels, a prose date format, and (for the bad scan) no reliable structure
at all — checking that a genuinely unreadable invoice is correctly reported
as unreadable rather than silently guessed at.
"""
from datetime import date

from ledger_reconciler.extract import extract_invoice

from ._messy_invoice_fixtures import write_format_b, write_format_c, write_format_d_bad_scan


def test_extracts_different_labels_and_prose_date(tmp_path):
    p = tmp_path / "nordway.pdf"
    write_format_b(p)
    inv = extract_invoice(p)
    assert inv.invoice_number == "NW-88231"
    assert inv.vendor == "Nordway Logistics"
    assert inv.invoice_date == date(2025, 3, 14)
    assert inv.amount == 1940.0


def test_extracts_ref_label_and_slash_date_with_no_vendor_tag(tmp_path):
    p = tmp_path / "cedarfinch.pdf"
    write_format_c(p)
    inv = extract_invoice(p)
    assert inv.invoice_number == "CF-2025-014"
    assert inv.vendor == "Cedar & Finch Consulting"
    assert inv.invoice_date == date(2025, 3, 22)
    assert inv.amount == 875.0


def test_unreadable_scan_fails_honestly_instead_of_guessing(tmp_path):
    p = tmp_path / "badscan.pdf"
    write_format_d_bad_scan(p)
    inv = extract_invoice(p)
    # No usable number, date, or amount on a genuinely bad scan — the caller
    # (match.reconcile) turns these Nones into an "unreadable_invoice" flag
    # rather than the report silently showing a wrong number.
    assert inv.invoice_number is None
    assert inv.invoice_date is None
    assert inv.amount is None
