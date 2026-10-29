"""
be/tests/test_payment_ledger_link.py
Database redesign Stage 2b: every payment recorded through the app is linked to the ledger row it posted (unique),
and migration 0054 backfills older payments by matching and leaves unmatched ones empty.
"""
import os
import re
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from db import get_db_context
from finance.models import LedgerTransactionDB, PaymentDB, PaymentTypeDB

from bill_test_helpers import create_approved, make_account, make_vendor

BASE = "/api/finance/bills"
BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _linked(payment_id):
    """(payment fields, ledger row fields) read while the session is open; the row is None when unlinked."""
    with get_db_context() as db:
        payment = db.query(PaymentDB).filter(PaymentDB.id == payment_id).first()
        tx = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.id == payment.ledger_transaction_id).first()
        pay = {"bank_account_id": payment.bank_account_id, "amount": payment.amount, "ledger_transaction_id": payment.ledger_transaction_id}
        row = None if tx is None else {"id": tx.id, "source": tx.source, "linked_bill_id": tx.linked_bill_id,
                                        "account_id": tx.account_id, "amount": tx.amount}
        return pay, row


def _type_id(code="OUTBOUND_TRANS"):
    with get_db_context() as db:
        return db.query(PaymentTypeDB).filter(PaymentTypeDB.code == code).first().id


