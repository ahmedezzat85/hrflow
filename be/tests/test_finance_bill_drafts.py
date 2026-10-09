"""
be/tests/test_finance_bill_drafts.py
Slice B4 of Vendor Bill Workflow v2 (D-019): drafts and PDF / multi-file upload.

 - A draft saves with only a vendor, or only an attachment.
 - Leaving Draft runs the full checks, refused field by field.
 - Several PDFs or photos at once: each file is its own Draft with its own vendor match;
   a weak match leaves the vendor empty and flags "vendor to confirm"; vendors are never auto-created.
 - Discarding a draft removes the row and the file; DELETE on any other bill is refused with 409.
"""
import importlib.util
import io
import os

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from bill_test_helpers import create_approved, make_maker, make_vendor

BASE = "/api/finance/bills"
BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _pdf(vendor: str, number: str, total: float, issue="2026-04-10", due="2026-05-10") -> bytes:
    return (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n"
        b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        b"5 0 obj << /Length 300 >> stream\nBT\n/F1 12 Tf\n72 700 Td\n"
        + f"(Vendor: {vendor}) Tj\n0 -20 Td\n(Invoice Number: {number}) Tj\n0 -20 Td\n(Date: {issue}) Tj\n0 -20 Td\n".encode()
        + f"(Due Date: {due}) Tj\n0 -20 Td\n(Hosting 1 {total:.2f} {total:.2f}) Tj\n0 -20 Td\n(Total: {total:.2f} USD) Tj\nET\n".encode()
        + b"endstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n"
        + b"0000000115 00000 n \n0000000224 00000 n \n0000000293 00000 n \n"
        + b"trailer << /Size 6 /Root 1 0 R >>\nstartxref\n546\n%%EOF"
    )


def _upload(client, cookies, files):
    return client.post(
        f"{BASE}/upload",
        files=[("files", (name, io.BytesIO(content), mime)) for name, content, mime in files],
        cookies=cookies,
    )


# ── AC: a draft saves with only a vendor, or only an attachment ──────────────
def test_draft_saves_with_only_a_vendor_or_only_an_attachment(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "Draft Only Vendor")

    only_vendor = app_client.post(BASE, json={"vendor_id": vid}, cookies=maker)
    assert only_vendor.status_code == 201, only_vendor.text
    body = only_vendor.json()
    assert body["status"] == "draft"
    assert body["bill_number"] is None and body["issue_date"] is None and body["due_date"] is None

    only_attachment = app_client.post(
        BASE, json={"attachment_name": "scan.pdf", "file_fingerprint": "abc123"}, cookies=maker
    )
    assert only_attachment.status_code == 201
    assert only_attachment.json()["vendor_id"] is None

    neither = app_client.post(BASE, json={"notes": "nothing useful"}, cookies=maker)
    assert neither.status_code == 422
    assert neither.json()["detail"][0]["loc"][-1] == "vendor_id"

    # a draft with a bad vendor id is still refused
    assert app_client.post(BASE, json={"vendor_id": 999999}, cookies=maker).status_code == 400


# ── AC: leaving Draft with a missing required field is refused field by field ─
def test_leaving_draft_is_refused_field_by_field(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "Leave Draft Vendor")
    draft = app_client.post(BASE, json={"vendor_id": vid}, cookies=maker).json()

    refused = app_client.post(f"{BASE}/{draft['id']}/submit", cookies=maker)
    assert refused.status_code == 422
    fields = {e["loc"][-1] for e in refused.json()["detail"]}
    assert fields == {"bill_number", "issue_date", "due_date"}
    assert app_client.get(f"{BASE}/{draft['id']}", cookies=maker).json()["status"] == "draft"

    app_client.put(f"{BASE}/{draft['id']}", json={"bill_number": "LD-001"}, cookies=maker)
    refused2 = app_client.post(f"{BASE}/{draft['id']}/submit", cookies=maker)
    assert {e["loc"][-1] for e in refused2.json()["detail"]} == {"issue_date", "due_date"}

    ok_update = app_client.put(f"{BASE}/{draft['id']}", json={"issue_date": "2026-09-01", "due_date": "2026-09-30"}, cookies=maker)
    assert ok_update.status_code == 200
    submitted = app_client.post(f"{BASE}/{draft['id']}/submit", cookies=maker)
    assert submitted.status_code == 200 and submitted.json()["status"] == "pending_approval"

    # an approver's incomplete bill cannot be born Approved either
    incomplete = app_client.post(BASE, json={"vendor_id": vid}, cookies=admin_cookies)
    assert incomplete.status_code == 422
    assert {e["loc"][-1] for e in incomplete.json()["detail"]} >= {"bill_number", "issue_date", "due_date"}


