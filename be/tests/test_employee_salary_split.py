"""
test_employee_salary_split.py
Pay is not an input of the employee create/update API (D-035). It is set only through the Pay plan
(PUT /api/finance/employees/{id}/compensation-plan), which keeps the employee's internal/external
fields and the legacy `salary` total in step. These tests pin that boundary.
"""
from db import get_db_context
from employee_test_helpers import PERSONAL
from finance.models import EmployeeCompensationPlanDB
from models_db import EmployeeDB


def _employee_pay(emp_id):
    with get_db_context() as db:
        emp = db.query(EmployeeDB).filter(EmployeeDB.id == emp_id).one()
        plan_rows = db.query(EmployeeCompensationPlanDB).filter(EmployeeCompensationPlanDB.employee_id == emp_id).count()
        return emp.internal_salary_usd, emp.external_salary_usd, emp.salary, plan_rows


def test_create_employee_needs_no_pay_and_starts_with_none(app_client, admin_cookies):
    resp = app_client.post("/api/employees", json={
        **PERSONAL, "name": "New Hire", "email": "newhire@hrflow.test", "dept": "Engineering", "job_role": "Developer",
    }, cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    assert _employee_pay(resp.json()["id"]) == (0.0, 0.0, 0.0, 0)


def test_create_employee_ignores_salary_fields_sent_by_old_clients(app_client, admin_cookies):
    resp = app_client.post("/api/employees", json={
        **PERSONAL, "name": "Old Client", "email": "oldclient@hrflow.test", "dept": "Engineering",
        "job_role": "Developer", "internal_salary_usd": 1500, "external_salary_usd": 500,
    }, cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    assert _employee_pay(resp.json()["id"]) == (0.0, 0.0, 0.0, 0)


def test_pay_plan_sets_the_split_and_the_derived_total(app_client, admin_cookies):
    emp_id = app_client.post("/api/employees", json={
        **PERSONAL, "name": "Split Pay", "email": "splitpay@hrflow.test", "dept": "Engineering", "job_role": "Developer",
    }, cookies=admin_cookies).json()["id"]
    resp = app_client.put(f"/api/finance/employees/{emp_id}/compensation-plan", json={
        "effective_start_date": "2026-01-01", "internal_usd_cash": 1000, "external_usd": 500,
    }, cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    assert _employee_pay(emp_id) == (1000.0, 500.0, 1500.0, 2)


def test_employee_update_never_changes_pay(app_client, admin_cookies):
    emp_id = app_client.post("/api/employees", json={
        **PERSONAL, "name": "Stays Put", "email": "staysput@hrflow.test", "dept": "Sales", "job_role": "Rep",
    }, cookies=admin_cookies).json()["id"]
    app_client.put(f"/api/finance/employees/{emp_id}/compensation-plan", json={
        "effective_start_date": "2026-01-01", "internal_usd_cash": 1000, "external_usd": 500,
    }, cookies=admin_cookies)

    resp = app_client.put(f"/api/employees/{emp_id}", json={"dept": "Marketing", "internal_salary_usd": 9999},
                          cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    assert _employee_pay(emp_id) == (1000.0, 500.0, 1500.0, 2)
    assert app_client.get(f"/api/employees/{emp_id}", cookies=admin_cookies).json()["dept"] == "Marketing"
