"""
be/tests/test_employee_derived_data.py
Database redesign Stage 1: vac_used and next_raise are derived, the dropped columns are gone from the schema, and
migration 0050 upgrades and downgrades cleanly.
"""
import os
import sqlite3
import subprocess
import sys
from datetime import date

import pytest

from db import Base, get_db_context, reset_engine_for_testing
from models_db import EmployeeDB, SalaryHistoryDB, VacationHistoryDB
from services.employee_derived import next_raise_map, vacation_days_used_map

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YEAR = date.today().year


@pytest.fixture
def db(tmp_path):
    reset_engine_for_testing(f"sqlite:///{tmp_path / 'derived.db'}")
    from db import get_engine
    Base.metadata.create_all(bind=get_engine())
    with get_db_context() as session:
        session.add_all([
            EmployeeDB(id=1, name="A", email="a@hrflow.test"),
            EmployeeDB(id=2, name="B", email="b@hrflow.test"),
        ])
        session.commit()
        yield session
    reset_engine_for_testing(None)


def _vac(db, emp, start, days, status="Approved", type_="Annual Leave"):
    db.add(VacationHistoryDB(employee_id=emp, type=type_, start_date=start, end_date=start, days=days, status=status))
    db.commit()


def test_employee_columns_are_gone_from_the_model():
    cols = {c.name for c in EmployeeDB.__table__.columns}
    assert not cols & {"vac_used", "next_raise", "role"}


def test_document_url_columns_are_gone_from_the_model():
    from models_db import CompanyDocumentDB, EmployeeDocumentDB
    for model in (EmployeeDocumentDB, CompanyDocumentDB):
        assert not {c.name for c in model.__table__.columns} & {"view_url", "download_url"}


def test_vac_used_counts_only_approved_annual_leave_this_year(db):
    _vac(db, 1, f"{YEAR}-02-01", 3)
    _vac(db, 1, f"{YEAR}-03-01", 2)
    _vac(db, 1, f"{YEAR}-04-01", 9, status="Pending")
    _vac(db, 1, f"{YEAR}-05-01", 4, type_="Sick Leave")
    _vac(db, 1, f"{YEAR - 1}-12-30", 5)
    _vac(db, 1, f"{YEAR + 1}-01-02", 6)
    assert vacation_days_used_map(db, [1, 2]) == {1: 5}


def test_vac_used_treats_a_missing_type_as_annual_leave(db):
    _vac(db, 2, f"{YEAR}-06-01", 2, type_="")
    assert vacation_days_used_map(db, [2]) == {2: 2}


def test_next_raise_is_one_year_after_the_latest_pay_change(db):
    db.add_all([
        SalaryHistoryDB(employee_id=1, date="2025-01-01", reason="a"),
        SalaryHistoryDB(employee_id=1, date="2026-03-01", reason="b"),
    ])
    db.commit()
    assert next_raise_map(db, [1, 2]) == {1: "2027-03-01"}


def test_empty_id_lists_are_cheap_and_empty(db):
    assert vacation_days_used_map(db, []) == {}
    assert next_raise_map(db, []) == {}


def test_api_keeps_the_derived_field_names(app_client, admin_cookies):
    with get_db_context() as session:
        emp = session.query(EmployeeDB).first()
        emp_id = emp.id
        session.add(VacationHistoryDB(employee_id=emp_id, type="Annual Leave", start_date=f"{YEAR}-01-10",
                                      end_date=f"{YEAR}-01-12", days=3, status="Approved"))
        session.add(SalaryHistoryDB(employee_id=emp_id, date="2026-01-01", reason="raise"))
        session.commit()
    body = app_client.get(f"/api/employees/{emp_id}", cookies=admin_cookies).json()
    assert body["vac_used"] == 3
    assert body["next_raise"] == "2027-01-01"
    assert "role" not in body


# --- migration 0050 ---------------------------------------------------------------------------------------------

def _alembic(url, *args):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-1500:]


def _cols(path, table):
    with sqlite3.connect(path) as conn:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_migration_0050_drops_columns_and_downgrade_refills_them(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0049_history_amounts_derived")
    assert {"vac_used", "next_raise", "role"} <= _cols(path, "employees")
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO employees (id, name, email, vac_used, next_raise, role) "
                     "VALUES (1, 'A', 'a@hrflow.test', 9, '2030-01-01', 'admin')")
        conn.execute("INSERT INTO salary_history (employee_id, date, reason) VALUES (1, '2026-02-01', 'r')")
        conn.execute("INSERT INTO vacation_history (employee_id, type, start_date, end_date, days, status) "
                     f"VALUES (1, 'Annual Leave', '{YEAR}-05-01', '{YEAR}-05-02', 2, 'Approved')")
        conn.execute("INSERT INTO employee_documents (employee_id, name, file_type, drive_file_id, view_url, download_url) "
                     "VALUES (1, 'd', 'pdf', 'f1', 'http://v', 'http://d')")
        conn.commit()

    _alembic(url, "upgrade", "head")
    assert not {"vac_used", "next_raise", "role"} & _cols(path, "employees")
    assert not {"view_url", "download_url"} & _cols(path, "employee_documents")
    assert not {"view_url", "download_url"} & _cols(path, "company_documents")
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT drive_file_id FROM employee_documents").fetchone() == ("f1",)

    _alembic(url, "downgrade", "0049_history_amounts_derived")
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT vac_used, next_raise, role FROM employees WHERE id = 1").fetchone() == (2, "2027-02-01", "employee")
    assert {"view_url", "download_url"} <= _cols(path, "employee_documents")
