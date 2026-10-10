"""
be/tests/test_finance_invoice_rules.py
Slice F1 of Finance Review Round 2 (D-022): sales-invoice status model, locks, void rule,
same-currency receipts through the settlement service, and the 0031 data migration.
"""
import importlib.util
import os
from datetime import datetime, timedelta

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from invoice_test_helpers import (
    BASE,
    account_balance,
    create_invoice,
    get_invoice,
    make_account,
    make_customer,
    receipt,
)
from finance import invoice_status as inv_status

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _day(offset):
    return (datetime.utcnow().date() + timedelta(days=offset)).strftime("%Y-%m-%d")


# ── status never accepted from the client ────────────────────────────────────
@pytest.mark.parametrize("bad", ["draft", "sent", "paid", "overdue", "partially_paid", "garbage"])
def test_status_refused_on_create_and_update(app_client, admin_cookies, bad):
    cust = make_customer(app_client, admin_cookies)
    resp = app_client.post(BASE, json={
        "customer_id": cust, "invoice_number": f"INV-S-{bad}", "issue_date": "2026-09-01",
        "due_date": "2026-09-30", "status": bad, "lines": [],
    }, cookies=admin_cookies)
    assert resp.status_code == 422

    inv = create_invoice(app_client, admin_cookies, cust)
    upd = app_client.put(f"{BASE}/{inv['id']}", json={"status": bad}, cookies=admin_cookies)
    assert upd.status_code == 422
    assert get_invoice(app_client, admin_cookies, inv["id"])["status"] == "draft"


