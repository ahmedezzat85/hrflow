"""
be/tests/test_pay_single_source.py
PAY-1 (D-046): the compensation plan is the only stored source of pay.
- current_pay derives internal, external and total from the plan rows in force on a day
- the employee API, the employee export and salary history show what the plan says, even after a direct database edit
- migration 0048 drops the cached columns, logs differences, and can be reversed
"""
import importlib.util
import logging
import os
from datetime import date, timedelta

import sqlalchemy as sa

from db import get_db_context
from finance.current_pay import current_pay, current_pay_map
from finance.models import EmployeeCompensationPlanDB
from models_db import EmployeeDB, SalaryHistoryDB
from pay_test_helpers import seed_plan

TODAY = date.today().isoformat()
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()
TOMORROW = (date.today() + timedelta(days=1)).isoformat()


def _new_employee(email):
    with get_db_context() as db:
        emp = EmployeeDB(name="Pay Source", email=email, status="Active", join_date="2024-01-01")
        db.add(emp)
        db.commit()
        return emp.id


def test_columns_are_gone_from_the_model():
    for name in ("salary", "internal_salary_usd", "external_salary_usd"):
        assert not hasattr(EmployeeDB, name)
    for name in ("previous_salary", "new_salary", "previous_internal_usd", "previous_external_usd",
                 "new_internal_usd", "new_external_usd", "pct_change"):
        assert not hasattr(SalaryHistoryDB, name)


def test_current_pay_uses_only_rows_in_force_today(app_client):
    emp_id = _new_employee("inforce@hrflow.test")
    with get_db_context() as db:
        db.add_all([
            EmployeeCompensationPlanDB(employee_id=emp_id, component_type="internal_usd_cash", amount=1000.0,
                                       effective_start_date="2024-01-01", effective_end_date=YESTERDAY),   # closed
            EmployeeCompensationPlanDB(employee_id=emp_id, component_type="internal_usd_cash", amount=1500.0,
                                       effective_start_date=TODAY),                                        # in force
            EmployeeCompensationPlanDB(employee_id=emp_id, component_type="external_usd", amount=700.0,
                                       effective_start_date="2024-01-01"),                                 # in force
            EmployeeCompensationPlanDB(employee_id=emp_id, component_type="external_usd", amount=9999.0,
                                       effective_start_date=TOMORROW),                                     # future
        ])
        db.commit()
        assert current_pay(db, emp_id) == {"internal": 1500.0, "external": 700.0, "total": 2200.0}
        assert current_pay(db, emp_id, as_of="2024-06-01") == {"internal": 1000.0, "external": 700.0, "total": 1700.0}
        assert current_pay(db, emp_id, as_of="2023-01-01") == {"internal": 0.0, "external": 0.0, "total": 0.0}
        assert current_pay_map(db, [emp_id])[emp_id]["total"] == 2200.0
        assert current_pay_map(db, []) == {}


def test_a_direct_database_edit_of_the_plan_shows_in_the_employee_api(app_client, admin_cookies):
    """The bug that started D-046: a plan corrected straight in the database must be what the app shows."""
    emp_id = _new_employee("direct@hrflow.test")
    seed_plan(emp_id, internal=1000.0, external=2000.0)
    emp = app_client.get(f"/api/employees/{emp_id}", cookies=admin_cookies).json()
    assert (emp["internal_salary_usd"], emp["external_salary_usd"], emp["salary"]) == (1000.0, 2000.0, 3000.0)

    with get_db_context() as db:   # the "visual database tool" edit
        db.query(EmployeeCompensationPlanDB).filter_by(employee_id=emp_id, component_type="internal_usd_cash").update({"amount": 1250.0})
        db.commit()
    emp = app_client.get(f"/api/employees/{emp_id}", cookies=admin_cookies).json()
    assert (emp["internal_salary_usd"], emp["external_salary_usd"], emp["salary"]) == (1250.0, 2000.0, 3250.0)
    listed = next(e for e in app_client.get("/api/employees", cookies=admin_cookies).json() if e["id"] == emp_id)
    assert listed["salary"] == 3250.0


def test_employee_without_a_plan_shows_zero_pay(app_client, admin_cookies):
    emp_id = _new_employee("noplan@hrflow.test")
    emp = app_client.get(f"/api/employees/{emp_id}", cookies=admin_cookies).json()
    assert (emp["internal_salary_usd"], emp["external_salary_usd"], emp["salary"]) == (0.0, 0.0, 0.0)


