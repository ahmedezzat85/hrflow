"""
tests/test_invoices.py
Unit tests for the external-salary invoice generation service
(docs/analysis/invoice-autopay-plan.md): invoice-number construction,
USD/date formatting, eligibility rules, and idempotency, using a fake
sheets client so no real Google Sheets/Drive access is required.
"""
import pytest

from services.salary_payment_docs import (
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


def test_regenerate_invoice_updates_existing_record_in_place(monkeypatch):
    from services.salary_payment_docs import generate_invoice_for_employee
    import services.salary_payment_docs as inv_svc

    monkeypatch.setattr(inv_svc, "render_invoice_document", lambda ctx: b"fake-docx-bytes")
    monkeypatch.setattr("services.pdf_converter.convert_docx_to_pdf_bytes", lambda b: b"%PDF-1.4 fake-pdf")
    fake_drive = type("FakeDrive", (), {
        "upload_invoice_file": lambda self, *args, **kwargs: {"file_id": "file-123", "view_url": "http://view/123"}
    })()

    monkeypatch.setattr("drive_client.get_drive_client", lambda: fake_drive)

    class MockRepo:
        def __init__(self):
            self.records = [
                {
                    "id": 1,
                    "employee_id": 10,
                    "employee_name": "Test Emp",
                    "payment_year": 2026,
                    "payment_month": 8,
                    "status": "generated",
                    "invoice_number": "261008",
                    "amount_usd": 500.0,
                    "drive_file_id": "old-file-id",
                    "drive_web_url": "http://old-view",
                }
            ]
            self.updated = []

        def find_existing(self, emp_id, year, month):
            for r in self.records:
                if r["employee_id"] == emp_id and r["payment_year"] == year and r["payment_month"] == month and r["status"] == "generated":
                    return r
            return None

        def update(self, inv_id, updates):
            self.updated.append((inv_id, updates))
            for r in self.records:
                if r["id"] == inv_id:
                    r.update(updates)
                    return True
            return False

        def create(self, data):
            new_id = len(self.records) + 1
            self.records.append({"id": new_id, **data})
            return new_id

    repo = MockRepo()
    emp = {
        "id": 10,
        "name": "Test Emp",
        "external_salary_usd": 600,  # salary updated from 500 to 600
        "invoice_id": "10",
        "address_line_1": "123 Main St",
    }

    # 1. With skip_existing=True, should return already_exists
    skipped_res = generate_invoice_for_employee(repo, emp, 2026, 8, "admin@test.com", skip_existing=True)
    assert skipped_res["status"] == "already_exists"
    assert len(repo.updated) == 0

    # 2. With skip_existing=False (regeneration), should overwrite/update existing record
    regen_res = generate_invoice_for_employee(repo, emp, 2026, 8, "admin@test.com", skip_existing=False)
    assert regen_res["status"] == "generated"
    assert len(repo.records) == 1  # No duplicate rows created!
    assert len(repo.updated) == 1
    assert repo.records[0]["amount_usd"] == 600.0
    assert repo.records[0]["drive_file_id"] == "file-123"


def test_api_regenerate_single_invoice_flow(app_client, admin_cookies, monkeypatch):
    import services.salary_payment_docs as inv_svc
    import services.pdf_converter as pdf_svc

    monkeypatch.setattr(inv_svc, "render_invoice_document", lambda ctx: b"fake-docx-bytes")
    monkeypatch.setattr(pdf_svc, "convert_docx_to_pdf_bytes", lambda b: b"%PDF-1.4 fake-pdf")


    # 1. Setup employee with external salary
    app_client.put(
        "/api/employees/2",
        json={"external_salary_usd": 750, "invoice_id": "02", "address_line_1": "Test Address"},
        cookies=admin_cookies,
    )

    # 2. First generation (skip_existing=True)
    res1 = app_client.post(
        "/api/invoices/generate/2",
        json={"payment_year": 2026, "payment_month": 8, "skip_existing": True},
        cookies=admin_cookies,
    )
    assert res1.status_code == 200
    assert res1.json()["status"] == "generated"

    # 3. Second call with skip_existing=True -> returns already_exists
    res2 = app_client.post(
        "/api/invoices/generate/2",
        json={"payment_year": 2026, "payment_month": 8, "skip_existing": True},
        cookies=admin_cookies,
    )
    assert res2.status_code == 200
    assert res2.json()["status"] == "already_exists"

    # 4. Third call with skip_existing=False (regenerate) -> succeeds with status generated
    res3 = app_client.post(
        "/api/invoices/generate/2",
        json={"payment_year": 2026, "payment_month": 8, "skip_existing": False},
        cookies=admin_cookies,
    )
    assert res3.status_code == 200
    assert res3.json()["status"] == "generated"

    # 5. List invoices -> ensure only 1 invoice exists for employee 2 in period 2026-08 (no duplicates)
    list_res = app_client.get("/api/invoices?employee_id=2&payment_year=2026&payment_month=8", cookies=admin_cookies)
    assert list_res.status_code == 200
    invoices = list_res.json()
    assert len(invoices) == 1
    assert invoices[0]["status"] == "generated"
    invoice_id = invoices[0]["id"]

    # 6. Stream PDF preview for this invoice
    monkeypatch.setattr("services.salary_payment_docs.get_invoice_pdf_bytes", lambda inv: (b"%PDF-1.4 fake-pdf-content", "Invoice_TEST_260208.pdf"))
    stream_res = app_client.get(f"/api/invoices/{invoice_id}/stream", cookies=admin_cookies)
    assert stream_res.status_code == 200
    assert stream_res.headers["content-type"] == "application/pdf"
    assert "inline" in stream_res.headers.get("content-disposition", "")
    assert stream_res.content == b"%PDF-1.4 fake-pdf-content"

    # 7. Download PDF
    download_res = app_client.get(f"/api/invoices/{invoice_id}/stream?download=true", cookies=admin_cookies)
    assert download_res.status_code == 200
    assert "attachment" in download_res.headers.get("content-disposition", "")


def test_pdf_converter_graceful_handling_empty_input():
    from services.pdf_converter import convert_docx_to_pdf_bytes
    assert convert_docx_to_pdf_bytes(b"") is None
    assert convert_docx_to_pdf_bytes(None) is None


