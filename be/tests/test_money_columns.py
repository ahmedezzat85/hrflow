"""
be/tests/test_money_columns.py
Database redesign Stage 5b: money columns are exact NUMERIC in the database and plain floats in Python (finance/money.py).
Migration 0063 converts the ledger and bank account columns and stops with a list when a value would be rounded.
"""
import os
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import Numeric

from db import get_db_context
from finance.models import FinanceBankAccountDB, LedgerTransactionDB
from finance.money import Money, Rate

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_money_types_hand_floats_to_the_application():
    assert isinstance(Money, Numeric) and (Money.precision, Money.scale, Money.asdecimal) == (18, 4, False)
    assert isinstance(Rate, Numeric) and (Rate.precision, Rate.scale, Rate.asdecimal) == (18, 8, False)


def test_ledger_and_account_columns_use_them():
    ledger = LedgerTransactionDB.__table__.c
    for name in ("amount", "tax_amount", "base_amount", "memo_gross_amount", "memo_fee_amount", "running_balance"):
        assert (ledger[name].type.precision, ledger[name].type.scale) == (18, 4), name
    assert (ledger["fx_rate"].type.precision, ledger["fx_rate"].type.scale) == (18, 8)
    account = FinanceBankAccountDB.__table__.c
    for name in ("opening_balance", "current_balance"):
        assert (account[name].type.precision, account[name].type.scale) == (18, 4), name


def test_the_application_still_reads_floats(app_client, admin_cookies):
    resp = app_client.post("/api/finance/accounts", json={
        "account_name": "Money Acc", "bank_name": "B", "account_number": "MONEY-1", "currency": "USD", "opening_balance": 100.25,
    }, cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    acc = resp.json()["id"]
    tx = app_client.post(f"/api/finance/accounts/{acc}/transactions", json={
        "date": "2026-01-05", "amount": 10.1, "direction": "out", "currency": "USD", "description": "t",
    }, cookies=admin_cookies)
    assert tx.status_code in (200, 201), tx.text
    with get_db_context() as db:
        row = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.account_id == acc).first()
        account = db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == acc).first()
        assert type(row.amount) is float and type(row.running_balance) is float and type(account.current_balance) is float
        assert round(account.current_balance, 4) == 90.15


# --- migration 0063 ---------------------------------------------------------------------------------------------

def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _decl(path, table, column):
    with sqlite3.connect(path) as conn:
        return next(r[2] for r in conn.execute(f"PRAGMA table_info({table})") if r[1] == column).upper()


def test_migration_0063_changes_the_declared_types_and_back(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    assert _decl(path, "finance_ledger_transactions", "amount") == "NUMERIC(18, 4)"
    assert _decl(path, "finance_ledger_transactions", "fx_rate") == "NUMERIC(18, 8)"
    assert _decl(path, "finance_bank_accounts", "current_balance") == "NUMERIC(18, 4)"
    _alembic(url, "downgrade", "0062_schema_parity")
    assert _decl(path, "finance_ledger_transactions", "amount") == "FLOAT"
    assert _decl(path, "finance_bank_accounts", "current_balance") == "FLOAT"
    _alembic(url, "upgrade", "head")


def test_migration_0063_stops_and_lists_values_that_would_be_rounded(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0062_schema_parity")
    if _decl(path, "finance_ledger_transactions", "amount") != "FLOAT":
        pytest.skip("this chain already builds the column as NUMERIC, so a too-precise value cannot be planted")
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT OR IGNORE INTO finance_books (id, code, name, is_default) VALUES (1, 'local', 'Local', 1)")
        conn.execute("INSERT INTO finance_bank_accounts (id, account_name, bank_name, account_number, currency, account_type, book_id, "
                     "opening_balance, current_balance) VALUES (1, 'A', 'B', 'N', 'USD', 'bank', 1, 0, 0)")
        conn.execute("INSERT INTO finance_ledger_transactions (account_id, date, amount, direction, currency, source, running_balance, "
                     "reference, description, entry_type) VALUES (1, '2026-01-01', 10.123456, 'in', 'USD', 'manual', 0, '', '', 'standard')")
        conn.execute("INSERT INTO finance_ledger_transactions (account_id, date, amount, direction, currency, source, running_balance, "
                     "reference, description, entry_type) VALUES (1, '2026-01-02', 5.5, 'in', 'USD', 'manual', 0, '', '', 'standard')")
        conn.commit()
    done = _alembic(url, "upgrade", "head", expect_ok=False)
    assert done.returncode != 0
    assert "finance_ledger_transactions.amount: 1 value(s) have more than 4 decimals" in done.stderr
    assert _decl(path, "finance_ledger_transactions", "amount") == "FLOAT"   # nothing was changed
