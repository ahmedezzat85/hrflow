"""
Security regression tests (audit finding C-1): a bill's attachment reference can never
point outside the files root, so the attachment GET/DELETE cannot read or remove
arbitrary server files.
"""
import io
import os
import sys

import pytest

import file_layout
from db import get_db_context
from finance.models import BillDB

SECRET_CONTENT = b"TOP-SECRET-SERVER-FILE"


def _vendor(app_client, cookies):
    r = app_client.post("/api/finance/vendors", json={"name": "Sec Vendor", "category": "Legal & Professional"}, cookies=cookies)
    assert r.status_code == 201
    return r.json()["id"]


def _bill_payload(vendor_id, **extra):
    body = {
        "vendor_id": vendor_id, "bill_number": "BILL-SEC-1", "category": "Legal & Professional",
        "issue_date": "2026-09-10", "due_date": "2026-10-10", "currency": "USD",
        "lines": [{"description": "x", "quantity": 1.0, "unit_price": 10.0, "line_total": 10.0}],
    }
    body.update(extra)
    return body


def _stored_ref(bill_id):
    with get_db_context() as db:
        return db.query(BillDB).filter(BillDB.id == bill_id).one().attachment_url


def test_client_cannot_set_attachment_url_on_create_or_update(app_client, admin_cookies, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_bytes(SECRET_CONTENT)
    vendor_id = _vendor(app_client, admin_cookies)
    for n, evil in enumerate(("/etc/passwd", r"C:\Windows\win.ini", str(secret))):
        r = app_client.post("/api/finance/bills", json=_bill_payload(vendor_id, bill_number=f"BILL-SEC-{n}", issue_date=f"2026-09-1{n}", attachment_url=evil), cookies=admin_cookies)
        assert r.status_code == 201
        bill_id = r.json()["id"]
        assert _stored_ref(bill_id) in (None, "")
        assert app_client.get(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies).status_code == 404

        r = app_client.put(f"/api/finance/bills/{bill_id}", json={"attachment_url": evil}, cookies=admin_cookies)
        assert r.status_code in (200, 422)
        assert _stored_ref(bill_id) in (None, "")
        assert app_client.get(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies).status_code == 404
        app_client.delete(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
        assert secret.exists()


def test_stored_outside_ref_cannot_be_read_or_deleted(app_client, admin_cookies, tmp_path):
    """Even a poisoned row already in the database is neither streamed nor removed."""
    secret = tmp_path / "secret.txt"
    secret.write_bytes(SECRET_CONTENT)
    vendor_id = _vendor(app_client, admin_cookies)
    bill_id = app_client.post("/api/finance/bills", json=_bill_payload(vendor_id), cookies=admin_cookies).json()["id"]
    with get_db_context() as db:
        bill = db.query(BillDB).filter(BillDB.id == bill_id).one()
        bill.attachment_url = str(secret)
        bill.attachment_name = "x.txt"
        db.commit()
    r = app_client.get(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
    assert r.status_code == 404
    assert SECRET_CONTENT not in r.content
    app_client.delete(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
    assert secret.exists()


def test_legitimate_attachment_still_downloads_and_deletes(app_client, admin_cookies):
    vendor_id = _vendor(app_client, admin_cookies)
    bill_id = app_client.post("/api/finance/bills", json=_bill_payload(vendor_id), cookies=admin_cookies).json()["id"]
    content = b"%PDF-1.4 legit"
    up = app_client.post(
        f"/api/finance/bills/{bill_id}/attachment",
        files={"file": ("inv.pdf", io.BytesIO(content), "application/pdf")}, cookies=admin_cookies,
    )
    assert up.status_code == 200
    got = app_client.get(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
    assert got.status_code == 200 and got.content == content
    path = file_layout.resolve_path(_stored_ref(bill_id), must_exist=True)
    assert app_client.delete(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies).status_code == 200
    assert not os.path.exists(path)


def test_resolve_path_refuses_absolute_outside_root(tmp_path, monkeypatch):
    root = tmp_path / "files"
    root.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"x")
    for ref in (str(outside), "/etc/passwd", "/proc/self/environ", r"C:\Windows\win.ini", str(tmp_path / "nope.txt")):
        with pytest.raises((ValueError, FileNotFoundError)):
            file_layout.resolve_path(ref, root=str(root), must_exist=True)
    assert file_layout.delete_file(str(outside), root=str(root)) is False
    assert outside.exists()


def test_resolve_path_allows_inside_root_absolute_and_relative(tmp_path):
    root = tmp_path / "files"
    (root / "hr").mkdir(parents=True)
    f = root / "hr" / "a.pdf"
    f.write_bytes(b"x")
    assert file_layout.resolve_path(str(f), root=str(root), must_exist=True) == str(f)
    assert file_layout.resolve_path("hr/a.pdf", root=str(root), must_exist=True) == str(f)


def test_resolve_path_allows_legacy_env_dir(tmp_path, monkeypatch):
    root = tmp_path / "files"
    root.mkdir()
    legacy = tmp_path / "legacy_uploads"
    legacy.mkdir()
    f = legacy / "old.pdf"
    f.write_bytes(b"x")
    monkeypatch.setenv("BILL_UPLOADS_DIR", str(legacy))
    assert file_layout.resolve_path(str(f), root=str(root), must_exist=True) == str(f)


def test_resolve_path_refuses_symlink_escape(tmp_path):
    root = tmp_path / "files"
    root.mkdir()
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    (outside_dir / "s.txt").write_bytes(b"x")
    try:
        os.symlink(outside_dir, root / "link", target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not permitted on this platform")
    with pytest.raises(ValueError):
        file_layout.resolve_path("link/s.txt", root=str(root), must_exist=True)
    with pytest.raises(ValueError):
        file_layout.resolve_path(str(root / "link" / "s.txt"), root=str(root), must_exist=True)