# ── actions drive status ─────────────────────────────────────────────────────
def test_actions_drive_status(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    acc = make_account(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=2000.0)
    assert inv["status"] == "draft" and inv["is_overdue"] is False
    iid = inv["id"]

    # receipt on a draft is refused
    r = receipt(app_client, admin_cookies, iid, acc, 500.0)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "invalid_transition"

    assert app_client.post(f"{BASE}/{iid}/send", cookies=admin_cookies).json()["status"] == "sent"
    again = app_client.post(f"{BASE}/{iid}/send", cookies=admin_cookies)
    assert again.status_code == 409
    assert again.json()["detail"]["current_status"] == "sent"

    r1 = receipt(app_client, admin_cookies, iid, acc, 1000.0, reference="R-1")
    assert r1.status_code == 201, r1.text
    assert get_invoice(app_client, admin_cookies, iid)["status"] == "partially_paid"
    r2 = receipt(app_client, admin_cookies, iid, acc, 1000.0, reference="R-2")
    assert r2.status_code == 201
    assert get_invoice(app_client, admin_cookies, iid)["status"] == "paid"

    # overpayment / receipt on a paid invoice refused
    assert receipt(app_client, admin_cookies, iid, acc, 1.0, reference="R-3").status_code == 409

    rev = app_client.post(f"{BASE}/{iid}/payments/{r2.json()['id']}/reverse?reason=bounced", cookies=admin_cookies)
    assert rev.status_code == 200 and rev.json()["is_reversed"] is True
    assert rev.json()["reversal_reason"] == "bounced" and rev.json()["reversed_at"]
    assert get_invoice(app_client, admin_cookies, iid)["status"] == "partially_paid"
    app_client.post(f"{BASE}/{iid}/payments/{r1.json()['id']}/reverse", cookies=admin_cookies)
    assert get_invoice(app_client, admin_cookies, iid)["status"] == "sent"


def test_overpayment_refused(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    acc = make_account(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=100.0, send=True)
    assert receipt(app_client, admin_cookies, inv["id"], acc, 150.0).status_code == 400


# ── locks once issued ────────────────────────────────────────────────────────
def test_sent_invoice_locks_customer_currency_lines_number(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    other = make_customer(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=2000.0, send=True)
    iid = inv["id"]

    for body, field in [
        ({"customer_id": other}, "customer_id"),
        ({"currency": "EGP"}, "currency"),
        ({"invoice_number": "INV-CHANGED"}, "invoice_number"),
        ({"issue_date": "2026-08-01"}, "issue_date"),
        ({"lines": [{"description": "Service", "quantity": 1, "unit_price": 9999.0, "line_total": 9999.0}]}, "lines"),
    ]:
        resp = app_client.put(f"{BASE}/{iid}", json=body, cookies=admin_cookies)
        assert resp.status_code == 409, (field, resp.text)
        assert resp.json()["detail"]["code"] == "invoice_locked"
        assert field in resp.json()["detail"]["locked_fields"]

    after = get_invoice(app_client, admin_cookies, iid)
    assert after["total"] == 2000.0 and after["customer_id"] == cust and after["currency"] == "USD"


def test_sent_invoice_allows_notes_due_date_and_unchanged_resend(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=2000.0, send=True)
    resp = app_client.put(f"{BASE}/{inv['id']}", json={
        "customer_id": cust, "currency": "USD", "invoice_number": inv["invoice_number"],
        "issue_date": inv["issue_date"], "due_date": "2026-12-31", "notes": "chased",
        "lines": [{"description": "Service", "quantity": 1, "unit_price": 2000.0, "line_total": 2000.0}],
    }, cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    assert resp.json()["due_date"] == "2026-12-31" and resp.json()["notes"] == "chased"
    assert resp.json()["total"] == 2000.0


def test_draft_is_fully_editable(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=100.0)
    resp = app_client.put(f"{BASE}/{inv['id']}", json={
        "currency": "EGP",
        "lines": [{"description": "New", "quantity": 2, "unit_price": 50.0, "line_total": 100.0}],
    }, cookies=admin_cookies)
    assert resp.status_code == 200 and resp.json()["currency"] == "EGP"


# ── void ─────────────────────────────────────────────────────────────────────
def test_void_blocked_with_unreversed_receipt_then_allowed(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    acc = make_account(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=2000.0, send=True)
    iid = inv["id"]
    pay = receipt(app_client, admin_cookies, iid, acc, 500.0, reference="V-1")
    assert pay.status_code == 201

    blocked = app_client.delete(f"{BASE}/{iid}?reason=oops", cookies=admin_cookies)
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "has_unreversed_receipts"
    assert get_invoice(app_client, admin_cookies, iid)["status"] == "partially_paid"

    app_client.post(f"{BASE}/{iid}/payments/{pay.json()['id']}/reverse", cookies=admin_cookies)
    ok = app_client.delete(f"{BASE}/{iid}?reason=customer cancelled", cookies=admin_cookies)
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["status"] == "void" and body["void_reason"] == "customer cancelled"
    assert body["voided_at"] and body["voided_by"]
    assert "Void reason" not in (body["notes"] or "")

    assert app_client.delete(f"{BASE}/{iid}", cookies=admin_cookies).status_code == 409
    assert app_client.put(f"{BASE}/{iid}", json={"notes": "x"}, cookies=admin_cookies).status_code == 409
    assert receipt(app_client, admin_cookies, iid, acc, 10.0, reference="V-2").status_code == 409


def test_paid_invoice_cannot_be_voided(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    acc = make_account(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=100.0, send=True)
    receipt(app_client, admin_cookies, inv["id"], acc, 100.0, reference="P-1")
    resp = app_client.delete(f"{BASE}/{inv['id']}", cookies=admin_cookies)
    assert resp.status_code == 409 and resp.json()["detail"]["code"] == "has_unreversed_receipts"


# ── receipts: currency, ledger row, balances ─────────────────────────────────
def test_receipt_currency_mismatch(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    egp = make_account(app_client, admin_cookies, currency="EGP", balance=500.0)
    inv = create_invoice(app_client, admin_cookies, cust, amount=1000.0, currency="USD", send=True)

    resp = receipt(app_client, admin_cookies, inv["id"], egp, 1000.0, currency="USD", reference="X-1")
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "currency_mismatch"
    assert account_balance(app_client, admin_cookies, egp) == 500.0
    assert get_invoice(app_client, admin_cookies, inv["id"])["status"] == "sent"
    assert app_client.get(f"{BASE}/{inv['id']}/payments", cookies=admin_cookies).json() == []


def test_manual_transaction_linked_to_invoice_obeys_currency_rule(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    egp = make_account(app_client, admin_cookies, currency="EGP", balance=500.0)
    inv = create_invoice(app_client, admin_cookies, cust, amount=1000.0, currency="USD", send=True)
    resp = app_client.post(f"/api/finance/accounts/{egp}/transactions", json={
        "date": "2026-09-15", "amount": 1000.0, "direction": "in", "currency": "EGP",
        "description": "customer payment", "linked_invoice_id": inv["id"],
    }, cookies=admin_cookies)
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "currency_mismatch"
    assert account_balance(app_client, admin_cookies, egp) == 500.0


def test_receipt_ledger_row_and_balance(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies, name="Ledger Customer")
    acc = make_account(app_client, admin_cookies, balance=1000.0)
    inv = create_invoice(app_client, admin_cookies, cust, amount=400.0, send=True)

    pay = receipt(app_client, admin_cookies, inv["id"], acc, 400.0, reference="BANK-77", date="2026-09-10")
    assert pay.status_code == 201, pay.text
    assert account_balance(app_client, admin_cookies, acc) == 1400.0

    rows = app_client.get(f"/api/finance/accounts/{acc}/transactions", cookies=admin_cookies).json()
    rows = rows["items"] if isinstance(rows, dict) else rows
    tx = [r for r in rows if r.get("linked_invoice_id") == inv["id"]]
    assert len(tx) == 1
    assert tx[0]["direction"] == "in" and tx[0]["amount"] == 400.0
    assert tx[0]["reference"] == "BANK-77" and tx[0]["source"] == "invoice_payment"
    assert tx[0]["payee_name"] == "Ledger Customer"
    assert tx[0]["running_balance"] == 1400.0

    app_client.post(f"{BASE}/{inv['id']}/payments/{pay.json()['id']}/reverse?reason=returned", cookies=admin_cookies)
    assert account_balance(app_client, admin_cookies, acc) == 1000.0
    rows = app_client.get(f"/api/finance/accounts/{acc}/transactions", cookies=admin_cookies).json()
    rows = rows["items"] if isinstance(rows, dict) else rows
    assert any(r["source"] == "payment_reversal" for r in rows)  # never deleted


def test_receipt_payment_type_by_account_kind(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    bank = make_account(app_client, admin_cookies)
    cash = make_account(app_client, admin_cookies, account_type="cash")
    types = {t["code"]: t["id"] for t in app_client.get("/api/finance/payment-types", cookies=admin_cookies).json()}
    inv = create_invoice(app_client, admin_cookies, cust, amount=300.0, send=True)

    bad = receipt(app_client, admin_cookies, inv["id"], bank, 100.0, reference="T-1", payment_type_id=types["CASH"])
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "payment_type_not_allowed"
    assert receipt(app_client, admin_cookies, inv["id"], bank, 100.0, reference="T-2",
                   payment_type_id=types["INBOUND_TRANS"]).status_code == 201
    assert receipt(app_client, admin_cookies, inv["id"], cash, 100.0, reference="T-3").status_code == 201
    bad2 = receipt(app_client, admin_cookies, inv["id"], cash, 50.0, reference="T-4", payment_type_id=types["INBOUND_TRANS"])
    assert bad2.status_code == 400 and bad2.json()["detail"]["code"] == "payment_type_not_allowed"


def test_duplicate_reference_still_refused(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    acc = make_account(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=300.0, send=True)
    assert receipt(app_client, admin_cookies, inv["id"], acc, 100.0, reference="DUP-1").status_code == 201
    assert receipt(app_client, admin_cookies, inv["id"], acc, 100.0, reference="DUP-1").status_code == 400


def test_reverse_receipt_must_belong_to_invoice(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    acc = make_account(app_client, admin_cookies)
    a = create_invoice(app_client, admin_cookies, cust, amount=300.0, send=True)
    b = create_invoice(app_client, admin_cookies, cust, amount=300.0, send=True)
    pay = receipt(app_client, admin_cookies, a["id"], acc, 100.0, reference="OWN-1").json()
    resp = app_client.post(f"{BASE}/{b['id']}/payments/{pay['id']}/reverse", cookies=admin_cookies)
    assert resp.status_code == 404
    assert account_balance(app_client, admin_cookies, acc) == 100100.0


# ── overdue is a flag; filters ───────────────────────────────────────────────
def test_overdue_is_flag_not_status_and_filters(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    acc = make_account(app_client, admin_cookies)
    past, future = _day(-10), _day(10)
    draft_past = create_invoice(app_client, admin_cookies, cust, due_date=past, issue_date=_day(-30))
    sent_past = create_invoice(app_client, admin_cookies, cust, due_date=past, issue_date=_day(-30), send=True)
    part_past = create_invoice(app_client, admin_cookies, cust, due_date=past, issue_date=_day(-30), send=True, amount=100.0)
    receipt(app_client, admin_cookies, part_past["id"], acc, 40.0, reference="O-1")
    sent_future = create_invoice(app_client, admin_cookies, cust, due_date=future, issue_date=_day(-1), send=True)
    paid_past = create_invoice(app_client, admin_cookies, cust, due_date=past, issue_date=_day(-30), send=True, amount=50.0)
    receipt(app_client, admin_cookies, paid_past["id"], acc, 50.0, reference="O-2")

    g = lambda i: get_invoice(app_client, admin_cookies, i["id"])
    assert g(draft_past)["is_overdue"] is False and g(draft_past)["status"] == "draft"
    assert g(sent_past)["is_overdue"] is True and g(sent_past)["status"] == "sent"
    assert g(part_past)["is_overdue"] is True and g(part_past)["status"] == "partially_paid"
    assert g(sent_future)["is_overdue"] is False
    assert g(paid_past)["is_overdue"] is False and g(paid_past)["status"] == "paid"

    def ids(q):
        rows = app_client.get(f"{BASE}?{q}&customer_id={cust}&limit=100", cookies=admin_cookies)
        assert rows.status_code == 200, rows.text
        assert all(r["status"] in inv_status.VALID_INVOICE_STATUSES for r in rows.json())
        return {r["id"] for r in rows.json()}

    assert ids("status=overdue") == {sent_past["id"], part_past["id"]}
    assert ids("status=awaiting_payment") == {sent_future["id"]}
    assert ids("status=open") == {draft_past["id"], sent_past["id"], part_past["id"], sent_future["id"]}
    assert ids("status=paid") == {paid_past["id"]}
    assert ids("status=partially_paid") == {part_past["id"]}
    assert len(ids("status=all")) == 5
    assert app_client.get(f"{BASE}?status=bogus", cookies=admin_cookies).status_code == 400


def test_reminder_only_for_open_invoices(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    draft = create_invoice(app_client, admin_cookies, cust)
    assert app_client.post(f"{BASE}/{draft['id']}/remind", cookies=admin_cookies).status_code == 400


def test_transition_table_matches_status_set():
    assert set(inv_status.INVOICE_STATUSES) == {"draft", "sent", "partially_paid", "paid", "void"}
    for action, mapping in inv_status.INVOICE_TRANSITIONS.items():
        assert set(mapping) | set(mapping.values()) <= set(inv_status.INVOICE_STATUSES), action
    with pytest.raises(inv_status.InvalidInvoiceTransition):
        inv_status.next_status("send", "void")


# ── Migration 0031: maps every old status, runs up and down ──────────────────
def _load_migration():
    path = os.path.join(BE_DIR, "migrations", "versions", "0031_invoice_status_model.py")
    spec = importlib.util.spec_from_file_location("mig_0031", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _legacy_engine(tmp_path, rows):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text(
            "CREATE TABLE finance_sales_invoices (id INTEGER PRIMARY KEY, invoice_number VARCHAR(50), "
            "status VARCHAR(30) NOT NULL DEFAULT 'draft', total FLOAT DEFAULT 0)"
        ))
        conn.execute(sa.text(
            "CREATE TABLE finance_payments (id INTEGER PRIMARY KEY, direction VARCHAR(20), "
            "related_invoice_id INTEGER, amount FLOAT, is_reversed BOOLEAN NOT NULL DEFAULT 0)"
        ))
        for i, (st, total, paid, reversed_paid) in enumerate(rows, start=1):
            conn.execute(sa.text("INSERT INTO finance_sales_invoices (id, invoice_number, status, total) VALUES (:i, :n, :s, :t)"),
                         {"i": i, "n": f"I{i}", "s": st, "t": total})
            if paid:
                conn.execute(sa.text("INSERT INTO finance_payments (direction, related_invoice_id, amount, is_reversed) VALUES ('incoming', :i, :a, 0)"),
                             {"i": i, "a": paid})
            if reversed_paid:
                conn.execute(sa.text("INSERT INTO finance_payments (direction, related_invoice_id, amount, is_reversed) VALUES ('incoming', :i, :a, 1)"),
                             {"i": i, "a": reversed_paid})
    return engine


def _run(engine, fn):
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            fn()


def _statuses(engine):
    with engine.connect() as conn:
        return {r[0]: r[1] for r in conn.execute(sa.text("SELECT id, status FROM finance_sales_invoices"))}


def test_migration_maps_all_legacy_statuses_up_and_down(tmp_path):
    mod = _load_migration()
    rows = [
        ("draft", 100, 0, 0),            # 1 unchanged
        ("sent", 100, 0, 0),             # 2 unchanged
        ("overdue", 100, 0, 0),          # 3 -> sent
        ("open", 100, 0, 0),             # 4 -> sent
        ("awaiting_payment", 100, 0, 0), # 5 -> sent
        ("partially_paid", 100, 40, 0),  # 6 stays
        ("paid", 100, 100, 0),           # 7 stays
        ("void", 100, 0, 0),             # 8 stays
        ("overdue", 100, 40, 0),         # 9 -> partially_paid (receipts)
        ("sent", 100, 100, 0),           # 10 -> paid
        ("partially_paid", 100, 0, 30),  # 11 only a reversed receipt -> sent
        ("paid", 100, 0, 0),             # 12 stored paid, no payments: left alone
    ]
    engine = _legacy_engine(tmp_path, rows)
    _run(engine, mod.upgrade)
    assert _statuses(engine) == {
        1: "draft", 2: "sent", 3: "sent", 4: "sent", 5: "sent", 6: "partially_paid", 7: "paid",
        8: "void", 9: "partially_paid", 10: "paid", 11: "sent", 12: "paid",
    }
    cols = {c["name"] for c in sa.inspect(engine).get_columns("finance_sales_invoices")}
    assert {"void_reason", "voided_by", "voided_at"} <= cols

    _run(engine, mod.downgrade)
    cols = {c["name"] for c in sa.inspect(engine).get_columns("finance_sales_invoices")}
    assert not ({"void_reason", "voided_by", "voided_at"} & cols)
    assert len(_statuses(engine)) == 12  # rows intact


def test_migration_refuses_unknown_status_and_runs_on_empty_table(tmp_path):
    mod = _load_migration()
    engine = _legacy_engine(tmp_path, [("all", 100, 0, 0)])
    with pytest.raises(RuntimeError):
        _run(engine, mod.upgrade)

    sub = tmp_path / "empty"
    sub.mkdir()
    empty = _legacy_engine(sub, [])
    _run(empty, mod.upgrade)
    _run(empty, mod.downgrade)