def test_salary_history_amounts_come_from_the_plan_not_from_the_row(app_client, admin_cookies):
    """D-048: the history row stores the event only; correcting a plan row corrects the history list too."""
    emp_id = _new_employee("hist@hrflow.test")
    seed_plan(emp_id, internal=1000.0, external=500.0, start="2024-01-01", end="2024-12-31")
    seed_plan(emp_id, internal=1200.0, external=600.0, start="2025-01-01")
    with get_db_context() as db:
        db.add(SalaryHistoryDB(employee_id=emp_id, date="2025-01-01", reason="Annual raise", applied_by="t"))
        db.commit()
    row = app_client.get(f"/api/salary/history?employee_id={emp_id}", cookies=admin_cookies).json()[0]
    assert (row["previous_salary"], row["new_salary"], row["pct_change"]) == (1500.0, 1800.0, "+20.0%")
    assert (row["new_internal_usd"], row["new_external_usd"], row["reason"]) == (1200.0, 600.0, "Annual raise")
    pay_row = app_client.get(f"/api/finance/employees/{emp_id}/compensation-plan/pay-history", cookies=admin_cookies).json()[0]
    assert (pay_row["new_total_usd"], pay_row["pct_change"]) == (1800.0, "+20.0%")

    with get_db_context() as db:   # a direct database correction of the plan row
        db.query(EmployeeCompensationPlanDB).filter_by(employee_id=emp_id, component_type="internal_usd_cash",
                                                       effective_start_date="2025-01-01").update({"amount": 1300.0})
        db.commit()
    row = app_client.get(f"/api/salary/history?employee_id={emp_id}", cookies=admin_cookies).json()[0]
    assert (row["new_internal_usd"], row["new_salary"], row["pct_change"]) == (1300.0, 1900.0, "+26.67%")


def test_employee_export_pay_columns_come_from_the_plan(app_client, admin_cookies):
    from services.export import get_employees_export_data
    emp_id = _new_employee("export@hrflow.test")
    seed_plan(emp_id, internal=800.0, external=200.0)
    headers, rows = get_employees_export_data()
    row = next(r for r in rows if r[0] == emp_id)
    cell = lambda name: row[headers.index(name)]
    assert (cell("Internal Salary USD"), cell("External Salary USD"), cell("Total Salary USD")) == (800.0, 200.0, 1000.0)


# ------------------------------------------------------------------ migration 0048

