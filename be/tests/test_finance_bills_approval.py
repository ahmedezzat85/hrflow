"""
be/tests/test_finance_bills_approval.py
Slice B2 of Vendor Bill Workflow v2 (D-017): approval rules and bill permissions.

Verifies:
 - approval fields and status are refused (422) in create/update
 - a finance user's bill reaches Approved only through submit -> approve
 - a super admin's (approver's) bill is Approved on save and marked auto-approved
 - approve / pay need their own permissions (403 without them)
 - a non-super-admin cannot approve their own bill
 - a material edit by a user who cannot approve sends the bill back to Pending approval
 - every other route that pays a bill (manual transaction, cheque) needs finance.bill.pay
 - every action writes an activity entry
 - payment overpayment guard and atomic reversal still work
"""
import pytest

from bill_test_helpers import (
    payment_type_id,
    approve_existing,
    create_approved,
    create_draft,
    make_account,
    make_approver,
    make_maker,
    make_user,
    make_vendor,
    pay,
)

BASE = "/api/finance/bills"


# ── AC: any approval/server-owned field in a create/update request is refused ─
@pytest.mark.parametrize(
    "field,value",
    [
        ("status", "approved"),
        ("approval_status", "approved"),
        ("approved_by", "someone@hrflow.test"),
        ("approved_at", "2026-09-01T00:00:00"),
        ("approval_comment", "fine"),
        ("requires_approval", False),
        ("created_by", "someone@hrflow.test"),
        ("amount_paid", 100.0),
        ("is_reviewed", True),
        ("scheduled_payment_date", "2026-12-01"),
    ],
)
def test_server_owned_fields_refused_on_create_and_update(app_client, admin_cookies, field, value):
    vid = make_vendor(app_client, admin_cookies, f"Refuse {field}")
    base = {
        "vendor_id": vid,
        "bill_number": f"REF-{field}",
        "issue_date": "2026-09-01",
        "due_date": "2026-09-30",
        "lines": [],
    }
    assert app_client.post(BASE, json={**base, field: value}, cookies=admin_cookies).status_code == 422

    bill = app_client.post(BASE, json=base, cookies=admin_cookies).json()
    assert app_client.put(f"{BASE}/{bill['id']}", json={field: value}, cookies=admin_cookies).status_code == 422


# ── AC: finance user -> Approved only through approve; super admin auto-approved ─
def test_finance_user_bill_needs_approve_and_admin_bill_is_auto_approved(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "Maker Vendor")

    draft = create_draft(app_client, maker, vid, "MK-001", 2500.0)
    assert draft["status"] == "draft"
    assert draft["created_by"] == "maker@hrflow.test"
    assert draft["approval_status"] is None

    # the maker cannot approve their own bill (no permission) nor skip the queue
    assert app_client.post(f"{BASE}/{draft['id']}/submit", cookies=maker).json()["status"] == "pending_approval"
    denied = app_client.post(f"{BASE}/{draft['id']}/approve", json={"decision": "approve"}, cookies=maker)
    assert denied.status_code == 403

    approved = app_client.post(f"{BASE}/{draft['id']}/approve", json={"decision": "approve", "comment": "ok"}, cookies=admin_cookies)
    assert approved.status_code == 200
    body = approved.json()
    assert body["status"] == "approved"
    assert body["approval_status"] == "approved"
    assert body["approved_by"] == "admin@hrflow.test"

    # super admin's own bill: Approved on save, auto-approved
    auto = create_draft(app_client, admin_cookies, vid, "AUTO-001", 100.0)
    assert auto["status"] == "approved"
    assert auto["approval_status"] == "auto"
    assert auto["created_by"] == "admin@hrflow.test"


def test_approver_who_is_not_super_admin_gets_auto_approved_bills(app_client, admin_cookies):
    approver = make_approver()
    vid = make_vendor(app_client, admin_cookies, "Approver Vendor")
    bill = create_draft(app_client, approver, vid, "APR-001", 400.0)
    assert bill["status"] == "approved" and bill["approval_status"] == "auto"