def test_leaving_draft_checks_inactive_vendor_and_duplicates(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "Dup Check Vendor")
    create_approved(app_client, admin_cookies, vid, "DUP-ORIG", 321.0, issue_date="2026-08-15")

    draft = app_client.post(
        BASE,
        json={"vendor_id": vid, "bill_number": "DUP-ORIG", "issue_date": "2026-08-16", "due_date": "2026-09-16"},
        cookies=maker,
    ).json()
    assert draft["status"] == "draft"  # a draft may hold anything; the checks run on leaving
    reused = app_client.post(f"{BASE}/{draft['id']}/submit", cookies=maker)
    assert reused.status_code == 400 and "already in use" in reused.json()["detail"]

    other = app_client.post(
        BASE,
        json={"vendor_id": vid, "bill_number": "DUP-NEW", "issue_date": "2026-08-17", "due_date": "2026-09-16"},
        cookies=maker,
    ).json()
    inactive = app_client.patch(f"/api/finance/vendors/{vid}", json={"is_active": False}, cookies=admin_cookies)
    if inactive.status_code == 200:
        blocked = app_client.post(f"{BASE}/{other['id']}/submit", cookies=maker)
        assert blocked.status_code == 400 and "inactive" in blocked.json()["detail"]


# ── AC: five PDFs from three vendors yield five Drafts ───────────────────────
def test_multi_file_upload_creates_one_draft_per_file(app_client, admin_cookies):
    from db import get_db_context
    from finance.models import VendorDB

    a = make_vendor(app_client, admin_cookies, "Zenith Cloud Hosting")
    b = make_vendor(app_client, admin_cookies, "Borealis Office Supplies")
    with get_db_context() as db:
        vendors_before = db.query(VendorDB).count()

    files = [
        ("zenith_1.pdf", _pdf("Zenith Cloud Hosting", "ZEN-001", 100.0), "application/pdf"),
        ("zenith_2.pdf", _pdf("Zenith Cloud Hosting", "ZEN-002", 200.0), "application/pdf"),
        ("borealis_1.pdf", _pdf("Borealis Office Supplies", "BOR-001", 300.0), "application/pdf"),
        ("borealis_2.pdf", _pdf("Borealis Office Supplies", "BOR-002", 400.0), "application/pdf"),
        ("newco.pdf", _pdf("Quasar Unknown Partners", "QUA-001", 500.0), "application/pdf"),
    ]
    resp = _upload(app_client, admin_cookies, files)
    assert resp.status_code == 200, resp.text
    results = resp.json()["results"]
    assert len(results) == 5 and all(r["bill"] for r in results)
    bills = {r["filename"]: r["bill"] for r in results}

    # every file is its own Draft, even for an approver (uploads never auto-approve)
    assert all(b_["status"] == "draft" for b_ in bills.values())
    assert len({b_["id"] for b_ in bills.values()}) == 5
    assert bills["zenith_1.pdf"]["vendor_id"] == a and bills["zenith_2.pdf"]["vendor_id"] == a
    assert bills["borealis_1.pdf"]["vendor_id"] == b and bills["borealis_2.pdf"]["vendor_id"] == b
    assert bills["zenith_1.pdf"]["vendor_to_confirm"] is False
    assert bills["zenith_1.pdf"]["bill_number"] == "ZEN-001"
    assert bills["zenith_1.pdf"]["total"] == 100.0
    assert bills["zenith_1.pdf"]["attachment_name"] == "zenith_1.pdf"

    # weak match: no vendor, flagged, the name read from the document is only suggested
    unknown = bills["newco.pdf"]
    assert unknown["vendor_id"] is None and unknown["vendor_to_confirm"] is True
    assert "Quasar" in (unknown["suggested_vendor_name"] or "")
    with get_db_context() as db:
        assert db.query(VendorDB).count() == vendors_before  # never auto-created

    # confirming a vendor clears the flag
    confirm = app_client.put(f"{BASE}/{unknown['id']}", json={"vendor_id": a}, cookies=admin_cookies)
    assert confirm.status_code == 200
    assert confirm.json()["vendor_to_confirm"] is False and confirm.json()["suggested_vendor_name"] is None

    # the list can open filtered to the new drafts
    drafts = app_client.get(BASE, params={"queue": "draft"}, cookies=admin_cookies).json()
    assert {x["id"] for x in drafts} >= {b_["id"] for b_ in bills.values()}


