"""
be/tests/test_payroll_line_cleanup.py
Database redesign Stage 3: payroll line columns that repeated others are derived, and the two missing foreign keys
exist. Migration 0055 upgrades and downgrades cleanly and refuses orphan adjustments.
"""
import os
import sqlite3
import subprocess
import sys

import pytest

import models_db  # noqa: F401 - registers every model so relationships resolve
from finance.models import PayrollAdjustmentDB, PayrollLineDB

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_columns_are_gone_and_values_are_derived():
    cols = {c.name for c in PayrollLineDB.__table__.columns}
    assert not cols & {"tax_employee_si_egp", "total_social_insurance_egp"}
    line = PayrollLineDB(employee_social_insurance_egp=110.005, employer_social_insurance_egp=180.0)
    assert line.total_social_insurance_egp == 290.0 or abs(line.total_social_insurance_egp - 290.0) < 0.011
    assert line.tax_employee_si_egp == 110.005
    assert PayrollLineDB().total_social_insurance_egp is None


def test_foreign_keys_are_declared():
    line_fks = {fk.parent.name: fk.column.table.name for fk in PayrollLineDB.__table__.foreign_keys}
    assert line_fks["tax_settings_version_id"] == "finance_payroll_tax_settings"
    adj_fks = {fk.parent.name: fk.column.table.name for fk in PayrollAdjustmentDB.__table__.foreign_keys}
    assert adj_fks["employee_id"] == "employees"


def test_api_keeps_the_derived_field_names(app_client, admin_cookies):
    # The payroll preview/run payloads still carry both names, filled from the employee and employer amounts.
    from finance.services.payroll_service import PayrollService
    source = open(os.path.join(BE_DIR, "finance", "services", "payroll_service.py"), encoding="utf-8").read()
    assert '"tax_employee_si_egp": l.tax_employee_si_egp' in source
    assert '"total_social_insurance_egp": l.total_social_insurance_egp' in source
    assert PayrollService is not None


# --- migration 0055 ---------------------------------------------------------------------------------------------

def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _cols(path, table):
    with sqlite3.connect(path) as conn:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def _seed(conn):
    conn.execute("INSERT INTO employees (id, name, email) VALUES (1, 'E', 'e@hrflow.test')")
    conn.execute("INSERT INTO finance_payroll_runs (id, period_label, period_start, period_end, status) "
                 "VALUES (1, '2026-01', '2026-01-01', '2026-01-31', 'draft')")
    conn.execute("INSERT INTO finance_payroll_lines (id, payroll_run_id, employee_id, employee_social_insurance_egp, "
                 "employer_social_insurance_egp, total_social_insurance_egp, tax_employee_si_egp, tax_settings_version_id) "
                 "VALUES (1, 1, 1, 100, 180, 280, 100, 999)")  # 999: a tax settings version that does not exist


def test_migration_0055_drops_derives_and_adds_foreign_keys(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0054_payment_ledger_link")
    with sqlite3.connect(path) as conn:
        for column in ("total_social_insurance_egp", "tax_employee_si_egp"):
            if column not in _cols(path, "finance_payroll_lines"):
                conn.execute(f"ALTER TABLE finance_payroll_lines ADD COLUMN {column} FLOAT DEFAULT 0")
        _seed(conn)
        conn.commit()

    _alembic(url, "upgrade", "head")
    assert not {"total_social_insurance_egp", "tax_employee_si_egp"} & _cols(path, "finance_payroll_lines")
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT tax_settings_version_id FROM finance_payroll_lines WHERE id = 1").fetchone() == (None,)
        fks = {(r[2], r[3]) for r in conn.execute("PRAGMA foreign_key_list(finance_payroll_lines)")}
        assert ("finance_payroll_tax_settings", "tax_settings_version_id") in fks
        fks = {(r[2], r[3]) for r in conn.execute("PRAGMA foreign_key_list(finance_payroll_adjustments)")}
        assert ("employees", "employee_id") in fks

    _alembic(url, "downgrade", "0054_payment_ledger_link")
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT total_social_insurance_egp, tax_employee_si_egp FROM finance_payroll_lines").fetchone() == (280.0, 100.0)


def test_migration_0055_refuses_adjustments_for_missing_employees(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0054_payment_ledger_link")
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO finance_payroll_adjustments (id, employee_id, type, direction, amount, currency, payment_source, "
                     "effective_period, origin, status) VALUES ('adj_x', 4242, 'BONUS', 'ADDITION', 10, 'USD', 'INT', '2026-01', 'MANUAL', 'DRAFT')")
        conn.commit()
    done = _alembic(url, "upgrade", "head", expect_ok=False)
    assert done.returncode != 0 and "adj_x" in done.stderr