# ── AC: a non-super-admin approver cannot approve their own bill ─────────────
def test_non_super_admin_cannot_approve_own_bill(app_client, admin_cookies):
    email = "grows@hrflow.test"
    writer = make_user(email, ["finance.bill.read", "finance.bill.write"])
    vid = make_vendor(app_client, admin_cookies, "Self Approve Vendor")
    bill = create_draft(app_client, writer, vid, "SELF-001", 900.0)
    assert bill["status"] == "draft"
    app_client.post(f"{BASE}/{bill['id']}/submit", cookies=writer)

    # the same user is later granted approve rights
    promoted = make_user(email, ["finance.bill.read", "finance.bill.write", "finance.bill.approve"])
    resp = app_client.post(f"{BASE}/{bill['id']}/approve", json={"decision": "approve"}, cookies=promoted)
    assert resp.status_code == 400
    assert "self-approval" in resp.json()["detail"].lower()
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["status"] == "pending_approval"


def test_approver_limit_and_reject_needs_reason(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "Limit Vendor")
    bill = create_draft(app_client, maker, vid, "LIM-001", 6000.0)
    app_client.post(f"{BASE}/{bill['id']}/submit", cookies=maker)

    over = app_client.post(
        f"{BASE}/{bill['id']}/approve", json={"decision": "approve", "approver_limit": 5000.0}, cookies=admin_cookies
    )
    assert over.status_code == 400 and "limit" in over.json()["detail"].lower()

    no_reason = app_client.post(f"{BASE}/{bill['id']}/approve", json={"decision": "reject", "comment": " "}, cookies=admin_cookies)
    assert no_reason.status_code == 400

    rej = app_client.post(
        f"{BASE}/{bill['id']}/approve", json={"decision": "reject", "comment": "Over departmental budget"}, cookies=admin_cookies
    )
    assert rej.status_code == 200
    assert rej.json()["status"] == "rejected"
    assert rej.json()["approval_comment"] == "Over departmental budget"

    # resubmitting a rejected bill uses submit
    assert app_client.post(f"{BASE}/{bill['id']}/submit", cookies=maker).json()["status"] == "pending_approval"


def test_withdraw_is_for_the_submitter(app_client, admin_cookies):
    maker = make_maker()
    other = make_maker("other-maker@hrflow.test")
    vid = make_vendor(app_client, admin_cookies, "Withdraw Vendor")
    bill = create_draft(app_client, maker, vid, "WD-001", 50.0)
    app_client.post(f"{BASE}/{bill['id']}/submit", cookies=maker)

    assert app_client.post(f"{BASE}/{bill['id']}/withdraw", cookies=other).status_code == 403
    wd = app_client.post(f"{BASE}/{bill['id']}/withdraw", cookies=maker)
    assert wd.status_code == 200 and wd.json()["status"] == "draft"


# ── AC: a material edit by a finance user returns an Approved bill to Pending ─
def test_material_edit_by_finance_user_returns_bill_to_pending_approval(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "Material Vendor")
    other_vid = make_vendor(app_client, admin_cookies, "Material Vendor Two")
    bill = create_draft(app_client, admin_cookies, vid, "MAT-001", 1000.0)
    assert bill["status"] == "approved"
    app_client.post(f"{BASE}/{bill['id']}/schedule", json={"scheduled_payment_date": "2026-12-01"}, cookies=admin_cookies)

    # notes, due date: not material
    soft = app_client.put(f"{BASE}/{bill['id']}", json={"notes": "just a note", "due_date": "2026-12-15"}, cookies=maker)
    assert soft.status_code == 200
    assert soft.json()["status"] == "scheduled"

    # amount (lines) change: material
    hard = app_client.put(
        f"{BASE}/{bill['id']}",
        json={"lines": [{"description": "Item", "quantity": 1, "unit_price": 1500.0, "line_total": 1500.0}]},
        cookies=maker,
    )
    assert hard.status_code == 200
    body = hard.json()
    assert body["status"] == "pending_approval"
    assert body["scheduled_payment_date"] is None
    assert body["approval_status"] == "pending"

    # a vendor change by an approver is not sent back
    second = create_draft(app_client, admin_cookies, vid, "MAT-002", 700.0)
    by_admin = app_client.put(f"{BASE}/{second['id']}", json={"vendor_id": other_vid}, cookies=admin_cookies)
    assert by_admin.status_code == 200 and by_admin.json()["status"] == "approved"

    # vendor change by the finance user is
    third = create_draft(app_client, admin_cookies, vid, "MAT-003", 710.0)
    by_maker = app_client.put(f"{BASE}/{third['id']}", json={"vendor_id": other_vid}, cookies=maker)
    assert by_maker.json()["status"] == "pending_approval"


