"""
tests/test_local_storage.py
Comprehensive test suite for LocalStorageClient and local storage configuration.
"""
import base64
import os
import pytest
from fastapi.testclient import TestClient

from config import Config
from storage import LocalStorageClient, get_storage_client, reset_storage_client_for_testing
import storage


def _valid_pdf_data_url():
    pdf_bytes = b"%PDF-1.4 minimal test pdf content"
    b64 = base64.b64encode(pdf_bytes).decode("ascii")
    return f"data:application/pdf;base64,{b64}"


def _valid_png_data_url():
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


class TestLocalStorageClient:
    def test_employee_document_upload_and_download(self, tmp_path):
        client = LocalStorageClient(base_path=str(tmp_path))
        data_url = _valid_pdf_data_url()

        res = client.upload_file(101, "Jane Doe", "offer_letter.pdf", data_url)
        assert res["file_id"] == "employees/101 - Jane Doe/offer_letter.pdf"

        # Verify physical file on disk
        disk_path = tmp_path / "employees" / "101 - Jane Doe" / "offer_letter.pdf"
        assert disk_path.is_file()
        assert disk_path.read_bytes() == b"%PDF-1.4 minimal test pdf content"

        # Verify download
        raw_bytes, mime, file_name = client.download_file(res["file_id"])
        assert raw_bytes == b"%PDF-1.4 minimal test pdf content"
        assert mime == "application/pdf"
        assert file_name == "offer_letter.pdf"

    def test_company_document_upload_and_download(self, tmp_path):
        client = LocalStorageClient(base_path=str(tmp_path))
        data_url = _valid_png_data_url()

        res = client.upload_company_file("company_policy.png", data_url)
        assert res["file_id"] == "Company Documents/company_policy.png"

        disk_path = tmp_path / "Company Documents" / "company_policy.png"
        assert disk_path.is_file()

        raw_bytes, mime, file_name = client.download_file(res["file_id"])
        assert mime == "image/png"
        assert file_name == "company_policy.png"

    def test_invoice_upload_both_locations(self, tmp_path):
        client = LocalStorageClient(base_path=str(tmp_path))
        docx_bytes = b"PK\x03\x04 fake docx bytes"

        res = client.upload_invoice_file(
            payment_year=2026,
            payment_month=8,
            file_name="INV-2026-08-101.docx",
            file_bytes=docx_bytes,
            employee_id=101,
            employee_name="Jane Doe",
        )
        assert res["file_id"] == "Invoices/2026/2026-08/INV-2026-08-101.docx"

        # Verify primary archive
        primary_path = tmp_path / "Invoices" / "2026" / "2026-08" / "INV-2026-08-101.docx"
        assert primary_path.is_file()
        assert primary_path.read_bytes() == docx_bytes

        # Verify employee copy
        emp_copy_path = tmp_path / "employees" / "101 - Jane Doe" / "invoices" / "2026" / "INV-2026-08-101.docx"
        assert emp_copy_path.is_file()
        assert emp_copy_path.read_bytes() == docx_bytes

    def test_delete_file(self, tmp_path):
        client = LocalStorageClient(base_path=str(tmp_path))
        res = client.upload_file(102, "Bob Smith", "contract.pdf", _valid_pdf_data_url())
        assert client.delete_file(res["file_id"]) is True

        disk_path = tmp_path / "employees" / "102 - Bob Smith" / "contract.pdf"
        assert not disk_path.exists()

        # Deleting again returns False
        assert client.delete_file(res["file_id"]) is False

    def test_path_traversal_protection(self, tmp_path):
        client = LocalStorageClient(base_path=str(tmp_path))

        with pytest.raises(ValueError, match="Security error: Invalid path traversal attempt"):
            client.download_file("../../etc/passwd")

        with pytest.raises(ValueError, match="Security error: Invalid path traversal attempt"):
            client.download_file("..\\..\\windows\\system32\\cmd.exe")

    def test_download_missing_file_raises_error(self, tmp_path):
        client = LocalStorageClient(base_path=str(tmp_path))
        with pytest.raises(FileNotFoundError):
            client.download_file("employees/101 - Jane Doe/nonexistent.pdf")


