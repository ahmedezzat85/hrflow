"""
tests/test_invoices.py
Unit tests for the external-salary invoice generation service
(docs/analysis/invoice-autopay-plan.md): invoice-number construction,
USD/date formatting, eligibility rules, and idempotency, using a fake
sheets client so no real Google Sheets/Drive access is required.
"""
import pytest

from services.invoices import (
    format_invoice_number,
    format_usd_amount,
    format_invoice_date,
    check_eligibility,
    InvoiceEligibilityError,
    build_document_name,
    find_existing_invoice,
)


def test_format_invoice_number_basic():
    assert format_invoice_number(2026, "02", 8) == "260208"


def test_format_invoice_number_december():
    assert format_invoice_number(2026, "02", 12) == "260212"


def test_format_invoice_number_january_next_year():
    assert format_invoice_number(2027, "02", 1) == "270201"


def test_format_invoice_number_pads_single_digit_invoice_id():
    assert format_invoice_number(2026, "2", 8) == "260208"


def test_format_usd_amount_simple():
    assert format_usd_amount(300) == "$300.00"


def test_format_usd_amount_thousands_separator():
    assert format_usd_amount(1250.5) == "$1,250.50"


def test_format_invoice_date_format():
    import datetime as dt
    result = format_invoice_date(dt.datetime(2026, 8, 19, tzinfo=dt.timezone.utc))
    assert result == "19/08/2026"


def test_eligibility_passes_with_all_fields():
    emp = {
        "id": 1, "external_salary_usd": 300, "invoice_id": "2",
        "address_line_1": "15 Example St",
    }
    assert check_eligibility(emp) == "02"


def test_eligibility_fails_on_zero_external_salary():
    emp = {"id": 1, "external_salary_usd": 0, "invoice_id": "2", "address_line_1": "x"}
    with pytest.raises(InvoiceEligibilityError, match="external salary is zero"):
        check_eligibility(emp)


def test_eligibility_fails_on_missing_invoice_id():
    emp = {"id": 1, "external_salary_usd": 300, "invoice_id": "", "address_line_1": "x"}
    with pytest.raises(InvoiceEligibilityError, match="invoice_id is missing"):
        check_eligibility(emp)


def test_eligibility_fails_on_invalid_invoice_id_out_of_range():
    emp = {"id": 1, "external_salary_usd": 300, "invoice_id": "150", "address_line_1": "x"}
    with pytest.raises(InvoiceEligibilityError):
        check_eligibility(emp)


def test_eligibility_fails_on_missing_address():
    emp = {"id": 1, "external_salary_usd": 300, "invoice_id": "02", "address_line_1": ""}
    with pytest.raises(InvoiceEligibilityError, match="address_line_1 is missing"):
        check_eligibility(emp)


def test_build_document_name_sanitizes_spaces():
    name = build_document_name("260208", "Ahmed Ezzat")
    assert name == "Invoice_AHMED_EZZAT_260208.docx"


def test_build_document_name_strips_unsafe_characters():
    name = build_document_name("260208", "Ahmed/Ezzat*?")
    assert name == "Invoice_AHMEDEZZAT_260208.docx"


class _FakeSheetsClient:
    def __init__(self, invoices):
        self._invoices = invoices

    def get_all_records(self, tab_name):
        assert tab_name == "Invoices"
        return self._invoices


def test_find_existing_invoice_matches_employee_and_period():
    client = _FakeSheetsClient([
        {"employee_id": 5, "payment_year": 2026, "payment_month": 8,
         "status": "generated", "invoice_number": "260508"},
    ])
    result = find_existing_invoice(client, 5, 2026, 8)
    assert result is not None
    assert result["invoice_number"] == "260508"


def test_find_existing_invoice_ignores_failed_status():
    client = _FakeSheetsClient([
        {"employee_id": 5, "payment_year": 2026, "payment_month": 8,
         "status": "failed", "invoice_number": ""},
    ])
    assert find_existing_invoice(client, 5, 2026, 8) is None


def test_find_existing_invoice_returns_none_for_different_period():
    client = _FakeSheetsClient([
        {"employee_id": 5, "payment_year": 2026, "payment_month": 7,
         "status": "generated", "invoice_number": "260507"},
    ])
    assert find_existing_invoice(client, 5, 2026, 8) is None
