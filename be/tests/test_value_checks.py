"""
be/tests/test_value_checks.py
Database redesign Stage 4b: CHECK constraints on columns with a fixed set of values, kept in step with the
application's lists, and migration 0058 that adds them (stopping with a list when existing rows are outside the sets).
"""
import importlib.util
import os
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from db import get_db_context
from finance import models as fm
from finance.bill_status import BILL_STATUSES
from finance.invoice_status import INVOICE_STATUSES

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _migration():
    path = os.path.join(BE_DIR, "migrations", "versions", "0058_value_checks.py")
    spec = importlib.util.spec_from_file_location("mig_0058", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _model_checks():
    found = {}
    for model in (fm.BillDB, fm.SalesInvoiceDB, fm.LedgerTransactionDB, fm.PaymentDB, fm.FinanceBankAccountDB):
        for c in model.__table__.constraints:
            if isinstance(c, CheckConstraint) and c.name:
                found[c.name] = str(c.sqltext)
    return found


def test_model_checks_match_the_migration_and_the_status_modules():
    mig = _migration()
    assert tuple(mig.BILL_STATUSES) == tuple(BILL_STATUSES)
    assert tuple(mig.INVOICE_STATUSES) == tuple(INVOICE_STATUSES)
    model = _model_checks()
    for name, _table, column, values in mig.RULES:
        assert model[name] == mig._expr(column, values), name


def test_the_database_refuses_values_outside_the_sets(app_client):
    with get_db_context() as db:
        db.execute(text("INSERT INTO finance_vendors (name, onboarding_status, is_active) VALUES ('V', 'active', 1)"))
        vid = db.execute(text("SELECT id FROM finance_vendors WHERE name = 'V'")).scalar()
        db.commit()
        bad = [
            "INSERT INTO finance_bills (vendor_id, status, currency, is_reviewed, is_duplicate_override, requires_approval, "
            f"capture_source, vendor_to_confirm) VALUES ({vid}, 'bogus', 'USD', 1, 0, 0, 'manual', 0)",
            "INSERT INTO finance_bank_accounts (account_name, bank_name, account_number, currency, account_type, book_id) "
            "VALUES ('A', 'B', 'N', 'USD', 'vault', (SELECT id FROM finance_books LIMIT 1))",
            "INSERT INTO finance_payments (direction, amount, currency, payment_date, bank_account_id) "
            "VALUES ('sideways', 1, 'USD', '2026-01-01', 1)",
        ]
        for sql in bad:
            with pytest.raises(IntegrityError):
                db.execute(text(sql))
                db.commit()
            db.rollback()


# --- migration 0058 ---------------------------------------------------------------------------------------------

def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _table_sql(path, table):
    with sqlite3.connect(path) as conn:
        return conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone()[0]


def test_migration_0058_adds_and_drops_the_checks(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    for name, table, *_ in _migration().RULES:
        assert name in _table_sql(path, table), name
    _alembic(url, "downgrade", "0057_payroll_base_pay_line_unique")
    for name, table, *_ in _migration().RULES:
        assert name not in _table_sql(path, table), name
    _alembic(url, "upgrade", "head")  # and back


def test_migration_0058_stops_and_lists_values_outside_the_sets(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0057_payroll_base_pay_line_unique")
    if "ck_finance_bills_status" in _table_sql(path, "finance_bills"):
        pytest.skip("this chain already builds finance_bills with the CHECK, so a bad row cannot be planted")
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO finance_vendors (id, name, onboarding_status, is_active) VALUES (1, 'V', 'active', 1)")
        for status in ("bogus", "bogus", "weird"):
            conn.execute("INSERT INTO finance_bills (vendor_id, status, currency, is_reviewed, is_duplicate_override, requires_approval, "
                         "capture_source, vendor_to_confirm) VALUES (1, ?, 'USD', 1, 0, 0, 'manual', 0)", (status,))
        conn.commit()
    done = _alembic(url, "upgrade", "head", expect_ok=False)
    assert done.returncode != 0 and "'bogus': 2 row(s)" in done.stderr and "'weird': 1 row(s)" in done.stderr