def _load_migration():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations", "versions", "0048_pay_single_source.py")
    spec = importlib.util.spec_from_file_location("mig_0048", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run(engine, mod, step):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(mod, step)()


def test_migration_0048_drops_columns_logs_differences_and_reverses(tmp_path, caplog):
    mod = _load_migration()
    assert mod.down_revision == "0047_account_year_openings"
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'm.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, salary FLOAT, internal_salary_usd FLOAT, external_salary_usd FLOAT)"))
        conn.execute(sa.text("CREATE TABLE salary_history (id INTEGER PRIMARY KEY, employee_id INTEGER, previous_salary FLOAT, new_salary FLOAT, "
                             "previous_internal_usd FLOAT, previous_external_usd FLOAT, new_internal_usd FLOAT, new_external_usd FLOAT)"))
        conn.execute(sa.text("CREATE TABLE finance_employee_compensation_plans (id INTEGER PRIMARY KEY, employee_id INTEGER, component_type TEXT, "
                             "amount FLOAT, effective_start_date TEXT, effective_end_date TEXT)"))
        conn.execute(sa.text("INSERT INTO employees VALUES (1, 'Matches', 3000, 1000, 2000), (2, 'Differs', 5000, 5000, 0), (3, 'No pay', 0, 0, 0)"))
        conn.execute(sa.text("INSERT INTO finance_employee_compensation_plans VALUES "
                             "(1, 1, 'internal_usd_cash', 1000, '2020-01-01', NULL), (2, 1, 'external_usd', 2000, '2020-01-01', NULL), "
                             "(3, 2, 'internal_usd_cash', 4000, '2020-01-01', NULL)"))
        conn.execute(sa.text("INSERT INTO salary_history VALUES (1, 1, 3000, 3600, 1000, 2000, 1200, 2400)"))

    with caplog.at_level(logging.WARNING, logger="alembic.runtime.migration"):
        _run(engine, mod, "upgrade")
    warned = [r.getMessage() for r in caplog.records if "pay columns dropped" in r.getMessage()]
    assert len(warned) == 1 and "employee 2" in warned[0]          # only the differing employee is listed

    insp = sa.inspect(engine)
    assert {"salary", "internal_salary_usd", "external_salary_usd"}.isdisjoint(c["name"] for c in insp.get_columns("employees"))
    assert {"previous_salary", "new_salary"}.isdisjoint(c["name"] for c in insp.get_columns("salary_history"))
    with engine.connect() as conn:    # the plan and the history split are untouched
        assert conn.execute(sa.text("SELECT COUNT(*) FROM finance_employee_compensation_plans")).scalar() == 3
        assert conn.execute(sa.text("SELECT new_internal_usd FROM salary_history WHERE id = 1")).scalar() == 1200

    _run(engine, mod, "upgrade")      # idempotent
    _run(engine, mod, "downgrade")
    with engine.connect() as conn:
        rows = {r[0]: r[1:] for r in conn.execute(sa.text("SELECT id, internal_salary_usd, external_salary_usd, salary FROM employees"))}
        assert rows[1] == (1000.0, 2000.0, 3000.0) and rows[2] == (4000.0, 0.0, 4000.0)
        assert conn.execute(sa.text("SELECT previous_salary, new_salary FROM salary_history WHERE id = 1")).fetchone() == (3000.0, 3600.0)
    _run(engine, mod, "downgrade")    # idempotent


def test_migration_0049_logs_differences_drops_amounts_and_reverses(tmp_path, caplog):
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations", "versions", "0049_history_amounts_derived.py")
    spec = importlib.util.spec_from_file_location("mig_0049", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.down_revision == "0048_pay_single_source"
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'm49.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE salary_history (id INTEGER PRIMARY KEY, employee_id INTEGER, date TEXT, reason TEXT, applied_by TEXT, "
                             "pct_change TEXT, previous_internal_usd FLOAT, previous_external_usd FLOAT, new_internal_usd FLOAT, new_external_usd FLOAT)"))
        conn.execute(sa.text("CREATE TABLE finance_employee_compensation_plans (id INTEGER PRIMARY KEY, employee_id INTEGER, component_type TEXT, "
                             "amount FLOAT, effective_start_date TEXT, effective_end_date TEXT)"))
        conn.execute(sa.text("INSERT INTO finance_employee_compensation_plans VALUES "
                             "(1, 1, 'internal_usd_cash', 1000, '2024-01-01', '2024-12-31'), (2, 1, 'internal_usd_cash', 1200, '2025-01-01', NULL), "
                             "(3, 1, 'external_usd', 500, '2024-01-01', NULL)"))
        conn.execute(sa.text("INSERT INTO salary_history VALUES (1, 1, '2025-01-01', 'raise', 'a', '+13.33%', 1000, 500, 1200, 500), "
                             "(2, 1, '2025-06-01', 'stale', 'a', '+0.0%', 1200, 500, 9999, 500)"))
    with caplog.at_level(logging.WARNING, logger="alembic.runtime.migration"):
        _run(engine, mod, "upgrade")
    warned = [r.getMessage() for r in caplog.records if "pay history row" in r.getMessage()]
    assert len(warned) == 1 and "row 2" in warned[0]               # only the row that disagrees with the plan
    cols = {c["name"] for c in sa.inspect(engine).get_columns("salary_history")}
    assert {"previous_internal_usd", "previous_external_usd", "new_internal_usd", "new_external_usd", "pct_change"}.isdisjoint(cols)
    assert {"id", "employee_id", "date", "reason", "applied_by"} <= cols
    _run(engine, mod, "upgrade")      # idempotent
    _run(engine, mod, "downgrade")    # refilled from the plan
    with engine.connect() as conn:
        rows = {r[0]: r[1:] for r in conn.execute(sa.text(
            "SELECT id, previous_internal_usd, previous_external_usd, new_internal_usd, new_external_usd, pct_change FROM salary_history"))}
    assert rows[1] == (1000.0, 500.0, 1200.0, 500.0, "+13.33%")
    assert rows[2] == (1200.0, 500.0, 1200.0, 500.0, "+0.0%")