# ── AC: pay without finance.bill.pay returns 403 ─────────────────────────────
def test_pay_requires_bill_pay_permission(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "Pay Perm Vendor")
    acct = make_account(app_client, admin_cookies, "Pay Perm Account", number="31415926")
    bill = create_approved(app_client, admin_cookies, vid, "PAYPERM-001", 300.0)

    assert pay(app_client, maker, bill["id"], acct, 100.0).status_code == 403
    reversal = app_client.post(
        f"{BASE}/{bill['id']}/payments/1/reverse", json={"reason": "no permission here"}, cookies=maker
    )
    assert reversal.status_code == 403
    # scheduling needs only write
    sch = app_client.post(f"{BASE}/{bill['id']}/schedule", json={"scheduled_payment_date": "2026-12-01"}, cookies=maker)
    assert sch.status_code == 200
    assert pay(app_client, admin_cookies, bill["id"], acct, 100.0).status_code == 201


def test_already_paid_create_needs_pay_and_approve_permissions(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "Already Paid Vendor")
    acct = make_account(app_client, admin_cookies, "Already Paid Account", number="27182818")
    payload = {
        "vendor_id": vid,
        "bill_number": "AP-PAID-001",
        "currency": "USD",
        "issue_date": "2026-09-01",
        "due_date": "2026-09-30",
        "lines": [{"description": "Thing", "quantity": 1, "unit_price": 200.0, "line_total": 200.0}],
        "is_paid_now": True,
        "payment": {"bank_account_id": acct, "payment_date": "2026-09-02", "amount": 200.0, "payment_type_id": payment_type_id("OUTBOUND_TRANS")},
    }
    assert app_client.post(BASE, json=payload, cookies=maker).status_code == 403
    ok = app_client.post(BASE, json={**payload, "bill_number": "AP-PAID-002"}, cookies=admin_cookies)
    assert ok.status_code == 201 and ok.json()["status"] == "paid"


def test_linked_manual_transaction_and_cheque_need_bill_pay(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "Linked Pay Vendor")
    acct = make_account(app_client, admin_cookies, "Linked Pay Account", number="16180339")
    bill = create_approved(app_client, admin_cookies, vid, "LINK-001", 500.0)

    tx = {"date": "2026-09-05", "amount": 100.0, "direction": "out", "currency": "USD", "reference": "T1",
          "description": "pay", "linked_bill_id": bill["id"], "payee_type": "vendor", "payee_id": vid}
    assert app_client.post(f"/api/finance/accounts/{acct}/transactions", json=tx, cookies=maker).status_code == 403

    chq = {"account_id": acct, "cheque_number": "770001", "issue_date": "2026-09-05", "amount": 100.0,
           "currency": "USD", "payee": "Linked Pay Vendor", "purpose_type": "vendor_payment", "linked_bill_id": bill["id"]}
    assert app_client.post("/api/finance/cheques", json=chq, cookies=maker).status_code == 403

    # nothing changed on the bill
    after = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert after["amount_paid"] == 0.0 and after["status"] == "approved"


def test_approve_without_permission_is_forbidden(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "No Approve Vendor")
    bill = create_draft(app_client, maker, vid, "NOAPP-001", 80.0)
    app_client.post(f"{BASE}/{bill['id']}/submit", cookies=maker)
    assert app_client.post(f"{BASE}/{bill['id']}/approve", json={"decision": "approve"}, cookies=maker).status_code == 403


# ── AC: every action writes an activity entry ────────────────────────────────
def test_every_action_writes_an_activity_entry(app_client, admin_cookies):
    maker = make_maker()
    vid = make_vendor(app_client, admin_cookies, "Activity Vendor")
    bill = create_draft(app_client, maker, vid, "ACT-001", 120.0)
    bid = bill["id"]
    app_client.post(f"{BASE}/{bid}/submit", cookies=maker)
    app_client.post(f"{BASE}/{bid}/approve", json={"decision": "reject", "comment": "Missing PO"}, cookies=admin_cookies)
    app_client.post(f"{BASE}/{bid}/submit", cookies=maker)
    app_client.post(f"{BASE}/{bid}/approve", json={"decision": "approve"}, cookies=admin_cookies)
    app_client.post(f"{BASE}/{bid}/schedule", json={"scheduled_payment_date": "2026-12-01"}, cookies=maker)
    app_client.delete(f"{BASE}/{bid}", params={"reason": "Duplicate"}, cookies=admin_cookies)

    timeline = app_client.get(f"/api/finance/activity/bill/{bid}", cookies=admin_cookies).json()["timeline"]
    audit = [e for e in timeline if e["id"].startswith("audit-")]
    events = [e["event"] for e in audit]
    for expected in ("bill.created", "bill.submit", "bill.reject", "bill.approve", "bill.schedule", "bill.void"):
        assert expected in events, (expected, events)
    reject = next(e for e in audit if e["event"] == "bill.reject")
    assert "pending_approval -> rejected" in reject["plain_text"] and "Missing PO" in reject["plain_text"]
    assert reject["actor"] == "admin@hrflow.test"
    void = next(e for e in audit if e["event"] == "bill.void")
    assert "Duplicate" in void["plain_text"]


