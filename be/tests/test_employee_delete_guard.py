"""
be/tests/test_employee_delete_guard.py
Database redesign Stage 4b: an employee with pay or payroll history cannot be deleted (readable 409 first, database
RESTRICT behind it); an employee without it still can.
"""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from db import get_db_context
from pay_test_helpers import seed_plan


def _new_employee(client, cookies, email):
    resp = client.post("/api/employees", json={
        "name": "Guard Test", "email": email, "legal_name": "Guard Test", "phone": "01000000000", "address_line_1": "1 Street",
    }, cookies=cookies)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def _count(table, emp_id):
    with get_db_context() as db:
        return db.execute(text(f"SELECT COUNT(*) FROM {table} WHERE employee_id = :e"), {"e": emp_id}).scalar()


def test_an_employee_without_pay_history_can_be_deleted(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "nohistory@hrflow.test")
    assert app_client.delete(f"/api/employees/{emp}", cookies=admin_cookies).status_code == 200


def test_an_employee_with_a_pay_plan_cannot_be_deleted(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "plan@hrflow.test")
    seed_plan(emp, internal=1000.0, external=500.0)
    resp = app_client.delete(f"/api/employees/{emp}", cookies=admin_cookies)
    assert resp.status_code == 409
    assert "pay plan rows" in resp.json()["detail"] and "Suspended" in resp.json()["detail"]
    assert _count("finance_employee_compensation_plans", emp) == 2   # nothing was deleted
    assert app_client.get(f"/api/employees/{emp}", cookies=admin_cookies).status_code == 200


@pytest.mark.parametrize("table,sql", [
    ("employee_tax_method", "INSERT INTO employee_tax_method (employee_id, method, effective_start_date, notes) VALUES (:e, 'progressive', '2026-01-01', '')"),
    ("employee_social_insurance", "INSERT INTO employee_social_insurance (employee_id, insured_flag, currency, effective_start_date, notes) VALUES (:e, 1, 'EGP', '2026-01-01', '')"),
])
def test_tax_method_and_social_insurance_history_also_block_the_delete(app_client, admin_cookies, table, sql):
    emp = _new_employee(app_client, admin_cookies, f"{table}@hrflow.test")
    with get_db_context() as db:
        db.execute(text(sql), {"e": emp})
        db.commit()
    assert app_client.delete(f"/api/employees/{emp}", cookies=admin_cookies).status_code == 409
    assert _count(table, emp) == 1


@pytest.mark.parametrize("table", ["employee_tax_method", "employee_social_insurance", "finance_employee_compensation_plans"])
def test_the_database_refuses_to_delete_an_employee_with_that_history(app_client, admin_cookies, table):
    emp = _new_employee(app_client, admin_cookies, f"raw-{table}@hrflow.test")
    inserts = {
        "employee_tax_method": "INSERT INTO employee_tax_method (employee_id, method, effective_start_date, notes) VALUES (:e, 'progressive', '2026-01-01', '')",
        "employee_social_insurance": "INSERT INTO employee_social_insurance (employee_id, insured_flag, currency, effective_start_date, notes) VALUES (:e, 1, 'EGP', '2026-01-01', '')",
        "finance_employee_compensation_plans": "INSERT INTO finance_employee_compensation_plans (employee_id, component_type, amount, currency, salary_basis, effective_start_date, notes) VALUES (:e, 'external_usd', 1, 'USD', 'NET', '2026-01-01', '')",
    }
    with get_db_context() as db:
        db.execute(text(inserts[table]), {"e": emp})
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(text("DELETE FROM employees WHERE id = :e"), {"e": emp})
            db.commit()
        db.rollback()


# --- migration 0059 ---------------------------------------------------------------------------------------------

def _alembic(url, *args):
    import subprocess
    import sys
    import os
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          env=dict(os.environ, DATABASE_URL=url), capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-1500:]


def _ondelete(path, table):
    import sqlite3
    with sqlite3.connect(path) as conn:
        return {r[2]: r[6] for r in conn.execute(f"PRAGMA foreign_key_list({table})")}.get("employees")


def test_migration_0059_switches_the_two_tables_to_restrict_and_back(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    for table in ("employee_tax_method", "employee_social_insurance"):
        assert _ondelete(path, table) == "RESTRICT"
    _alembic(url, "downgrade", "0058_value_checks")
    for table in ("employee_tax_method", "employee_social_insurance"):
        assert _ondelete(path, table) == "CASCADE"
    _alembic(url, "upgrade", "head")
    assert _ondelete(path, "employee_tax_method") == "RESTRICT"
