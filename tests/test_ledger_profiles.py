"""One synthetic ledger per supported platform, in that platform's actual
column layout, checking detection picks the right profile and reads correct
values — not just that the generic Date/Description/Reference/Amount shape
works, which would prove nothing about the other four.
"""
from datetime import date

import openpyxl

from ledger_reconciler.ledger import read_ledger


def _write_ledger(path, headers, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    wb.save(path)


def test_generic_format(tmp_path):
    p = tmp_path / "generic.xlsx"
    _write_ledger(p, ["Date", "Description", "Reference", "Amount"],
                  [[date(2025, 3, 1), "Payment to Acme Co", "INV-1", 100.0]])
    [row] = read_ledger(p)
    assert row.ledger_date == date(2025, 3, 1)
    assert row.reference == "INV-1"
    assert row.amount == 100.0


def test_xero_format_with_debit_credit_split(tmp_path):
    p = tmp_path / "xero.xlsx"
    _write_ledger(p, ["Date", "Source", "Reference", "Description", "Debit", "Credit"],
                  [[date(2025, 3, 1), "Accounts Payable", "INV-1", "Acme Co invoice", 250.0, None],
                   [date(2025, 3, 3), "Accounts Payable", "INV-2", "Bexley Ltd invoice", None, 75.5]])
    rows = read_ledger(p)
    assert rows[0].amount == 250.0
    assert rows[0].reference == "INV-1"
    assert rows[1].amount == 75.5  # credit-side row, no debit value


def test_wave_format(tmp_path):
    p = tmp_path / "wave.xlsx"
    _write_ledger(p, ["Date", "Description", "Amount", "Account"],
                  [[date(2025, 3, 1), "Payment to Acme Co", 100.0, "Business Checking"]])
    [row] = read_ledger(p)
    assert row.amount == 100.0
    assert row.reference is None  # Wave exports have no reference column


def test_freshbooks_format(tmp_path):
    p = tmp_path / "freshbooks.xlsx"
    _write_ledger(p, ["Date", "Vendor", "Category", "Amount", "Currency", "Tax"],
                  [[date(2025, 3, 1), "Acme Co", "Office Supplies", 100.0, "USD", 0.0]])
    [row] = read_ledger(p)
    assert row.amount == 100.0
    assert row.description == "Acme Co"


def test_quickbooks_format(tmp_path):
    p = tmp_path / "quickbooks.xlsx"
    _write_ledger(p, ["Date", "Transaction Type", "Num", "Name", "Memo/Description", "Account", "Amount"],
                  [[date(2025, 3, 1), "Bill Payment", "1001", "Acme Co", "March invoice", "Checking", 100.0]])
    [row] = read_ledger(p)
    assert row.amount == 100.0
    assert row.reference == "1001"


def test_unrecognized_layout_raises_clearly(tmp_path):
    p = tmp_path / "weird.xlsx"
    _write_ledger(p, ["Foo", "Bar", "Baz"], [["x", "y", "z"]])
    try:
        read_ledger(p)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "Foo" in str(e)  # error should show what it actually found