def test_bill_payment_is_linked_to_its_ledger_row(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Link Vendor A")
    acc = make_account(app_client, admin_cookies, "Link Acc A", number="LNK-0001", balance=1000.0)
    bill = create_approved(app_client, admin_cookies, vid, "LNK-001", 300.0, currency="USD")
    resp = app_client.post(f"{BASE}/{bill['id']}/payments",
                           json={"amount": 120.0, "payment_date": "2026-09-05", "bank_account_id": acc, "payment_type_id": _type_id()},
                           cookies=admin_cookies)
    assert resp.status_code in (200, 201), resp.text
    payments = app_client.get(f"{BASE}/{bill['id']}/payments", cookies=admin_cookies).json()
    assert len(payments) == 1
    payment, tx = _linked(payments[0]["id"])
    assert tx is not None and tx["source"] == "bill_payment" and tx["linked_bill_id"] == bill["id"]
    assert tx["account_id"] == payment["bank_account_id"] and abs(tx["amount"] - payment["amount"]) < 0.005


def test_manual_transaction_linked_to_a_bill_links_the_payment(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Link Vendor B")
    acc = make_account(app_client, admin_cookies, "Link Acc B", number="LNK-0002", balance=1000.0)
    bill = create_approved(app_client, admin_cookies, vid, "LNK-002", 200.0, currency="USD")
    resp = app_client.post(f"/api/finance/accounts/{acc}/transactions",
                           json={"date": "2026-09-06", "amount": 75.0, "direction": "out", "currency": "USD",
                                 "reference": "TX-LNK", "description": "pay", "linked_bill_id": bill["id"]},
                           cookies=admin_cookies)
    assert resp.status_code in (200, 201), resp.text
    payments = app_client.get(f"{BASE}/{bill['id']}/payments", cookies=admin_cookies).json()
    _, tx = _linked(payments[0]["id"])
    assert tx is not None and tx["id"] == resp.json()["id"]


def test_one_ledger_row_cannot_back_two_payments(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Link Vendor C")
    acc = make_account(app_client, admin_cookies, "Link Acc C", number="LNK-0003", balance=1000.0)
    bill = create_approved(app_client, admin_cookies, vid, "LNK-003", 300.0, currency="USD")
    for amount in (50.0, 60.0):
        app_client.post(f"{BASE}/{bill['id']}/payments",
                        json={"amount": amount, "payment_date": "2026-09-07", "bank_account_id": acc, "payment_type_id": _type_id()},
                        cookies=admin_cookies)
    ids = [p["id"] for p in app_client.get(f"{BASE}/{bill['id']}/payments", cookies=admin_cookies).json()]
    first, _ = _linked(ids[0])
    with get_db_context() as db:
        second = db.query(PaymentDB).filter(PaymentDB.id == ids[1]).first()
        second.ledger_transaction_id = first["ledger_transaction_id"]
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()


def test_invoice_receipt_through_a_transaction_links_the_payment(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, "Link Acc D", number="LNK-0004", balance=1000.0)
    customer = app_client.post("/api/finance/customers", json={"name": "Link Customer", "default_currency": "USD"},
                               cookies=admin_cookies).json()["id"]
    invoice = app_client.post("/api/finance/invoices", json={
        "customer_id": customer, "invoice_number": "INV-LNK-1", "issue_date": "2026-09-01", "due_date": "2026-09-20",
        "currency": "USD", "subtotal": 400.0, "tax_amount": 0.0, "total": 400.0,
        "lines": [{"description": "Work", "quantity": 1.0, "unit_price": 400.0, "line_total": 400.0}],
    }, cookies=admin_cookies).json()["id"]
    assert app_client.post(f"/api/finance/invoices/{invoice}/send", cookies=admin_cookies).status_code == 200
    resp = app_client.post(f"/api/finance/accounts/{acc}/transactions", json={
        "date": "2026-09-05", "amount": 150.0, "direction": "in", "currency": "USD", "entry_type": "money_in",
        "payee_type": "customer", "payee_id": customer, "linked_invoice_id": invoice, "description": "Deposit",
    }, cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    with get_db_context() as db:
        payment = db.query(PaymentDB).filter(PaymentDB.related_invoice_id == invoice).first()
        assert payment.ledger_transaction_id == resp.json()["id"]


def test_linked_cheque_links_the_payment_to_the_cheque_outflow(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Link Vendor E")
    acc = make_account(app_client, admin_cookies, "Link Acc E", number="LNK-0005", balance=1000.0)
    bill = create_approved(app_client, admin_cookies, vid, "LNK-005", 300.0, currency="USD")
    resp = app_client.post("/api/finance/cheques", json={
        "account_id": acc, "cheque_number": "990001", "issue_date": "2026-09-05", "amount": 120.0, "currency": "USD",
        "payee": "Link Vendor E", "purpose_type": "vendor_payment", "linked_bill_id": bill["id"],
    }, cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    with get_db_context() as db:
        payment = db.query(PaymentDB).filter(PaymentDB.related_bill_id == bill["id"]).first()
        tx = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.id == payment.ledger_transaction_id).first()
        assert tx is not None and tx.source == "cheque" and tx.cheque_number == "990001" and tx.direction == "out"


# --- migration 0054 ---------------------------------------------------------------------------------------------

def _alembic(url, *args):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-1500:]


def _cols(path, table):
    with sqlite3.connect(path) as conn:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def _strip_column(conn, table, column):
    """Rebuild a SQLite table without one column (and its index and foreign key): migration 0013 builds missing tables
    from the current models, so a fresh chain already has the column that 0054 adds."""
    for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL", (table,)).fetchall():
        if column in conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (name,)).fetchone()[0]:
            conn.execute(f"DROP INDEX {name}")
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone()[0]
    sql = re.sub(r",\s*" + column + r" \w+", "", sql)  # columns added by ALTER TABLE share one line
    kept = [ln for ln in sql.split("\n") if "FOREIGN KEY(" + column + ")" not in ln]
    new_sql = re.sub(r",\s*\)\s*$", "\n)", "\n".join(kept))
    conn.execute(f"ALTER TABLE {table} RENAME TO {table}_old")
    conn.execute(new_sql)
    names = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
    conn.execute(f"INSERT INTO {table} ({', '.join(names)}) SELECT {', '.join(names)} FROM {table}_old")
    conn.execute(f"DROP TABLE {table}_old")


def test_migration_0054_backfills_by_matching_and_leaves_the_rest_empty(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0053_bill_amount_paid_derived")
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA foreign_keys=OFF")
        if "ledger_transaction_id" in _cols(path, "finance_payments"):
            _strip_column(conn, "finance_payments", "ledger_transaction_id")
        conn.execute("INSERT OR IGNORE INTO finance_books (id, code, name, is_default) VALUES (1, 'local', 'Local', 1)")
        conn.execute("INSERT INTO finance_bank_accounts (id, account_name, bank_name, account_number, currency, account_type, book_id) "
                     "VALUES (7, 'Acc', 'Bank', 'A-7', 'USD', 'bank', 1)")
        conn.execute("INSERT INTO finance_vendors (id, name, onboarding_status, is_active) VALUES (1, 'V', 'active', 1)")
        for bill_id in (1, 2):
            conn.execute("INSERT INTO finance_bills (id, vendor_id, bill_number, status, currency, total, is_reviewed, "
                         "is_duplicate_override, requires_approval, capture_source, vendor_to_confirm) "
                         "VALUES (?, 1, ?, 'approved', 'USD', 500, 1, 0, 0, 'manual', 0)", (bill_id, f"B-{bill_id}"))
        # two identical payments on bill 1 but only one ledger row: one links, one stays empty; bill 2 has no ledger row
        for _ in range(2):
            conn.execute("INSERT INTO finance_payments (direction, related_bill_id, amount, currency, payment_date, bank_account_id, "
                         "is_reversed) VALUES ('outgoing', 1, 100, 'USD', '2026-01-05', 7, 0)")
        conn.execute("INSERT INTO finance_payments (direction, related_bill_id, amount, currency, payment_date, bank_account_id, "
                     "is_reversed) VALUES ('outgoing', 2, 40, 'USD', '2026-01-06', 7, 0)")
        conn.execute("INSERT INTO finance_ledger_transactions (id, account_id, date, amount, direction, currency, reference, description, "
                     "entry_type, source, linked_bill_id, running_balance) "
                     "VALUES (11, 7, '2026-01-05', 100, 'out', 'USD', '', '', 'standard', 'bill_payment', 1, 0)")
        conn.commit()

    _alembic(url, "upgrade", "head")
    assert "ledger_transaction_id" in _cols(path, "finance_payments")
    with sqlite3.connect(path) as conn:
        got = conn.execute("SELECT id, ledger_transaction_id FROM finance_payments ORDER BY id").fetchall()
        assert got == [(1, 11), (2, None), (3, None)]
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE finance_payments SET ledger_transaction_id = 11 WHERE id = 2")

    _alembic(url, "downgrade", "0053_bill_amount_paid_derived")
    assert "ledger_transaction_id" not in _cols(path, "finance_payments")