def test_upload_handles_photos_duplicates_and_bad_files(app_client, admin_cookies):
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    first = _upload(app_client, admin_cookies, [("receipt.png", png, "image/png")])
    result = first.json()["results"][0]
    assert result["bill"]["status"] == "draft"
    assert result["bill"]["vendor_id"] is None and result["bill"]["vendor_to_confirm"] is True
    assert result["bill"]["attachment_name"] == "receipt.png"

    again = _upload(
        app_client,
        admin_cookies,
        [("receipt_again.png", png, "image/png"), ("notes.txt", b"hello", "text/plain"), ("empty.pdf", b"", "application/pdf")],
    ).json()["results"]
    assert again[0]["bill"] is None and again[0]["duplicate_of"] == result["bill"]["id"]
    assert again[1]["bill"] is None and "Unsupported" in again[1]["error"]
    assert again[2]["bill"] is None and "empty" in again[2]["error"].lower()


def test_upload_needs_bill_write_permission(app_client, employee_cookies):
    resp = _upload(app_client, employee_cookies, [("x.png", b"\x89PNG0000", "image/png")])
    assert resp.status_code == 403


# ── AC: discarding a draft removes row and file; DELETE on any other bill is refused
def test_discard_draft_removes_row_and_file_and_other_bills_are_refused(app_client, admin_cookies):
    from db import get_db_context
    from finance.models import BillDB

    maker = make_maker()
    uploaded = _upload(app_client, admin_cookies, [("discard_me.png", b"\x89PNG\r\n" + b"1" * 40, "image/png")]).json()["results"][0]["bill"]
    with get_db_context() as db:
        path = db.query(BillDB).filter(BillDB.id == uploaded["id"]).one().attachment_url
    assert os.path.isfile(path)

    gone = app_client.delete(f"{BASE}/{uploaded['id']}", cookies=admin_cookies)
    assert gone.status_code == 204
    assert app_client.get(f"{BASE}/{uploaded['id']}", cookies=admin_cookies).status_code == 404
    assert not os.path.exists(path)
    with get_db_context() as db:
        assert db.query(BillDB).filter(BillDB.id == uploaded["id"]).count() == 0

    # one activity line is written
    from repositories.sql.audit import SqlAuditRepository
    entries = [e for e in SqlAuditRepository().list_all() if e["action"] == "bill.discarded" and e["target_id"] == str(uploaded["id"])]
    assert len(entries) == 1 and entries[0]["actor_email"] == "admin@hrflow.test"

    # every other status is kept: DELETE returns 409, cancelling is POST /void
    vid = make_vendor(app_client, admin_cookies, "Discard Vendor")
    approved = create_approved(app_client, admin_cookies, vid, "DISC-001", 50.0)
    refused = app_client.delete(f"{BASE}/{approved['id']}", cookies=admin_cookies)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "delete_not_allowed"
    pending = app_client.post(BASE, json={"vendor_id": vid, "bill_number": "DISC-002", "issue_date": "2026-08-01", "due_date": "2026-09-01"}, cookies=maker).json()
    app_client.post(f"{BASE}/{pending['id']}/submit", cookies=maker)
    assert app_client.delete(f"{BASE}/{pending['id']}", cookies=admin_cookies).status_code == 409
    assert app_client.get(f"{BASE}/{approved['id']}", cookies=admin_cookies).status_code == 200
    voided = app_client.post(f"{BASE}/{approved['id']}/void", json={"reason": "Entered by mistake"}, cookies=admin_cookies)
    assert voided.status_code == 200 and voided.json()["status"] == "void"
    assert app_client.delete(f"{BASE}/{approved['id']}", cookies=admin_cookies).status_code == 409