class TestLocalStorageAPIIntegration:
    def test_employee_document_lifecycle_with_local_storage(self, app_client, admin_cookies, monkeypatch, tmp_path):
        import drive_client

        local_storage_dir = tmp_path / "app_local_storage"
        local_client = LocalStorageClient(base_path=str(local_storage_dir))

        monkeypatch.setattr(Config, "FILE_STORAGE_BACKEND", "local")
        monkeypatch.setattr(Config, "LOCAL_STORAGE_PATH", str(local_storage_dir))
        monkeypatch.setattr(storage, "get_storage_client", lambda: local_client)
        monkeypatch.setattr(drive_client, "get_drive_client", lambda: local_client)

        # 1. Upload employee document
        upload_resp = app_client.post(
            "/api/employees/2/documents",
            json={
                "name": "id_card.pdf",
                "file_type": "pdf",
                "data_url": _valid_pdf_data_url(),
            },
            cookies=admin_cookies,
        )
        assert upload_resp.status_code == 201
        doc_id = upload_resp.json()["id"]

        # 2. Verify file was saved to local disk
        expected_file = local_storage_dir / "employees" / "2 - Employee Two" / "id_card.pdf"
        assert expected_file.is_file()

        # 3. Stream document
        stream_resp = app_client.get(f"/api/employees/documents/{doc_id}/stream", cookies=admin_cookies)
        assert stream_resp.status_code == 200
        assert stream_resp.headers["content-type"] == "application/pdf"
        assert stream_resp.content == b"%PDF-1.4 minimal test pdf content"

        # 4. Stream document with download=true
        dl_resp = app_client.get(f"/api/employees/documents/{doc_id}/stream?download=true", cookies=admin_cookies)
        assert dl_resp.status_code == 200
        assert "attachment" in dl_resp.headers["content-disposition"]

        # 5. Delete document
        del_resp = app_client.delete(f"/api/employees/documents/{doc_id}", cookies=admin_cookies)
        assert del_resp.status_code == 200
        assert not expected_file.exists()

    def test_company_document_lifecycle_with_local_storage(self, app_client, admin_cookies, monkeypatch, tmp_path):
        import drive_client

        local_storage_dir = tmp_path / "company_local_storage"
        local_client = LocalStorageClient(base_path=str(local_storage_dir))

        monkeypatch.setattr(Config, "FILE_STORAGE_BACKEND", "local")
        monkeypatch.setattr(Config, "LOCAL_STORAGE_PATH", str(local_storage_dir))
        monkeypatch.setattr(storage, "get_storage_client", lambda: local_client)
        monkeypatch.setattr(drive_client, "get_drive_client", lambda: local_client)

        # 1. Upload company document
        upload_resp = app_client.post(
            "/api/company-documents",
            json={
                "name": "handbook.pdf",
                "file_type": "pdf",
                "category": "Policy",
                "data_url": _valid_pdf_data_url(),
            },
            cookies=admin_cookies,
        )
        assert upload_resp.status_code == 201
        doc_id = upload_resp.json()["id"]

        expected_file = local_storage_dir / "Company Documents" / "handbook.pdf"
        assert expected_file.is_file()

        # 2. Stream company document
        stream_resp = app_client.get(f"/api/company-documents/{doc_id}/stream", cookies=admin_cookies)
        assert stream_resp.status_code == 200
        assert stream_resp.content == b"%PDF-1.4 minimal test pdf content"

        # 3. Delete company document
        del_resp = app_client.delete(f"/api/company-documents/{doc_id}", cookies=admin_cookies)
        assert del_resp.status_code == 200
        assert not expected_file.exists()

