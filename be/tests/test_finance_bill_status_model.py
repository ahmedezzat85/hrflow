"""
be/tests/test_finance_bill_status_model.py
Slice B1 of Vendor Bill Workflow v2 (D-016): eight-status model, transition table,
status never accepted from the client, void guards, readers of the new status keys,
and the 0028_bill_status_model data migration.
"""
import importlib.util
import os
import re
from datetime import datetime, timedelta

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from bill_test_helpers import (
    make_maker,
    create_approved,
    create_draft,
    make_account,
    make_vendor,
    pay,
)
from finance import bill_status as bs

BASE = "/api/finance/bills"
BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _today(offset_days=0):
    return (datetime.utcnow().date() + timedelta(days=offset_days)).strftime("%Y-%m-%d")


# ── AC: status never accepted from the client (422) ──────────────────────────
def test_status_in_create_and_update_returns_422(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Status422 Vendor")
    resp = app_client.post(
        BASE,
        json={
            "vendor_id": vid,
            "bill_number": "S422-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "approved",
            "lines": [],
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 422

    bill = create_draft(app_client, make_maker(), vid, "S422-002")
    upd = app_client.put(f"{BASE}/{bill['id']}", json={"status": "paid"}, cookies=admin_cookies)
    assert upd.status_code == 422
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["status"] == "draft"


def test_new_bill_is_draft_and_follows_submit_approve(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Flow Vendor")
    bill = create_draft(app_client, make_maker(), vid, "FLOW-001")
    assert bill["status"] == "draft"

    sub = app_client.post(f"{BASE}/{bill['id']}/submit", cookies=admin_cookies)
    assert sub.status_code == 200 and sub.json()["status"] == "pending_approval"

    wd = app_client.post(f"{BASE}/{bill['id']}/withdraw", cookies=admin_cookies)
    assert wd.status_code == 200 and wd.json()["status"] == "draft"

    app_client.post(f"{BASE}/{bill['id']}/submit", cookies=admin_cookies)
    rej = app_client.post(
        f"{BASE}/{bill['id']}/approve", json={"decision": "reject", "comment": "Wrong vendor"}, cookies=admin_cookies
    )
    assert rej.status_code == 200 and rej.json()["status"] == "rejected"

    # Rejected -> resubmit -> approve
    assert app_client.post(f"{BASE}/{bill['id']}/submit", cookies=admin_cookies).json()["status"] == "pending_approval"
    appr = app_client.post(f"{BASE}/{bill['id']}/approve", json={"decision": "approve"}, cookies=admin_cookies)
    assert appr.json()["status"] == "approved"

    sch = app_client.post(
        f"{BASE}/{bill['id']}/schedule", json={"scheduled_payment_date": "2026-12-01"}, cookies=admin_cookies
    )
    assert sch.status_code == 200 and sch.json()["status"] == "scheduled"


# ── AC: an action not in the transition table is refused with 409 ────────────
def _post_action(client, cookies, action, bill_id):
    if action in ("approve", "reject"):
        return client.post(
            f"{BASE}/{bill_id}/approve",
            json={"decision": action, "comment": "needed for reject"},
            cookies=cookies,
        )
    if action == "schedule":
        return client.post(f"{BASE}/{bill_id}/schedule", json={"scheduled_payment_date": "2026-12-01"}, cookies=cookies)
    if action == "void":
        return client.delete(f"{BASE}/{bill_id}", cookies=cookies)
    return client.post(f"{BASE}/{bill_id}/{action}", cookies=cookies)


@pytest.mark.parametrize(
    "action,state",
    [
        ("approve", "draft"),
        ("reject", "draft"),
        ("schedule", "draft"),
        ("withdraw", "draft"),
        ("submit", "pending_approval"),
        ("schedule", "pending_approval"),
        ("withdraw", "approved"),
        ("submit", "approved"),
        ("approve", "approved"),
        ("schedule", "scheduled"),
        ("approve", "rejected"),
        ("withdraw", "rejected"),
        ("void", "void"),
        ("approve", "void"),
        ("void", "paid"),
        ("submit", "paid"),
        ("schedule", "paid"),
        ("void", "partially_paid"),
        ("approve", "partially_paid"),
    ],
)
def test_invalid_transition_returns_409_with_allowed_actions(app_client, admin_cookies, action, state):
    vid = make_vendor(app_client, admin_cookies, f"Trans {action} {state}")
    acct = make_account(app_client, admin_cookies, f"T-{action}-{state}", number=f"7{abs(hash((action, state))) % 10**7:07d}")
    number = f"TR-{action}-{state}"

    bill = create_draft(app_client, make_maker(), vid, number, 1000.0)
    bid = bill["id"]
    # Walk the bill into the requested state through real actions only.
    if state != "draft":
        app_client.post(f"{BASE}/{bid}/submit", cookies=admin_cookies)
    if state == "rejected":
        app_client.post(f"{BASE}/{bid}/approve", json={"decision": "reject", "comment": "no"}, cookies=admin_cookies)
    if state in ("approved", "scheduled", "paid", "partially_paid", "void"):
        app_client.post(f"{BASE}/{bid}/approve", json={"decision": "approve"}, cookies=admin_cookies)
    if state == "scheduled":
        app_client.post(f"{BASE}/{bid}/schedule", json={"scheduled_payment_date": "2026-12-01"}, cookies=admin_cookies)
    if state == "paid":
        assert pay(app_client, admin_cookies, bid, acct, 1000.0).status_code == 201
    if state == "partially_paid":
        assert pay(app_client, admin_cookies, bid, acct, 400.0).status_code == 201
    if state == "void":
        assert app_client.delete(f"{BASE}/{bid}", cookies=admin_cookies).status_code == 200

    before = app_client.get(f"{BASE}/{bid}", cookies=admin_cookies).json()["status"]
    assert before == state

    resp = _post_action(app_client, admin_cookies, action, bid)
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert detail["current_status"] == state
    assert detail["action"] == action or action in ("reject", "void")
    assert isinstance(detail["allowed_actions"], list)
    assert app_client.get(f"{BASE}/{bid}", cookies=admin_cookies).json()["status"] == state


def test_payment_on_non_payable_bill_returns_409(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Pay409 Vendor")
    acct = make_account(app_client, admin_cookies, "Pay409 Account", number="55443322")
    draft = create_draft(app_client, make_maker(), vid, "PAY409-001")
    resp = pay(app_client, admin_cookies, draft["id"], acct, 100.0)
    assert resp.status_code == 409
    assert resp.json()["detail"]["current_status"] == "draft"


# ── AC: partially paid bill cannot be voided ─────────────────────────────────
def test_partially_paid_bill_cannot_be_voided(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "NoVoid Vendor")
    acct = make_account(app_client, admin_cookies, "NoVoid Account", number="66554433")
    bill = create_approved(app_client, admin_cookies, vid, "NOVOID-001", 1000.0)
    assert pay(app_client, admin_cookies, bill["id"], acct, 300.0).status_code == 201

    resp = app_client.delete(f"{BASE}/{bill['id']}", params={"reason": "Entered by mistake"}, cookies=admin_cookies)
    assert resp.status_code == 409
    after = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert after["status"] == "partially_paid"
    assert after["void_reason"] is None


def test_void_refused_while_unreversed_payment_exists_on_legacy_row(app_client, admin_cookies):
    """An Approved row carrying an unreversed payment (legacy data) still cannot be voided."""
    from db import get_db_context
    from finance.models import PaymentDB

    vid = make_vendor(app_client, admin_cookies, "Legacy Pay Vendor")
    acct = make_account(app_client, admin_cookies, "Legacy Pay Account", number="22113344")
    bill = create_approved(app_client, admin_cookies, vid, "LEGACY-001", 500.0)
    with get_db_context() as db:
        db.add(
            PaymentDB(
                direction="outgoing",
                related_bill_id=bill["id"],
                amount=100.0,
                currency="USD",
                payment_date="2026-09-10",
                bank_account_id=acct,
                method="bank_transfer",
                reference="LEG",
                is_reversed=False,
            )
        )
        db.commit()

    resp = app_client.delete(f"{BASE}/{bill['id']}", cookies=admin_cookies)
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "has_unreversed_payments"


def test_void_after_payment_reversal_and_reason_columns(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Void Reason Vendor")
    acct = make_account(app_client, admin_cookies, "Void Reason Account", number="88776655")
    bill = create_approved(app_client, admin_cookies, vid, "VOIDR-001", 800.0, notes="original note")
    pay_resp = pay(app_client, admin_cookies, bill["id"], acct, 800.0)
    assert pay_resp.status_code == 201
    pid = pay_resp.json()["id"]
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["status"] == "paid"

    rev = app_client.post(
        f"{BASE}/{bill['id']}/payments/{pid}/reverse", json={"reason": "Wrong account"}, cookies=admin_cookies
    )
    assert rev.status_code == 200
    reverted = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert reverted["status"] == "approved"
    assert reverted["amount_paid"] == 0.0

    voided = app_client.delete(f"{BASE}/{bill['id']}", params={"reason": "Duplicate"}, cookies=admin_cookies)
    assert voided.status_code == 200
    body = voided.json()
    assert body["status"] == "void"
    assert body["void_reason"] == "Duplicate"
    assert body["voided_by"] == "admin@hrflow.test"
    assert body["voided_at"]
    assert body["notes"] == "original note"  # reason no longer appended to notes


def test_void_action_endpoint_with_reason(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Void Endpoint Vendor")
    bill = create_draft(app_client, make_maker(), vid, "VOIDEP-001")
    resp = app_client.post(f"{BASE}/{bill['id']}/void", json={"reason": "Cancelled by vendor"}, cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json()["void_reason"] == "Cancelled by vendor"


# ── Reversal and payments derive Approved / Scheduled / Partially paid / Paid ─
def test_payment_status_is_derived_from_payments(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Derive Vendor")
    acct = make_account(app_client, admin_cookies, "Derive Account", number="44556677")
    bill = create_approved(app_client, admin_cookies, vid, "DERIVE-001", 1000.0)
    app_client.post(f"{BASE}/{bill['id']}/schedule", json={"scheduled_payment_date": "2026-12-01"}, cookies=admin_cookies)

    p1 = pay(app_client, admin_cookies, bill["id"], acct, 400.0)
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["status"] == "partially_paid"
    p2 = pay(app_client, admin_cookies, bill["id"], acct, 600.0)
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["status"] == "paid"

    app_client.post(f"{BASE}/{bill['id']}/payments/{p2.json()['id']}/reverse", json={"reason": "bounced"}, cookies=admin_cookies)
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["status"] == "partially_paid"
    app_client.post(f"{BASE}/{bill['id']}/payments/{p1.json()['id']}/reverse", json={"reason": "bounced"}, cookies=admin_cookies)
    # No payments left and a schedule date exists -> Scheduled
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["status"] == "scheduled"


# ── is_overdue flag, queue counts and filters ────────────────────────────────
def test_is_overdue_flag_only_for_open_statuses(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Overdue Vendor")
    past = _today(-20)
    draft = create_draft(app_client, make_maker(), vid, "OD-DRAFT", 100.0, due_date=past)
    approved = create_approved(app_client, admin_cookies, vid, "OD-APPR", 100.0, due_date=past)
    future = create_approved(app_client, admin_cookies, vid, "OD-FUT", 100.0, due_date=_today(20))

    assert draft["is_overdue"] is False
    assert approved["is_overdue"] is True
    assert future["is_overdue"] is False

    listed = app_client.get(BASE, params={"overdue": "true", "vendor_id": vid}, cookies=admin_cookies).json()
    assert [b["bill_number"] for b in listed] == ["OD-APPR"]

    counts = app_client.get(f"{BASE}/queue-counts", params={"vendor_id": vid}, cookies=admin_cookies).json()
    assert counts["draft"] == 1
    assert counts["approved"] == 2
    assert counts["overdue"] == 1
    assert counts["all"] == 3
    for key in ("pending_approval", "rejected", "scheduled", "partially_paid", "paid", "void"):
        assert key in counts


def test_queue_filter_and_status_validation(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Queue Vendor")
    create_draft(app_client, make_maker(), vid, "Q-DRAFT")
    create_approved(app_client, admin_cookies, vid, "Q-APPR")
    drafts = app_client.get(BASE, params={"queue": "draft", "vendor_id": vid}, cookies=admin_cookies).json()
    assert [b["bill_number"] for b in drafts] == ["Q-DRAFT"]
    by_status = app_client.get(BASE, params={"status": "approved", "vendor_id": vid}, cookies=admin_cookies).json()
    assert [b["bill_number"] for b in by_status] == ["Q-APPR"]
    for legacy in ("unpaid", "overdue", "inbox", "ready_to_pay"):
        assert app_client.get(BASE, params={"status": legacy}, cookies=admin_cookies).status_code == 400


# ── AC: Draft / Pending / Rejected excluded from AP aging, forecast, vendor open totals
def test_non_owed_statuses_excluded_from_aging_forecast_vendor_totals(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Owed Vendor")
    due = _today(5)
    create_draft(app_client, make_maker(), vid, "OWED-DRAFT", 111.0, due_date=due)
    pend = create_draft(app_client, make_maker(), vid, "OWED-PEND", 222.0, due_date=due)
    app_client.post(f"{BASE}/{pend['id']}/submit", cookies=admin_cookies)
    rej = create_draft(app_client, make_maker(), vid, "OWED-REJ", 333.0, due_date=due)
    app_client.post(f"{BASE}/{rej['id']}/submit", cookies=admin_cookies)
    app_client.post(f"{BASE}/{rej['id']}/approve", json={"decision": "reject", "comment": "no"}, cookies=admin_cookies)
    create_approved(app_client, admin_cookies, vid, "OWED-APPR", 1000.0, due_date=due)

    v360 = app_client.get(f"/api/finance/vendors/{vid}/360", cookies=admin_cookies).json()
    assert v360["metrics"]["open_bills_count"] == 1
    assert v360["metrics"]["open_bills_total"] == 1000.0

    aging = app_client.get(
        "/api/finance/reports/ap-aging", params={"currency": "USD", "as_of_date": _today(30)}, cookies=admin_cookies
    ).json()
    row = next(r for r in aging["rows"] if r["id"] == vid)
    assert row["outstanding_count"] == 1
    assert row["buckets"]["total"] == 1000.0

    forecast = app_client.get(
        "/api/finance/reports/cash-forecast", params={"currency": "USD"}, cookies=admin_cookies
    ).json()
    refs = [o["reference"] for o in forecast["material_obligations"]]
    assert "OWED-APPR" in refs
    for hidden in ("OWED-DRAFT", "OWED-PEND", "OWED-REJ"):
        assert hidden not in refs

    attention = app_client.get("/api/finance/reports/attention-queue", cookies=admin_cookies).json()
    titles = " ".join(i["title"] for i in attention.get("items", []))
    for hidden in ("OWED-DRAFT", "OWED-PEND", "OWED-REJ"):
        assert hidden not in titles


# ── Subscription-created bills enter Approved, auto-approved by the system ───
def test_subscription_charge_bill_is_approved_by_system(app_client, admin_cookies):
    from db import get_db_context
    from finance.models import BillDB, SubscriptionDB
    from finance.repositories.subscriptions_repository import SubscriptionsRepository

    vid = make_vendor(app_client, admin_cookies, "Sub Vendor B1")
    with get_db_context() as db:
        sub = SubscriptionDB(
            vendor_id=vid, name="B1 SaaS", amount=50.0, currency="USD", billing_cycle="monthly",
            next_renewal_date="2026-11-01", is_active=True, auto_generate_bill=True,
        )
        db.add(sub)
        db.commit()
        sub_id = sub.id
    from finance.schemas import SubscriptionChargeCreate
    with get_db_context() as db:
        repo = SubscriptionsRepository(db)
        charge = repo.create_charge(
            SubscriptionChargeCreate(subscription_id=sub_id, billing_date="2026-10-01", amount=50.0, currency="USD"),
            created_by="tester",
        )
        bill = db.query(BillDB).filter(BillDB.id == charge.linked_bill_id).first()
        assert bill.status == "approved"
        assert bill.approval_status == "auto"
        assert bill.approved_by == "system"


# ── Migration 0028: maps every old status, runs up and down ─────────────────
def _load_migration():
    path = os.path.join(BE_DIR, "migrations", "versions", "0028_bill_status_model.py")
    spec = importlib.util.spec_from_file_location("mig_0028", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _legacy_engine(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text(
            "CREATE TABLE finance_bills ("
            "id INTEGER PRIMARY KEY, bill_number VARCHAR(50), "
            "status VARCHAR(30) NOT NULL DEFAULT 'unpaid', total FLOAT DEFAULT 0, "
            "amount_paid FLOAT NOT NULL DEFAULT 0, scheduled_payment_date VARCHAR(20))"
        ))
        rows = [
            ("inbox", 100, 0), ("needs_coding", 100, 0), ("needs_approval", 100, 0), ("exceptions", 100, 0),
            ("unpaid", 100, 0), ("ready_to_pay", 100, 0), ("overdue", 100, 0),
            ("scheduled", 100, 0), ("partially_paid", 100, 40), ("paid", 100, 100), ("void", 100, 0),
            # legacy payable rows that already carry payments
            ("unpaid", 100, 100), ("ready_to_pay", 100, 25),
        ]
        for i, (st, total, paid) in enumerate(rows, start=1):
            conn.execute(
                sa.text("INSERT INTO finance_bills (id, bill_number, status, total, amount_paid) VALUES (:i, :n, :s, :t, :p)"),
                {"i": i, "n": f"B{i}", "s": st, "t": total, "p": paid},
            )
    return engine


def _statuses(engine):
    with engine.connect() as conn:
        return {r[0]: r[1] for r in conn.execute(sa.text("SELECT id, status FROM finance_bills"))}


def test_migration_maps_all_statuses_up_and_down(tmp_path):
    mod = _load_migration()
    engine = _legacy_engine(tmp_path)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()

    got = _statuses(engine)
    assert got == {
        1: "draft", 2: "draft", 3: "pending_approval", 4: "rejected",
        5: "approved", 6: "approved", 7: "approved",
        8: "scheduled", 9: "partially_paid", 10: "paid", 11: "void",
        12: "paid", 13: "partially_paid",
    }
    insp = sa.inspect(engine)
    cols = {c["name"]: c for c in insp.get_columns("finance_bills")}
    assert {"void_reason", "voided_by", "voided_at"} <= set(cols)
    assert "draft" in str(cols["status"]["default"])

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
    back = _statuses(engine)
    assert set(back.values()) <= {"inbox", "needs_approval", "exceptions", "ready_to_pay", "scheduled", "partially_paid", "paid", "void"}
    assert back[1] == "inbox" and back[3] == "needs_approval" and back[4] == "exceptions"
    assert back[5] == "ready_to_pay" and back[10] == "paid" and back[11] == "void"
    cols_after = {c["name"]: c for c in sa.inspect(engine).get_columns("finance_bills")}
    assert "void_reason" not in cols_after
    assert "unpaid" in str(cols_after["status"]["default"])


def test_migration_refuses_unknown_status(tmp_path):
    mod = _load_migration()
    engine = _legacy_engine(tmp_path)
    with engine.begin() as conn:
        conn.execute(sa.text("UPDATE finance_bills SET status = 'mystery' WHERE id = 1"))
    with pytest.raises(RuntimeError):
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                mod.upgrade()


# ── Risk table: no retired status key remains in backend sources ─────────────
def test_no_legacy_status_keys_in_backend():
    retired = re.compile(r"""["'](ready_to_pay|needs_approval|needs_coding)["']""")
    bill_files_unpaid = re.compile(r"""["']unpaid["']""")
    bill_scoped = {
        "bills_service.py", "bills_repository.py", "settlement_service.py", "cheques_repository.py",
        "subscriptions_repository.py", "vendors_repository.py", "attention_service.py", "forecast_service.py",
        "bill_status.py", "bills.py",
    }
    offenders = []
    for root, _dirs, files in os.walk(os.path.join(BE_DIR, "finance")):
        if "__pycache__" in root:
            continue
        for name in files:
            if not name.endswith(".py"):
                continue
            text = open(os.path.join(root, name), encoding="utf-8").read()
            if retired.search(text):
                offenders.append(name)
            if name in bill_scoped and bill_files_unpaid.search(text):
                offenders.append(name + ":unpaid")
    assert offenders == []


def test_transition_table_matches_status_set():
    targets = {t for m in bs.BILL_TRANSITIONS.values() for t in m.values()}
    sources = {s for m in bs.BILL_TRANSITIONS.values() for s in m}
    assert targets | sources <= bs.VALID_BILL_STATUSES
    assert bs.VALID_BILL_STATUSES == {
        "draft", "pending_approval", "rejected", "approved", "scheduled", "partially_paid", "paid", "void"
    }
    assert set(bs.OPEN_STATUSES) == {"approved", "scheduled", "partially_paid"}
