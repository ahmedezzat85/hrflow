"""
be/tests/test_finance_cheque_attachments.py
X1 (D-032): cheque scans, has_scan filter, attachment_url migration, next cheque number.
"""
import importlib.util
import io
import os

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from bill_test_helpers import make_account

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "/api/finance/cheques"
_seq = {"n": 0}


def _issue(client, cookies, account_id, number, **extra):
    payload = {
        "account_id": account_id,
        "cheque_number": number,
        "issue_date": "2026-09-05",
        "amount": 100.0,
        "currency": "USD",
        "payee": "Scan Payee",
        "purpose_type": "other",
    }
    payload.update(extra)
    resp = client.post(BASE, json=payload, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _acct(client, cookies):
    _seq["n"] += 1
    return make_account(client, cookies, name=f"Scan Acct {_seq['n']}", number=f"SCAN{_seq['n']:04d}")


def _file(name="cheque.pdf", content=b"%PDF-1.4 cheque scan"):
    return ("files", (name, io.BytesIO(content), "application/pdf"))


def test_upload_list_download_delete_scan(app_client, admin_cookies, employee_cookies):
    acc = _acct(app_client, admin_cookies)
    chq = _issue(app_client, admin_cookies, acc, "S-001")
    assert chq["attachment_count"] == 0 and chq["has_scan"] is False
    cid = chq["id"]

    # unauthenticated / unauthorised
    assert app_client.post(f"{BASE}/{cid}/attachments", files=[_file()]).status_code == 401
    assert app_client.post(f"{BASE}/{cid}/attachments", files=[_file()], cookies=employee_cookies).status_code == 403
    assert app_client.get(f"{BASE}/{cid}/attachments", cookies=employee_cookies).status_code == 403

    # multi-file upload
    resp = app_client.post(
        f"{BASE}/{cid}/attachments",
        files=[_file("front.pdf", b"front-bytes"), _file("back.pdf", b"back-bytes")],
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    atts = resp.json()
    assert [a["file_name"] for a in atts] == ["front.pdf", "back.pdf"]
    assert "storage_ref" not in atts[0]  # storage path never exposed

    listed = app_client.get(f"{BASE}/{cid}/attachments", cookies=admin_cookies).json()
    assert len(listed) == 2

    dl = app_client.get(f"{BASE}/{cid}/attachments/{atts[0]['id']}/download", cookies=admin_cookies)
    assert dl.status_code == 200 and dl.content == b"front-bytes"
    assert app_client.get(f"{BASE}/{cid}/attachments/{atts[0]['id']}/download", cookies=employee_cookies).status_code == 403

    got = app_client.get(f"{BASE}/{cid}", cookies=admin_cookies).json()
    assert got["attachment_count"] == 2 and got["has_scan"] is True

    # attachment of another cheque is not reachable through this cheque
    other = _issue(app_client, admin_cookies, acc, "S-002")
    assert app_client.get(f"{BASE}/{other['id']}/attachments/{atts[0]['id']}/download", cookies=admin_cookies).status_code == 404

    # delete: employee denied, admin allowed
    assert app_client.delete(f"{BASE}/{cid}/attachments/{atts[0]['id']}", cookies=employee_cookies).status_code == 403
    assert app_client.delete(f"{BASE}/{cid}/attachments/{atts[0]['id']}", cookies=admin_cookies).status_code == 204
    assert app_client.delete(f"{BASE}/{cid}/attachments/{atts[0]['id']}", cookies=admin_cookies).status_code == 404
    assert app_client.get(f"{BASE}/{cid}", cookies=admin_cookies).json()["attachment_count"] == 1


def test_upload_rejects_empty_file_and_unknown_cheque(app_client, admin_cookies):
    acc = _acct(app_client, admin_cookies)
    chq = _issue(app_client, admin_cookies, acc, "S-010")
    resp = app_client.post(f"{BASE}/{chq['id']}/attachments", files=[_file("empty.pdf", b"")], cookies=admin_cookies)
    assert resp.status_code == 400
    assert app_client.get(f"{BASE}/{chq['id']}", cookies=admin_cookies).json()["attachment_count"] == 0
    assert app_client.post(f"{BASE}/999999/attachments", files=[_file()], cookies=admin_cookies).status_code == 404


def test_has_scan_filter(app_client, admin_cookies):
    acc = _acct(app_client, admin_cookies)
    with_scan = _issue(app_client, admin_cookies, acc, "S-020")
    without = _issue(app_client, admin_cookies, acc, "S-021")
    assert app_client.post(f"{BASE}/{with_scan['id']}/attachments", files=[_file()], cookies=admin_cookies).status_code == 201

    missing = app_client.get(f"{BASE}?account_id={acc}&has_scan=false", cookies=admin_cookies).json()
    assert [c["id"] for c in missing] == [without["id"]]
    present = app_client.get(f"{BASE}?account_id={acc}&has_scan=true", cookies=admin_cookies).json()
    assert [c["id"] for c in present] == [with_scan["id"]]
    assert len(app_client.get(f"{BASE}?account_id={acc}", cookies=admin_cookies).json()) == 2


def test_new_cheque_does_not_write_attachment_url(app_client, admin_cookies):
    acc = _acct(app_client, admin_cookies)
    chq = _issue(app_client, admin_cookies, acc, "S-030", attachment_url="legacy/ref.pdf")
    assert chq["attachment_url"] is None


def test_next_cheque_number(app_client, admin_cookies, employee_cookies):
    acc = _acct(app_client, admin_cookies)
    url = f"{BASE}/next-number?account_id={acc}"
    empty = app_client.get(url, cookies=admin_cookies).json()
    assert empty["next_cheque_number"] is None
    _issue(app_client, admin_cookies, acc, "000099")
    _issue(app_client, admin_cookies, acc, "A-777")  # non-numeric serials are ignored
    nxt = app_client.get(url, cookies=admin_cookies).json()
    assert nxt["last_cheque_number"] == "000099" and nxt["next_cheque_number"] == "000100"
    _issue(app_client, admin_cookies, acc, "999")
    assert app_client.get(url, cookies=admin_cookies).json()["next_cheque_number"] == "1000"  # padding never truncates
    assert app_client.get(url, cookies=employee_cookies).status_code == 403
    assert app_client.get(f"{BASE}/next-number?account_id=999999", cookies=admin_cookies).status_code == 404


def _migration():
    path = os.path.join(BE_DIR, "migrations", "versions", "0036_cheque_attachments.py")
    spec = importlib.util.spec_from_file_location("mig_0036", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_moves_attachment_url_to_attachment_rows(tmp_path):
    mod = _migration()
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'm.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE finance_cheques (id INTEGER PRIMARY KEY, attachment_url VARCHAR(500), created_by VARCHAR(255))"))
        conn.execute(sa.text(
            "CREATE TABLE finance_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, file_name VARCHAR(255) NOT NULL, "
            "file_size INTEGER NOT NULL DEFAULT 0, mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream', "
            "storage_ref VARCHAR(500) NOT NULL, uploaded_at DATETIME, uploaded_by VARCHAR(255))"
        ))
        conn.execute(sa.text("INSERT INTO finance_cheques VALUES (1, 'scans/chq-1.pdf', 'a@x.test'), (2, NULL, NULL), (3, '  ', NULL)"))

    for _ in range(2):  # idempotent
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                mod.upgrade()

    with engine.begin() as conn:
        rows = conn.execute(sa.text("SELECT cheque_id, file_name, storage_ref, uploaded_by FROM finance_attachments")).fetchall()
        assert rows == [(1, "chq-1.pdf", "scans/chq-1.pdf", "a@x.test")]
        # column preserved
        assert conn.execute(sa.text("SELECT attachment_url FROM finance_cheques WHERE id = 1")).scalar() == "scans/chq-1.pdf"

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
    assert "cheque_id" not in {c["name"] for c in sa.inspect(engine).get_columns("finance_attachments")}
