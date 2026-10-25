"""
be/tests/test_compensation_plan_access.py
D-038: the compensation-plan routes accept the finance key or the matching HR salary key.
Reads: finance.payroll.read OR hr.salary.read. Writes: finance.payroll.prepare OR hr.salary.write.
"""
import pytest
from db import get_db_context
from models_db import SalaryHistoryDB
from test_finance_compensation_plan import _create_test_employee
from test_rbac import _create_test_user_with_roles, _make_user_cookies

BASE = "/api/finance/employees/{eid}/compensation-plan"
PLAN = {"internal_usd_cash": 4000, "external_usd": 6000, "effective_start_date": "2026-09-01", "notes": "D-038"}
COMPONENT = {"amount": 3000.0, "effective_start_date": "2026-09-01", "notes": "D-038"}

# role system_key -> (can read, can write); None = a user holding no role at all.
MATRIX = {
    "super_admin": (True, True),
    "hr_admin": (True, True),
    "payroll_maker": (True, True),
    "financial_admin": (True, False),
    "employee": (False, False),
    None: (False, False),
}


def _cookies(system_key):
    with get_db_context() as db:
        user = _create_test_user_with_roles(
            db,
            email=f"d038_{system_key or 'norole'}@voyance.health",
            system_keys=[system_key] if system_key else [],
            employee_id=2 if system_key == "employee" else None,
        )
    return _make_user_cookies(user)


@pytest.mark.parametrize("system_key", list(MATRIX))
def test_read_routes_follow_the_either_or_rule(app_client, system_key):
    can_read, _ = MATRIX[system_key]
    emp_id = _create_test_employee("d038r")
    cookies = _cookies(system_key)
    for suffix in ("", "/history", "/pay-history"):
        resp = app_client.get(BASE.format(eid=emp_id) + suffix, cookies=cookies)
        assert (resp.status_code != 403) == can_read, f"{system_key} GET {suffix or '/'} -> {resp.status_code}"
        if can_read:
            assert resp.status_code == 200


@pytest.mark.parametrize("system_key", list(MATRIX))
def test_write_routes_follow_the_either_or_rule(app_client, system_key):
    _, can_write = MATRIX[system_key]
    emp_id = _create_test_employee("d038w")
    cookies = _cookies(system_key)
    put_plan = app_client.put(BASE.format(eid=emp_id), json=PLAN, cookies=cookies)
    put_comp = app_client.put(BASE.format(eid=emp_id) + "/external_usd", json=COMPONENT, cookies=cookies)
    for name, resp in (("PUT plan", put_plan), ("PUT component", put_comp)):
        assert (resp.status_code != 403) == can_write, f"{system_key} {name} -> {resp.status_code}"
        if can_write:
            assert resp.status_code == 200, resp.text


def test_hr_admin_sets_plan_reads_it_back_and_writes_one_salary_history_row(app_client):
    emp_id = _create_test_employee("d038e2e")
    cookies = _cookies("hr_admin")

    resp = app_client.put(BASE.format(eid=emp_id), json=PLAN, cookies=cookies)
    assert resp.status_code == 200, resp.text

    plan = app_client.get(BASE.format(eid=emp_id), cookies=cookies)
    assert plan.status_code == 200
    body = plan.json()
    assert body["internal_usd_cash"]["amount"] == 4000
    assert body["external_usd"]["amount"] == 6000
    assert body["total_monthly_usd"] == 10000

    with get_db_context() as db:
        rows = db.query(SalaryHistoryDB).filter(SalaryHistoryDB.employee_id == emp_id).all()
        assert len(rows) == 1
        assert rows[0].new_salary == 10000
