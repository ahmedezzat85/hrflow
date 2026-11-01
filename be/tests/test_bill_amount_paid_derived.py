"""
be/tests/test_bill_amount_paid_derived.py
Database redesign Stage 2b: a bill's paid amount is derived from its live payments, never stored. Migration 0053
upgrades and downgrades cleanly.
"""
import os
import sqlite3
import subprocess
import sys

from db import get_db_context
from finance.models import BillDB, FinanceBankAccountDB, PaymentDB, VendorDB

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _bill_with_account(db, number):
    vendor = VendorDB(name=f"V {number}")
    account = FinanceBankAccountDB(account_name=f"A {number}", bank_name="B", account_number=number, currency="USD")
    db.add_all([vendor, account])
    db.flush()
    bill = BillDB(vendor_id=vendor.id, bill_number=number, status="approved", currency="USD", total=500.0)
    db.add(bill)
    db.flush()
    return bill, account


def _payment(db, bill, account, amount, reversed_=False):
    payment = PaymentDB(direction="outgoing", related_bill_id=bill.id, amount=amount, currency="USD",
                        payment_date="2026-01-05", bank_account_id=account.id, is_reversed=reversed_)
    db.add(payment)
    db.flush()
    return payment


def test_model_has_no_stored_amount_paid_column():
    assert "amount_paid" not in {c.name for c in BillDB.__table__.columns}
    assert hasattr(BillDB, "amount_paid")


def test_amount_paid_is_the_sum_of_live_payments(app_client):
    with get_db_context() as db:
        bill, account = _bill_with_account(db, "DER-1")
        _payment(db, bill, account, 100.0)
        _payment(db, bill, account, 50.5)
        _payment(db, bill, account, 999.0, reversed_=True)
        db.commit()
        reloaded = db.query(BillDB).filter(BillDB.id == bill.id).first()
        assert round(reloaded.amount_paid, 2) == 150.5


def test_amount_paid_is_fresh_after_flush_and_expire(app_client):
    with get_db_context() as db:
        bill, account = _bill_with_account(db, "DER-2")
        db.commit()
        assert db.query(BillDB).filter(BillDB.id == bill.id).first().amount_paid == 0.0
        first = _payment(db, bill, account, 40.0)
        db.expire(bill, ["amount_paid"])
        assert bill.amount_paid == 40.0
        first.is_reversed = True
        db.flush()
        db.expire(bill, ["amount_paid"])
        assert bill.amount_paid == 0.0


# --- migration 0053 ---------------------------------------------------------------------------------------------

def _alembic(url, *args):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-1500:]


def _cols(path, table):
    with sqlite3.connect(path) as conn:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_migration_0053_drops_the_column_and_downgrade_refills_it(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0052_bill_imported_category")
    with sqlite3.connect(path) as conn:
        # Migration 0013 builds missing tables from the current models, so a fresh chain never had the column.
        if "amount_paid" not in _cols(path, "finance_bills"):
            conn.execute("ALTER TABLE finance_bills ADD COLUMN amount_paid FLOAT NOT NULL DEFAULT 0")
        conn.execute("INSERT OR IGNORE INTO finance_books (id, code, name, is_default) VALUES (1, 'local', 'Local', 1)")
        conn.execute("INSERT INTO finance_bank_accounts (id, account_name, bank_name, account_number, currency, account_type, book_id) "
                     "VALUES (7, 'Acc', 'Bank', 'A-7', 'USD', 'bank', 1)")
        conn.execute("INSERT INTO finance_vendors (id, name, onboarding_status, is_active) VALUES (1, 'V', 'active', 1)")
        for bill_id, stored in ((1, 150.0), (2, 999.0)):  # bill 2's stored amount disagrees with its payments
            conn.execute("INSERT INTO finance_bills (id, vendor_id, bill_number, status, currency, total, amount_paid, is_reviewed, "
                         "is_duplicate_override, requires_approval, capture_source, vendor_to_confirm) "
                         "VALUES (?, 1, ?, 'approved', 'USD', 500, ?, 1, 0, 0, 'manual', 0)", (bill_id, f"B-{bill_id}", stored))
        for amount, reversed_ in ((100.0, 0), (50.0, 0), (25.0, 1)):
            conn.execute("INSERT INTO finance_payments (direction, related_bill_id, amount, currency, payment_date, bank_account_id, "
                         "is_reversed) VALUES ('outgoing', 1, ?, 'USD', '2026-01-05', 7, ?)", (amount, reversed_))
        conn.commit()

    _alembic(url, "upgrade", "head")
    assert "amount_paid" not in _cols(path, "finance_bills")

    _alembic(url, "downgrade", "0052_bill_imported_category")
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT id, amount_paid FROM finance_bills ORDER BY id").fetchall() == [(1, 150.0), (2, 0.0)]
