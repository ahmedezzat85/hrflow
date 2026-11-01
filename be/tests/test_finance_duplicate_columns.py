"""
be/tests/test_finance_duplicate_columns.py
Database redesign Stage 2a: the repeated finance columns are gone, the API keeps its fields, and migration 0051
upgrades and downgrades cleanly.
"""
import os
import sqlite3
import subprocess
import sys

from finance.models import FinanceChequeDB, PayrollRunDB, PayrollSettingsDB

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_columns_are_gone_from_the_models():
    assert "bank_account_id" not in {c.name for c in PayrollRunDB.__table__.columns}
    assert not {"employee_rate", "employer_rate"} & {c.name for c in PayrollSettingsDB.__table__.columns}
    assert "attachment_url" not in {c.name for c in FinanceChequeDB.__table__.columns}


def test_settings_endpoint_reports_the_dated_rates(app_client, admin_cookies):
    body = app_client.get("/api/finance/payroll/settings", cookies=admin_cookies).json()
    assert (body["employee_rate"], body["employer_rate"]) == (0.11, 0.18)
    saved = app_client.post("/api/finance/payroll/settings/rates",
                            json={"effective_from": "2099-01-01", "employee_rate": 0.12, "employer_rate": 0.2},
                            cookies=admin_cookies)
    assert saved.status_code == 200, saved.text
    rates = app_client.get("/api/finance/payroll/settings/rates", cookies=admin_cookies).json()
    assert {r["effective_from"] for r in rates} >= {"2000-01-01", "2099-01-01"}


# --- migration 0051 ---------------------------------------------------------------------------------------------

def _alembic(url, *args):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-1500:]


def _cols(path, table):
    with sqlite3.connect(path) as conn:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_migration_0051_moves_data_then_drops_and_downgrade_refills(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0050_employee_derived_data")
    with sqlite3.connect(path) as conn:
        # Migration 0013 builds missing tables from the current models, so a fresh chain never had these columns.
        # Add them back to look like an existing database that does.
        for table, column, ddl in (
            ("finance_payroll_runs", "bank_account_id", "INTEGER"),
            ("finance_payroll_settings", "employee_rate", "FLOAT NOT NULL DEFAULT 0.11"),
            ("finance_payroll_settings", "employer_rate", "FLOAT NOT NULL DEFAULT 0.18"),
            ("finance_cheques", "attachment_url", "VARCHAR(500)"),
        ):
            if column not in _cols(path, table):
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
        conn.execute("INSERT OR IGNORE INTO finance_books (id, code, name, is_default) VALUES (1, 'local', 'Local', 1)")
        conn.execute("INSERT INTO finance_bank_accounts (id, account_name, bank_name, account_number, currency, account_type, book_id) "
                     "VALUES (7, 'Ext', 'Bank', 'A-7', 'USD', 'bank', 1)")
        conn.execute("INSERT INTO finance_payroll_runs (id, period_label, period_start, period_end, status, bank_account_id) "
                     "VALUES (1, '2026-01', '2026-01-01', '2026-01-31', 'paid', 7)")
        conn.execute("DELETE FROM finance_payroll_settings")
        conn.execute("DELETE FROM finance_payroll_rate_settings")
        conn.execute("INSERT INTO finance_payroll_settings (id, employee_rate, employer_rate) VALUES (1, 0.1, 0.2)")
        conn.commit()

    _alembic(url, "upgrade", "head")
    assert "bank_account_id" not in _cols(path, "finance_payroll_runs")
    assert not {"employee_rate", "employer_rate"} & _cols(path, "finance_payroll_settings")
    assert "attachment_url" not in _cols(path, "finance_cheques")
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT external_funding_account_id FROM finance_payroll_runs WHERE id = 1").fetchone() == (7,)
        assert conn.execute("SELECT effective_from, employee_rate, employer_rate FROM finance_payroll_rate_settings").fetchall() == [("2000-01-01", 0.1, 0.2)]

    _alembic(url, "downgrade", "0050_employee_derived_data")
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT bank_account_id FROM finance_payroll_runs WHERE id = 1").fetchone() == (7,)
        assert conn.execute("SELECT employee_rate, employer_rate FROM finance_payroll_settings").fetchone() == (0.1, 0.2)
    assert "attachment_url" in _cols(path, "finance_cheques")
