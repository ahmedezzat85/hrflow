"""
be/tests/test_hr_file_layout.py
Verification tests for F3: HR writers use unified file_layout via LocalStorageClient.
Asserts employee docs, company docs, and salary payment docs land in the new layout,
store relative refs, resolve legacy paths via fallback, and preserve traversal guards.
"""
import base64
import os
import pytest

from storage import LocalStorageClient


def _make_pdf_data_url(content: bytes = b"%PDF-1.4 test employee doc") -> str:
    b64 = base64.b64encode(content).decode("ascii")
    return f"data:application/pdf;base64,{b64}"


def _make_png_data_url(content: bytes = b"\x89PNG\r\n\x1a\n fake image content") -> str:
    b64 = base64.b64encode(content).decode("ascii")
    return f"data:image/png;base64,{b64}"


def test_employee_doc_lands_in_hr_layout(tmp_path, monkeypatch):
    """Verifies employee docs land in hr/employees/<id>-<slug>/documents/<filename>."""
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path))
    client = LocalStorageClient()

    pdf_data = b"%PDF-1.4 Employee Passport Scan"
    data_url = _make_pdf_data_url(pdf_data)

    res = client.upload_file(employee_id=42, employee_name="Ahmed Ezzat", file_name="Passport_Scan.pdf", data_url=data_url)
    rel_ref = res["file_id"]

    assert not os.path.isabs(rel_ref)
    assert rel_ref == "hr/employees/42-ahmed-ezzat/documents/passport-scan.pdf"

    # Disk existence
    disk_file = tmp_path / rel_ref
    assert disk_file.is_file()
    assert disk_file.read_bytes() == pdf_data

    # Download
    content, mime, fname = client.download_file(rel_ref)
    assert content == pdf_data
    assert mime == "application/pdf"
    assert fname == "passport-scan.pdf"

    # Delete
    assert client.delete_file(rel_ref) is True
    assert not disk_file.exists()
    assert client.delete_file(rel_ref) is False


def test_company_doc_lands_in_hr_layout(tmp_path, monkeypatch):
    """Verifies company docs land in hr/company-documents/<filename>."""
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path))
    client = LocalStorageClient()

    png_data = b"\x89PNG\r\n\x1a\n Company Org Chart"
    data_url = _make_png_data_url(png_data)

    res = client.upload_company_file(file_name="Org_Chart_2026.png", data_url=data_url)
    rel_ref = res["file_id"]

    assert not os.path.isabs(rel_ref)
    assert rel_ref == "hr/company-documents/org-chart-2026.png"

    disk_file = tmp_path / rel_ref
    assert disk_file.is_file()
    assert disk_file.read_bytes() == png_data

    content, mime, fname = client.download_file(rel_ref)
    assert content == png_data
    assert mime == "image/png"
    assert fname == "org-chart-2026.png"

    assert client.delete_file(rel_ref) is True
    assert not disk_file.exists()


def test_salary_payment_doc_lands_in_hr_layout(tmp_path, monkeypatch):
    """Verifies salary payment docs land in hr/salary-payment-docs/<yyyy>/<yyyy-mm>/."""
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path))
    client = LocalStorageClient()

    docx_bytes = b"PK\x03\x04 Word document content"
    pdf_bytes = b"%PDF-1.4 PDF version of invoice"

    res = client.upload_invoice_file(
        payment_year=2026,
        payment_month=7,
        file_name="260207.docx",
        file_bytes=docx_bytes,
        employee_id=2,
        employee_name="Sarah Connor",
        pdf_bytes=pdf_bytes,
    )
    rel_ref = res["file_id"]

    assert not os.path.isabs(rel_ref)
    assert rel_ref == "hr/salary-payment-docs/2026/2026-07/260207__2-sarah-connor.docx"

    # Both docx and pdf files must exist
    docx_file = tmp_path / rel_ref
    pdf_file = tmp_path / "hr" / "salary-payment-docs" / "2026" / "2026-07" / "260207__2-sarah-connor.pdf"

    assert docx_file.is_file()
    assert docx_file.read_bytes() == docx_bytes
    assert pdf_file.is_file()
    assert pdf_file.read_bytes() == pdf_bytes

    # Download docx
    content, mime, fname = client.download_file(rel_ref)
    assert content == docx_bytes
    assert fname == "260207__2-sarah-connor.docx"

    # Download pdf
    pdf_rel_ref = "hr/salary-payment-docs/2026/2026-07/260207__2-sarah-connor.pdf"
    content_pdf, mime_pdf, fname_pdf = client.download_file(pdf_rel_ref)
    assert content_pdf == pdf_bytes
    assert mime_pdf == "application/pdf"


def test_legacy_hr_paths_resolve_and_download(tmp_path, monkeypatch):
    """Verifies unmigrated legacy HR documents are transparently resolved and downloaded."""
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path))
    client = LocalStorageClient()

    # 1. Legacy employee doc
    legacy_emp_dir = tmp_path / "employees" / "101 - Jane Doe"
    legacy_emp_dir.mkdir(parents=True, exist_ok=True)
    legacy_emp_file = legacy_emp_dir / "offer_letter.pdf"
    emp_bytes = b"%PDF-1.4 Old Offer Letter"
    legacy_emp_file.write_bytes(emp_bytes)

    raw, mime, name = client.download_file("employees/101 - Jane Doe/offer_letter.pdf")
    assert raw == emp_bytes
    assert name == "offer_letter.pdf"

    # 2. Legacy company doc
    legacy_comp_dir = tmp_path / "Company Documents"
    legacy_comp_dir.mkdir(parents=True, exist_ok=True)
    legacy_comp_file = legacy_comp_dir / "handbook.pdf"
    comp_bytes = b"%PDF-1.4 Employee Handbook"
    legacy_comp_file.write_bytes(comp_bytes)

    raw, mime, name = client.download_file("Company Documents/handbook.pdf")
    assert raw == comp_bytes
    assert name == "handbook.pdf"

    # 3. Legacy invoice period doc
    legacy_inv_dir = tmp_path / "Invoices" / "2025" / "2025-12"
    legacy_inv_dir.mkdir(parents=True, exist_ok=True)
    legacy_inv_file = legacy_inv_dir / "INV-2025-12-01.docx"
    inv_bytes = b"PK\x03\x04 Old 2025 invoice"
    legacy_inv_file.write_bytes(inv_bytes)

    raw, mime, name = client.download_file("Invoices/2025/2025-12/INV-2025-12-01.docx")
    assert raw == inv_bytes
    assert name == "INV-2025-12-01.docx"


def test_path_traversal_attacks_blocked(tmp_path, monkeypatch):
    """Verifies that directory traversal and escape attempts are blocked."""
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path))
    client = LocalStorageClient()

    with pytest.raises(ValueError, match="Security error: Invalid path traversal attempt"):
        client.download_file("../../etc/passwd")

    with pytest.raises(ValueError, match="Security error: Invalid path traversal attempt"):
        client.download_file("hr/../../../windows/win.ini")
