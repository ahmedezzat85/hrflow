"""
be/tests/test_payroll_base_pay_unique.py
Database redesign Stage 4b: one base pay line per employee, run and component; commission and bonus lines may repeat.
Migration 0057 adds the index and stops with a list when duplicates exist.
"""
import os
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from db import get_db_context

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINE = "INSERT INTO finance_payroll_lines (payroll_run_id, employee_id, compensation_type) VALUES (:r, :e, :t)"


def _run_and_employee(db, period, email):
    db.execute(text("INSERT INTO employees (name, email) VALUES ('E', :m)"), {"m": email})
    emp = db.execute(text("SELECT id FROM employees WHERE email = :m"), {"m": email}).scalar()
    db.execute(text("INSERT INTO finance_payroll_runs (period_label, period_start, period_end, status) "
                    "VALUES (:p, '2032-01-01', '2032-01-31', 'draft')"), {"p": period})
    run = db.execute(text("SELECT id FROM finance_payroll_runs WHERE period_label = :p"), {"p": period}).scalar()
    return run, emp


def test_a_base_pay_line_is_unique_but_commission_and_bonus_lines_repeat(app_client):
    with get_db_context() as db:
        run, emp = _run_and_employee(db, "2032-01", "bp1@hrflow.test")
        db.execute(text(LINE), {"r": run, "e": emp, "t": "internal_usd_cash"})
        db.execute(text(LINE), {"r": run, "e": emp, "t": "external_usd"})
        for _ in range(2):  # two deals, two bonuses: allowed by design
            db.execute(text(LINE), {"r": run, "e": emp, "t": "commission_sales"})
            db.execute(text(LINE), {"r": run, "e": emp, "t": "bonus"})
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(text(LINE), {"r": run, "e": emp, "t": "internal_usd_cash"})
            db.commit()
        db.rollback()


def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _has_index(path):
    with sqlite3.connect(path) as conn:
        return conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'uq_payroll_lines_base_pay'").fetchone() is not None


def _drop_index(path):
    with sqlite3.connect(path) as conn:
        conn.execute("DROP INDEX IF EXISTS uq_payroll_lines_base_pay")
        conn.commit()


def test_migration_0057_adds_the_index_and_downgrade_drops_it(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0056_integrity_constraints")
    _drop_index(path)
    _alembic(url, "upgrade", "head")
    assert _has_index(path)
    _alembic(url, "downgrade", "0056_integrity_constraints")
    assert not _has_index(path)


def test_migration_0057_stops_and_lists_duplicate_base_pay_lines(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0056_integrity_constraints")
    _drop_index(path)
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO employees (id, name, email) VALUES (1, 'E', 'e@hrflow.test')")
        conn.execute("INSERT INTO finance_payroll_runs (id, period_label, period_start, period_end, status) "
                     "VALUES (1, '2032-02', '2032-02-01', '2032-02-29', 'draft')")
        for _ in range(2):
            conn.execute("INSERT INTO finance_payroll_lines (payroll_run_id, employee_id, compensation_type) VALUES (1, 1, 'external_usd')")
        conn.commit()
    done = _alembic(url, "upgrade", "head", expect_ok=False)
    assert done.returncode != 0 and "run 1 / employee 1 / external_usd" in done.stderr
    assert not _has_index(path)
