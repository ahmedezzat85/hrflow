"""
be/tests/test_money_columns_remaining.py
Stage 5b-3b: the remaining money columns are exact NUMERIC (finance/money.py), so no money column in the database is a float any
more; migration 0066 converts them and stops with a list when a value would be rounded.
"""
import os
import sqlite3
import subprocess
import sys

import models_db  # noqa: F401 - registers every model
from db import Base
from sqlalchemy import Float

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Float columns that are not money
NOT_MONEY = {("finance_bills", "extraction_confidence")}


def test_no_money_column_is_a_float_any_more():
    left = sorted((t.name, c.name) for t in Base.metadata.tables.values() for c in t.columns
                  if isinstance(c.type, Float) and (t.name, c.name) not in NOT_MONEY)
    assert not left, f"These columns are still floats; use the Money / Rate types in finance/money.py: {left}"


def test_the_converted_columns_have_the_expected_precision():
    tables = Base.metadata.tables
    assert (tables["finance_account_transfers"].c.fx_rate.type.scale, tables["finance_account_transfers"].c.fee.type.scale) == (8, 4)
    assert tables["employee_tax_method"].c.flat_rate.type.scale == 8
    assert tables["finance_statutory_obligations"].c.amount_accrued.type.scale == 4
    assert tables["insurance_claims"].c.amount.type.scale == 4


def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _decl(path, table, column):
    with sqlite3.connect(path) as conn:
        return next(r[2] for r in conn.execute(f"PRAGMA table_info({table})") if r[1] == column).upper()


def test_migration_0066_changes_the_declared_types_and_back(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    assert _decl(path, "insurance_claims", "amount") == "NUMERIC(18, 4)"
    assert _decl(path, "employee_tax_method", "flat_rate") == "NUMERIC(18, 8)"
    assert _decl(path, "finance_account_transfers", "fx_rate") == "NUMERIC(18, 8)"
    _alembic(url, "downgrade", "0065_money_payroll")
    assert _decl(path, "insurance_claims", "amount") == "FLOAT"
    assert _decl(path, "finance_statutory_obligations", "amount_accrued") == "FLOAT"
    _alembic(url, "upgrade", "head")


def test_migration_0066_stops_and_lists_values_that_would_be_rounded(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    _alembic(url, "downgrade", "0065_money_payroll")      # a fresh chain builds these tables NUMERIC already; go back to floats
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO insurance_categories (id, name, annual_limit) VALUES (1, 'Dental', 1000.123456)")
        conn.commit()
    done = _alembic(url, "upgrade", "head", expect_ok=False)
    assert done.returncode != 0 and "insurance_categories.annual_limit: 1 value(s) have more than 4 decimals" in done.stderr
    assert _decl(path, "insurance_categories", "annual_limit") == "FLOAT"
