"""
be/tests/test_payroll_flows_real_tax.py
The employee payment-flows report (payable-status) shows the employee's real tax and social insurance from each payroll
line, not the always-zero `tax_amount` column. Migration 0060 drops that column.
"""
import os
import sqlite3
import subprocess
import sys

from db import get_db_context
from finance.models import PayrollLineDB, PayrollRunDB, StatutoryObligationDB

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "/api/finance/reports/payroll/payable-status?period=2033-04"


def _employee(email):
    from models_db import EmployeeDB
    with get_db_context() as db:
        emp = EmployeeDB(name="Flow Tester", email=email)
        db.add(emp)
        db.commit()
        return emp.id


def _run_with_line(emp_id, tax_usd, si_usd, net=1000.0):
    with get_db_context() as db:
        run = PayrollRunDB(period_label="2033-04", period_start="2033-04-01", period_end="2033-04-30", status="finalized", currency="USD")
        db.add(run)
        db.flush()
        db.add(PayrollLineDB(
            payroll_run_id=run.id, employee_id=emp_id, employee_name="Flow Tester", compensation_type="internal_usd_cash",
            base_salary=net, net_pay=net, deductions_total=0.0,   # NET basis: nothing is deducted from the employee
            employee_tax_usd_equivalent=tax_usd, employee_social_insurance_usd_equivalent=si_usd,
        ))
        db.commit()
        return run.id


def test_flows_report_shows_the_real_employee_tax_and_insurance(app_client, admin_cookies):
    emp = _employee("flows1@hrflow.test")
    _run_with_line(emp, tax_usd=12.5, si_usd=7.0)
    body = app_client.get(URL, cookies=admin_cookies).json()
    row = next(e for e in body["employee_breakdown"] if e["employee_id"] == emp)
    assert row["tax_pending"] == 12.5 and row["tax_settled"] == 0.0
    assert row["insurance_pending"] == 7.0 and row["insurance_settled"] == 0.0


def test_remittance_moves_the_employee_share_from_pending_to_settled(app_client, admin_cookies):
    emp = _employee("flows2@hrflow.test")
    run_id = _run_with_line(emp, tax_usd=100.0, si_usd=0.0)
    with get_db_context() as db:
        db.add(StatutoryObligationDB(obligation_type="income_tax", period="2033-04", amount_accrued=100.0, amount_remitted=40.0,
                                     currency="USD", status="partially_remitted", source_type="payroll_run", source_id=run_id))
        db.commit()
    row = next(e for e in app_client.get(URL, cookies=admin_cookies).json()["employee_breakdown"] if e["employee_id"] == emp)
    assert row["tax_settled"] == 40.0 and row["tax_pending"] == 60.0


def test_the_line_model_derives_tax_amount():
    assert "tax_amount" not in {c.name for c in PayrollLineDB.__table__.columns}
    assert PayrollLineDB(employee_tax_usd_equivalent=9.25).tax_amount == 9.25
    assert PayrollLineDB().tax_amount == 0.0


# --- migration 0060 ---------------------------------------------------------------------------------------------

def _alembic(url, *args):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-1500:]


def _cols(path):
    with sqlite3.connect(path) as conn:
        return {r[1] for r in conn.execute("PRAGMA table_info(finance_payroll_lines)")}


def test_migration_0060_drops_tax_amount_and_downgrade_refills_it(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0059_employee_pay_history_restrict")
    with sqlite3.connect(path) as conn:
        if "tax_amount" not in _cols(path):
            conn.execute("ALTER TABLE finance_payroll_lines ADD COLUMN tax_amount FLOAT DEFAULT 0.0")
        conn.execute("INSERT INTO employees (id, name, email) VALUES (1, 'E', 'e@hrflow.test')")
        conn.execute("INSERT INTO finance_payroll_runs (id, period_label, period_start, period_end, status) VALUES (1, '2033-05', '2033-05-01', '2033-05-31', 'draft')")
        conn.execute("INSERT INTO finance_payroll_lines (payroll_run_id, employee_id, employee_tax_usd_equivalent, tax_amount) VALUES (1, 1, 8.5, 0.0)")
        conn.commit()
    _alembic(url, "upgrade", "head")
    assert "tax_amount" not in _cols(path)
    _alembic(url, "downgrade", "0059_employee_pay_history_restrict")
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT tax_amount FROM finance_payroll_lines").fetchone() == (8.5,)
