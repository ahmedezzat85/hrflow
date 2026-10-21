"""
be/tests/test_finance_uploads_dir.py
Production runs the app in a read-only container: /app/uploads cannot be created, which made every Bills request
fail with "Read-only file system: '/app/uploads'". Upload folders are now configurable (pointing into the data volume)
and a service must be constructible even when its folder cannot be created.
"""
import os

import pytest

from finance import storage_paths
from finance.storage_paths import ensure_dir, resolve_uploads_dir


def test_default_folder_is_unchanged_without_configuration(monkeypatch):
    monkeypatch.delenv("BILL_UPLOADS_DIR", raising=False)
    path = resolve_uploads_dir("BILL_UPLOADS_DIR", "finance_bills")
    assert path.replace("\\", "/").endswith("be/uploads/finance_bills")


def test_environment_variable_sets_the_folder(monkeypatch):
    monkeypatch.setenv("FINANCE_UPLOADS_DIR", "/data/documents/finance_attachments")
    assert resolve_uploads_dir("FINANCE_UPLOADS_DIR", "finance_attachments") == "/data/documents/finance_attachments"
    monkeypatch.setenv("FINANCE_UPLOADS_DIR", "   ")  # blank means not configured
    assert resolve_uploads_dir("FINANCE_UPLOADS_DIR", "finance_attachments").replace("\\", "/").endswith("uploads/finance_attachments")


def test_ensure_dir_creates_and_never_raises(tmp_path, monkeypatch):
    target = tmp_path / "a" / "b"
    assert ensure_dir(str(target)) is True and target.is_dir()

    def read_only(*_a, **_k):
        raise OSError(30, "Read-only file system", "/app/uploads")

    monkeypatch.setattr(storage_paths.os, "makedirs", read_only)
    assert ensure_dir("/app/uploads/finance_bills") is False


def test_services_can_be_built_when_the_upload_folder_is_not_writable(app_client, admin_cookies, monkeypatch):
    """The Bills list must work on a read-only container: it never writes a file."""
    def read_only(*_a, **_k):
        raise OSError(30, "Read-only file system", "/app/uploads")

    monkeypatch.setattr(storage_paths.os, "makedirs", read_only)
    for url in ("/api/finance/bills", "/api/finance/bills/queue-counts", "/api/finance/subscriptions",
                "/api/finance/statements", "/api/finance/cheques"):
        resp = app_client.get(url, cookies=admin_cookies)
        assert resp.status_code in (200, 404), (url, resp.status_code, resp.text[:200])
        assert resp.status_code != 500, url


def test_a_write_still_reports_the_real_error_when_the_folder_is_not_writable(app_client, admin_cookies, monkeypatch, tmp_path):
    """Uploading must fail loudly (not silently) if the folder really cannot be created."""
    from finance.services import bills_service

    blocker = tmp_path / "blocked"
    blocker.write_text("a file where the folder should be")
    monkeypatch.setattr(bills_service, "BILL_UPLOADS_DIR", str(blocker / "finance_bills"))
    with pytest.raises(OSError):
        bills_service.BillsService.write_file("x.pdf", b"%PDF")
