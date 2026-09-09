"""Extraction scored against the generator's own ground truth
(sample_data/EXPECTED.json). Clean text-layer files must read perfectly.
Scanned files go through OCR, which is slow (a few seconds a page) and
needs the tesseract binary, so that half runs only when asked:

    LEDGER_OCR_TESTS=1 .venv/bin/python -m pytest tests/test_sample_truth.py
"""
import os

import pytest

from .oracle_sample_truth import TRUTH, score

pytestmark = pytest.mark.skipif(not TRUTH.exists(), reason="sample_data not generated")


def test_clean_text_layer_invoices_read_perfectly():
    s = score("clean")
    assert len(s["rows"]) >= 40
    for field in ("number", "vendor", "date", "amount"):
        assert s[field] == 1.0, f"{field}: {s[field]:.0%}"


@pytest.mark.skipif(not os.environ.get("LEDGER_OCR_TESTS"), reason="set LEDGER_OCR_TESTS=1 to run OCR scoring")
def test_scanned_invoices_read_most_fields_through_ocr():
    pytest.importorskip("pytesseract")
    s = score("scan")
    assert len(s["rows"]) >= 20
    # Floors, not targets: they exist so a regression in the OCR path is
    # caught, and they are deliberately below what the current code does.
    assert s["amount"] >= 0.80, f"amount {s['amount']:.0%}"
    assert s["date"] >= 0.80, f"date {s['date']:.0%}"
    assert s["number"] >= 0.60, f"number {s['number']:.0%}"
    assert s["vendor"] >= 0.50, f"vendor {s['vendor']:.0%}"