# ── Payment guard and atomic reversal still hold ─────────────────────────────
def test_bill_partial_payment_overpayment_and_atomic_reversal(app_client, admin_cookies):
    account_id = make_account(app_client, admin_cookies, "Test AP Disbursement Account", number="12345678904491", balance=50000.0)
    vid = make_vendor(app_client, admin_cookies, "Datacenter Hosting Inc")
    bill = create_approved(app_client, admin_cookies, vid, "PAY-2026-001", 4000.0)
    bill_id = bill["id"]

    over_pay = pay(app_client, admin_cookies, bill_id, account_id, 4500.0, date="2026-09-10")
    assert over_pay.status_code == 400
    assert "exceeds remaining" in over_pay.json()["detail"].lower()

    pay1 = pay(app_client, admin_cookies, bill_id, account_id, 1500.0, date="2026-09-10", reference="WIRE-001")
    assert pay1.status_code == 201
    pay1_id = pay1.json()["id"]

    after_p1 = app_client.get(f"{BASE}/{bill_id}", cookies=admin_cookies).json()
    assert after_p1["status"] == "partially_paid"
    assert after_p1["amount_paid"] == 1500.0
    assert after_p1["remaining_balance"] == 2500.0
    assert app_client.get(f"/api/finance/accounts/{account_id}", cookies=admin_cookies).json()["current_balance"] == 48500.0

    assert pay(app_client, admin_cookies, bill_id, account_id, 2600.0, date="2026-09-12").status_code == 400

    rev = app_client.post(
        f"{BASE}/{bill_id}/payments/{pay1_id}/reverse",
        json={"reason": "Incorrect bank account selected for wire transfer"},
        cookies=admin_cookies,
    )
    assert rev.status_code == 200 and rev.json()["is_reversed"] is True
    assert app_client.get(f"/api/finance/accounts/{account_id}", cookies=admin_cookies).json()["current_balance"] == 50000.0
    restored = app_client.get(f"{BASE}/{bill_id}", cookies=admin_cookies).json()
    assert restored["status"] == "approved" and restored["amount_paid"] == 0.0 and restored["remaining_balance"] == 4000.0

    assert pay(app_client, admin_cookies, bill_id, account_id, 4000.0, date="2026-09-15", reference="WIRE-FULL").status_code == 201
    settled = app_client.get(f"{BASE}/{bill_id}", cookies=admin_cookies).json()
    assert settled["status"] == "paid" and settled["remaining_balance"] == 0.0


# ── Migration 0029 adds the two permissions and grants them to no role ──────
def test_migration_0029_adds_permissions_and_grants_none(tmp_path):
    import importlib.util
    import os

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations", "versions", "0029_bill_approve_pay_permissions.py")
    spec = importlib.util.spec_from_file_location("mig_0029", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'perm.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE permissions (id INTEGER PRIMARY KEY, key VARCHAR(100), description TEXT, created_at DATETIME)"))
        conn.execute(sa.text("CREATE TABLE role_permissions (role_id INTEGER, permission_id INTEGER, created_at DATETIME)"))
        conn.execute(sa.text("INSERT INTO permissions (id, key) VALUES (1, 'finance.bill.write')"))
        conn.execute(sa.text("INSERT INTO role_permissions (role_id, permission_id) VALUES (7, 1)"))

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
            mod.upgrade()  # idempotent
    with engine.connect() as conn:
        keys = {r[0] for r in conn.execute(sa.text("SELECT key FROM permissions"))}
        assert {"finance.bill.approve", "finance.bill.pay", "finance.bill.write"} <= keys
        granted = conn.execute(sa.text("SELECT COUNT(*) FROM role_permissions WHERE permission_id != 1")).scalar()
        assert granted == 0

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
    with engine.connect() as conn:
        keys = {r[0] for r in conn.execute(sa.text("SELECT key FROM permissions"))}
        assert keys == {"finance.bill.write"}
