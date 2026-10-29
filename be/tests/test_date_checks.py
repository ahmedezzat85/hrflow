"""
be/tests/test_date_checks.py
Stage 5b-4: date columns are checked by the database (finance/date_checks.py), migration 0067 adds the checks and stops with a list
when existing values are not dates. The PostgreSQL-only no-overlap constraints are covered by the manual PostgreSQL run in the PR.
"""
import importlib.util
import os
import re
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import String, text
from sqlalchemy.exc import IntegrityError

import models_db  # noqa: F401 - registers every model and attaches the checks
from db import Base, get_db_context
from finance import date_checks

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _migration():
    path = os.path.join(BE_DIR, "migrations", "versions", "0067_date_checks.py")
    spec = importlib.util.spec_from_file_location("mig_0067", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_list_covers_every_date_column_of_the_models():
    found = {}
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, String) and (col.type.length or 0) in (10, 20) and re.search(
                    r"(^date$|_date$|^period_start$|^period_end$|^effective_from$)", col.name):
                found.setdefault(table.name, set()).add(col.name)
    found["salary_payment_docs"].discard("invoice_date")      # printed on the document ("05 Nov 2026"), not an ISO date
    found = {t: cols for t, cols in found.items() if cols}
    listed = {t: set(cols) for t, cols in date_checks.DATE_COLUMNS.items()}
    assert found == listed, "Add the new date column to finance/date_checks.py and to a migration"


def test_every_check_is_attached_to_its_table_and_the_migration_copy_matches():
    mig = _migration()
    # migration 0067 holds the first 40 columns; later migrations add one each (0070: employees.left_date)
    later = {"employees": {"left_date": True}}
    assert {t: {**c, **later.get(t, {})} for t, c in mig.DATE_COLUMNS.items()} == date_checks.DATE_COLUMNS
    for (table, column), (name, expression) in date_checks.all_checks().items():
        assert name == mig._name(table, column)
        assert expression == mig._expression(column, date_checks.DATE_COLUMNS[table][column])
        assert name in {c.name for c in Base.metadata.tables[table].constraints}, name
    assert len({n for n, _ in date_checks.all_checks().values()}) == 41   # names stay unique after cutting to 63 characters


def test_the_database_refuses_malformed_dates(app_client):
    with get_db_context() as db:
        db.execute(text("INSERT INTO employees (id, name, email, join_date) VALUES (8001, 'D', 'd8001@hrflow.test', '')"))   # empty is allowed
        db.commit()
        for bad in ("26-01-05", "2026/01/05", "2026-13-01", "2026-01-32", "yesterday", "2026-1-5", "20260105"):
            with pytest.raises(IntegrityError):
                db.execute(text("INSERT INTO salary_history (employee_id, date, reason) VALUES (8001, :d, 'x')"), {"d": bad})
                db.commit()
            db.rollback()
        db.execute(text("INSERT INTO salary_history (employee_id, date, reason) VALUES (8001, '2026-01-05', 'ok')"))
        db.commit()
        with pytest.raises(IntegrityError):    # a required date cannot be empty
            db.execute(text("INSERT INTO salary_history (employee_id, date, reason) VALUES (8001, '', 'x')"))
            db.commit()
        db.rollback()


def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _table_sql(path, table):
    with sqlite3.connect(path) as conn:
        return conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone()[0]


def test_migration_0067_adds_and_drops_the_checks(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    assert "ck_dt_salary_history_date" in _table_sql(path, "salary_history")
    assert "ck_dt_finance_payroll_runs_period_start" in _table_sql(path, "finance_payroll_runs")
    _alembic(url, "downgrade", "0066_money_remaining")
    assert "ck_dt_salary_history_date" not in _table_sql(path, "salary_history")
    _alembic(url, "upgrade", "head")


def test_migration_0067_stops_and_lists_values_that_are_not_dates(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    _alembic(url, "downgrade", "0066_money_remaining")
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO employees (id, name, email) VALUES (1, 'E', 'e@hrflow.test')")
        conn.execute("INSERT INTO salary_history (employee_id, date, reason) VALUES (1, '05/01/2026', 'x')")
        conn.execute("INSERT INTO salary_history (employee_id, date, reason) VALUES (1, '2026-01-05', 'ok')")
        conn.commit()
    done = _alembic(url, "upgrade", "head", expect_ok=False)
    assert done.returncode != 0 and "salary_history.date: 1 value(s) are not a YYYY-MM-DD date" in done.stderr
    assert "ck_dt_salary_history_date" not in _table_sql(path, "salary_history")


def test_an_employee_with_a_malformed_join_date_is_a_422_not_a_500(app_client, admin_cookies):
    body = {"name": "Join Date", "email": "joindate@hrflow.test", "legal_name": "Join Date", "phone": "01000000000", "address_line_1": "1 St"}
    bad = app_client.post("/api/employees", json={**body, "join_date": "05/01/2026"}, cookies=admin_cookies)
    assert bad.status_code == 422 and "YYYY-MM-DD" in bad.text
    ok = app_client.post("/api/employees", json={**body, "join_date": "2026-01-05"}, cookies=admin_cookies)
    assert ok.status_code in (200, 201)


def test_a_database_rule_refusal_is_a_409_without_details(app_client, admin_cookies):
    # a ledger date the API does not validate: the database check refuses it and the handler answers 409, not 500
    acc = app_client.post("/api/finance/accounts", json={"account_name": "Date Acc", "bank_name": "B", "account_number": "DATE-1",
                                                         "currency": "USD", "opening_balance": 10.0}, cookies=admin_cookies).json()["id"]
    resp = app_client.post(f"/api/finance/accounts/{acc}/transactions", json={
        "date": "yesterday", "amount": 1.0, "direction": "out", "currency": "USD", "description": "t"}, cookies=admin_cookies)
    assert resp.status_code in (409, 422), resp.text
    assert "sqlite" not in resp.text.lower() and "constraint" not in resp.text.lower()