# ── Migration 0030: nullable draft columns, up and down ──────────────────────
def _load_migration():
    path = os.path.join(BE_DIR, "migrations", "versions", "0030_bill_draft_fields.py")
    spec = importlib.util.spec_from_file_location("mig_0030", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_0030_makes_draft_fields_nullable_and_back(tmp_path):
    mod = _load_migration()
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'drafts.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text(
            "CREATE TABLE finance_bills (id INTEGER PRIMARY KEY, vendor_id INTEGER NOT NULL, bill_number VARCHAR(50) NOT NULL, "
            "issue_date VARCHAR(20) NOT NULL, due_date VARCHAR(20) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'draft')"
        ))
        conn.execute(sa.text("CREATE TABLE finance_bill_lines (id INTEGER PRIMARY KEY, bill_id INTEGER)"))
        conn.execute(sa.text("INSERT INTO finance_bills (id, vendor_id, bill_number, issue_date, due_date) VALUES (1, 7, 'B-1', '2026-09-01', '2026-09-30')"))

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
    insp = sa.inspect(engine)
    cols = {c["name"]: c for c in insp.get_columns("finance_bills")}
    for name in ("vendor_id", "bill_number", "issue_date", "due_date"):
        assert cols[name]["nullable"] is True
    assert "vendor_to_confirm" in cols and "suggested_vendor_name" in cols

    with engine.begin() as conn:
        conn.execute(sa.text("INSERT INTO finance_bills (id, vendor_id, bill_number) VALUES (2, NULL, NULL)"))
        conn.execute(sa.text("INSERT INTO finance_bills (id, vendor_id, bill_number) VALUES (3, 7, NULL)"))
        conn.execute(sa.text("INSERT INTO finance_bill_lines (id, bill_id) VALUES (1, 2)"))

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
    with engine.connect() as conn:
        rows = {r[0]: r for r in conn.execute(sa.text("SELECT id, vendor_id, bill_number, issue_date FROM finance_bills"))}
        assert 2 not in rows  # a draft without a vendor cannot exist in the old schema
        assert rows[1][2] == "B-1"
        assert rows[3][2] == "DRAFT-3" and rows[3][3] == "1970-01-01"
        assert conn.execute(sa.text("SELECT COUNT(*) FROM finance_bill_lines")).scalar() == 0
    cols = {c["name"]: c for c in sa.inspect(engine).get_columns("finance_bills")}
    assert cols["vendor_id"]["nullable"] is False and "vendor_to_confirm" not in cols


# ── B5: Save as draft for a user who could approve ───────────────────────────
def test_save_as_draft_keeps_an_approvers_bill_a_draft(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Save As Draft Vendor")
    resp = app_client.post(
        BASE,
        json={"vendor_id": vid, "save_as_draft": True, "bill_number": "SAD-001"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "draft" and body["approval_status"] is None and body["created_by"] == "admin@hrflow.test"

    both = app_client.post(
        BASE,
        json={"vendor_id": vid, "save_as_draft": True, "is_paid_now": True,
              "payment": {"bank_account_id": 1, "payment_type_id": 1, "payment_date": "2026-09-01"}},
        cookies=admin_cookies,
    )
    assert both.status_code == 400
