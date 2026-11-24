"""
be/tests/test_invoice_actors.py
The invoice activity timeline shows who did what from stored facts: created_by, sent_by/sent_at, the payment's
created_by, and the audit log for edits. No made-up people or times; legacy rows backfill to the finance user (0081).
"""
import importlib.util
import os

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from db import get_db_context
from finance.models import PaymentDB, SalesInvoiceDB
from invoice_test_helpers import BASE, create_invoice, make_account, make_customer, receipt

ADMIN = "admin@hrflow.test"


def _timeline(client, cookies, invoice_id):
    resp = client.get(f"/api/finance/activity/invoice/{invoice_id}", cookies=cookies)
    assert resp.status_code == 200, resp.text
    return resp.json()["timeline"]


def test_timeline_names_the_real_user_for_every_action(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv = create_invoice(app_client, admin_cookies, make_customer(app_client, admin_cookies), amount=1000.0, send=True)
    assert receipt(app_client, admin_cookies, inv["id"], acc, 400.0, reference="A-1", date="2026-09-10").status_code == 201
    assert receipt(app_client, admin_cookies, inv["id"], acc, 600.0, reference="A-2", date="2026-09-20").status_code == 201

    tl = _timeline(app_client, admin_cookies, inv["id"])
    assert [e["event"] for e in tl] == ["created", "sent", "payment_recorded", "payment_recorded"]
    assert {e["actor"] for e in tl} == {ADMIN}
    assert not any("voyancemed" in (e["actor"] + e["plain_text"]) for e in tl)
    # each payment line carries its own received date and the status it moved the invoice to
    assert "received 2026-09-10" in tl[2]["plain_text"] and tl[2]["state_transition"] == {"from_state": "sent", "to_state": "partially_paid"}
    assert "received 2026-09-20" in tl[3]["plain_text"] and tl[3]["state_transition"] == {"from_state": "partially_paid", "to_state": "paid"}


def test_actors_are_stored_on_the_rows(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv = create_invoice(app_client, admin_cookies, make_customer(app_client, admin_cookies), amount=500.0, send=True)
    pay_id = receipt(app_client, admin_cookies, inv["id"], acc, 500.0, reference="B-1").json()["id"]
    with get_db_context() as db:
        row = db.query(SalesInvoiceDB).filter(SalesInvoiceDB.id == inv["id"]).one()
        assert (row.created_by, row.sent_by) == (ADMIN, ADMIN) and row.sent_at is not None
        assert db.query(PaymentDB).filter(PaymentDB.id == pay_id).one().created_by == ADMIN


def test_edit_adds_an_audit_line_and_draft_has_no_sent_line(app_client, admin_cookies):
    inv = create_invoice(app_client, admin_cookies, make_customer(app_client, admin_cookies), amount=500.0)
    assert app_client.put(f"{BASE}/{inv['id']}", json={"notes": "changed"}, cookies=admin_cookies).status_code == 200
    tl = _timeline(app_client, admin_cookies, inv["id"])
    assert [e["event"] for e in tl] == ["created", "invoice.updated"]
    assert tl[1]["actor"] == ADMIN and tl[1]["plain_text"].startswith("Invoice edited")


def test_reversal_and_void_show_who_did_them(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv = create_invoice(app_client, admin_cookies, make_customer(app_client, admin_cookies), amount=300.0, send=True)
    pid = receipt(app_client, admin_cookies, inv["id"], acc, 300.0, reference="C-1", date="2026-09-10").json()["id"]
    assert app_client.post(f"{BASE}/{inv['id']}/payments/{pid}/reverse", params={"reason": "typo"}, cookies=admin_cookies).status_code == 200
    assert app_client.delete(f"{BASE}/{inv['id']}", params={"reason": "wrong customer"}, cookies=admin_cookies).status_code == 200
    tl = _timeline(app_client, admin_cookies, inv["id"])
    kinds = [e["event"] for e in tl]
    assert kinds[:2] == ["created", "sent"] and "payment_reversed" in kinds and kinds[-1] == "voided"
    assert all(e["actor"] == ADMIN for e in tl)
    assert any("typo" in e["plain_text"] for e in tl if e["event"] == "payment_reversed")
    assert "wrong customer" in tl[-1]["plain_text"]


# --- migration 0081 -----------------------------------------------------------------------------------------------------------

def _load_migration():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations", "versions", "0081_invoice_actors.py")
    spec = importlib.util.spec_from_file_location("mig_0081", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, fn):
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            fn()


def test_migration_backfills_the_finance_user_and_downgrades(tmp_path):
    mig = _load_migration()
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE finance_ledger_transactions (id INTEGER PRIMARY KEY, created_by VARCHAR(255))"))
        conn.execute(sa.text("CREATE TABLE finance_sales_invoices (id INTEGER PRIMARY KEY, status VARCHAR(30) NOT NULL)"))
        conn.execute(sa.text(
            "CREATE TABLE finance_payments (id INTEGER PRIMARY KEY, related_invoice_id INTEGER, related_bill_id INTEGER, "
            "ledger_transaction_id INTEGER)"))
        conn.execute(sa.text("INSERT INTO finance_ledger_transactions VALUES (1, 'someone.else@voyance.health'), (2, NULL)"))
        conn.execute(sa.text("INSERT INTO finance_sales_invoices VALUES (1, 'draft'), (2, 'sent'), (3, 'paid'), (4, 'void')"))
        conn.execute(sa.text(
            "INSERT INTO finance_payments VALUES (1, 3, NULL, 1), (2, 3, NULL, 2), (3, 3, NULL, NULL), (4, NULL, 9, NULL)"))
    _run(engine, mig.upgrade)
    with engine.connect() as conn:
        inv = conn.execute(sa.text("SELECT id, created_by, sent_by, sent_at FROM finance_sales_invoices ORDER BY id")).fetchall()
        legacy = mig.LEGACY_ACTOR
        assert [tuple(r) for r in inv] == [(1, legacy, None, None), (2, legacy, legacy, None), (3, legacy, legacy, None), (4, legacy, None, None)]
        pay = conn.execute(sa.text("SELECT id, created_by FROM finance_payments ORDER BY id")).fetchall()
        # the ledger row's own actor wins; a bill payment is left alone
        assert [tuple(r) for r in pay] == [(1, "someone.else@voyance.health"), (2, legacy), (3, legacy), (4, None)]
    _run(engine, mig.upgrade)  # running it again changes nothing and does not fail
    _run(engine, mig.downgrade)
    insp = sa.inspect(engine)
    assert not ({"created_by", "sent_by", "sent_at"} & {c["name"] for c in insp.get_columns("finance_sales_invoices")})
    assert "created_by" not in {c["name"] for c in insp.get_columns("finance_payments")}
