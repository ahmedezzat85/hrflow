"""
be/tests/test_employee_left_date.py
Archiving can carry the real last day of employment (employees.left_date, migration 0070): the employee's open pay rows end on it,
so historical payroll runs after it leave them out. archived_at stays the moment the record was archived.
"""
import os
import sqlite3
import subprocess
import sys

from db import get_db_context
from finance.models import EmployeeCompensationPlanDB
from finance.services.payroll_service import PayrollService
from models_db import EmployeeSocialInsuranceDB, EmployeeTaxMethodDB
from fx_test_helpers import seed_usd_egp_rate
from pay_test_helpers import seed_plan

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _new_employee(client, cookies, email):
    resp = client.post("/api/employees", json={
        "name": "Left Date", "email": email, "legal_name": "Left Date", "phone": "01000000000", "address_line_1": "1 Street",
    }, cookies=cookies)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def _plan_end(emp):
    with get_db_context() as db:
        return sorted((r.effective_start_date, r.effective_end_date) for r in
                      db.query(EmployeeCompensationPlanDB).filter(EmployeeCompensationPlanDB.employee_id == emp).all())


def _run_ids(year, month, last_day):
    with get_db_context() as db:
        p = PayrollService(db).preview_run(period_label=f"{year}-{month:02d}", period_start=f"{year}-{month:02d}-01",
                                           period_end=f"{year}-{month:02d}-{last_day}")
        return {line["employee_id"] for line in p["lines"]}


def test_archiving_with_a_left_date_ends_the_open_pay_rows_there(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "left1@hrflow.test")
    seed_usd_egp_rate(50.0)
    seed_plan(emp, external=500.0, start="2025-01-01")
    with get_db_context() as db:
        db.add(EmployeeSocialInsuranceDB(employee_id=emp, insured_flag=True, effective_start_date="2025-01-01"))
        db.add(EmployeeTaxMethodDB(employee_id=emp, method="progressive", effective_start_date="2025-01-01"))
        db.commit()
    assert emp in _run_ids(2025, 9, 30)

    done = app_client.post(f"/api/employees/{emp}/archive", json={"left_date": "2025-06-30"}, cookies=admin_cookies)
    assert done.status_code == 200, done.text
    body = app_client.get(f"/api/employees/{emp}", cookies=admin_cookies).json()
    assert body["left_date"] == "2025-06-30" and body["archived"] is True
    assert body["archived_at"] and not body["archived_at"].startswith("2025-06-30")      # still the moment it was archived

    assert _plan_end(emp) == [("2025-01-01", "2025-06-30")]
    with get_db_context() as db:
        assert db.query(EmployeeSocialInsuranceDB).filter_by(employee_id=emp).one().effective_end_date == "2025-06-30"
        assert db.query(EmployeeTaxMethodDB).filter_by(employee_id=emp).one().effective_end_date == "2025-06-30"
    assert emp in _run_ids(2025, 6, 30) and emp not in _run_ids(2025, 9, 30)      # historical runs after the left date skip them


def test_rows_that_already_end_earlier_are_kept_and_unarchive_clears_the_left_date(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "left2@hrflow.test")
    seed_plan(emp, external=100.0, start="2024-01-01", end="2024-12-31")
    seed_plan(emp, external=200.0, start="2025-01-01")
    assert app_client.post(f"/api/employees/{emp}/archive", json={"left_date": "2025-03-31"}, cookies=admin_cookies).status_code == 200
    assert _plan_end(emp) == [("2024-01-01", "2024-12-31"), ("2025-01-01", "2025-03-31")]

    back = app_client.post(f"/api/employees/{emp}/unarchive", cookies=admin_cookies)
    assert back.status_code == 200
    assert app_client.get(f"/api/employees/{emp}", cookies=admin_cookies).json()["left_date"] == ""
    assert _plan_end(emp) == [("2024-01-01", "2024-12-31"), ("2025-01-01", "2025-03-31")]       # not reopened


def test_archiving_without_a_left_date_changes_no_pay_rows(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "left3@hrflow.test")
    seed_plan(emp, external=100.0, start="2025-01-01")
    assert app_client.post(f"/api/employees/{emp}/archive", cookies=admin_cookies).status_code == 200
    assert _plan_end(emp) == [("2025-01-01", None)]
    assert app_client.get(f"/api/employees/{emp}", cookies=admin_cookies).json()["left_date"] == ""


def test_a_bad_future_or_conflicting_left_date_is_refused_and_changes_nothing(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "left4@hrflow.test")
    seed_plan(emp, external=100.0, start="2025-01-01")
    seed_plan(emp, external=150.0, start="2025-09-01", end="2025-12-31")
    for bad in ("05/01/2026", "yesterday", "2999-01-01"):
        assert app_client.post(f"/api/employees/{emp}/archive", json={"left_date": bad}, cookies=admin_cookies).status_code == 422
    clash = app_client.post(f"/api/employees/{emp}/archive", json={"left_date": "2025-06-30"}, cookies=admin_cookies)
    assert clash.status_code == 409 and "start after 2025-06-30" in clash.text
    body = app_client.get(f"/api/employees/{emp}", cookies=admin_cookies).json()
    assert body["archived"] is False and body["left_date"] == ""
    assert _plan_end(emp) == [("2025-01-01", None), ("2025-09-01", "2025-12-31")]


def test_migration_0070_adds_and_drops_the_column(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"

    def alembic(*args):
        done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                              capture_output=True, text=True)
        assert done.returncode == 0, done.stderr[-1500:]

    def columns():
        with sqlite3.connect(path) as conn:
            return {r[1] for r in conn.execute("PRAGMA table_info(employees)")}, conn.execute(
                "SELECT sql FROM sqlite_master WHERE name = 'employees'").fetchone()[0]

    alembic("upgrade", "head")
    cols, sql = columns()
    assert "left_date" in cols and "ck_dt_employees_left_date" in sql
    alembic("downgrade", "0069_drop_ledger_category")
    cols, sql = columns()
    assert "left_date" not in cols and "ck_dt_employees_left_date" not in sql
    alembic("upgrade", "head")
