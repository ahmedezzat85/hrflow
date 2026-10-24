"""
be/tests/test_analytics_employee_pay_rbac.py
RBAC and Permission Matrix tests for Employee Pay Analytics (AC 1 & AC 2):
1. Both permissions: response has payments and plan.
2. Finance-only: payments & currencies_available present; plan omitted (key absent).
3. HR-only: plan present; payments & currencies_available omitted (keys absent).
4. Neither permission / Standard employee: 403 Forbidden.
5. Self-service own-record request: 403 Forbidden.
6. Unknown employee: 404 Not Found.
"""
import pytest
from db import get_db_context
from models_db import EmployeeDB, SalaryHistoryDB
from finance.models import PayrollRunDB, PayrollLineDB
from conftest import create_test_user


@pytest.fixture
def rbac_env(app_client):
    with get_db_context() as db:
        emp = EmployeeDB(
            name="Diana RBAC",
            email="diana.rbac@voyance.health",
            dept="Operations",
            job_role="Operations Manager",
            status="active",
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)
        emp_id = emp.id

        # Seed salary history
        h = SalaryHistoryDB(
            employee_id=emp_id,
            date="2026-01-01",
            previous_internal_usd=2000.0,
            previous_external_usd=5000.0,
            new_internal_usd=2500.0,
            new_external_usd=6000.0,
            pct_change="+21.4%",
            reason="Annual Adjustment",
            applied_by="admin@voyance.health",
        )
        db.add(h)

        # Seed one payroll run
        r = PayrollRunDB(
            period_label="2026-06",
            period_start="2026-06-01",
            period_end="2026-06-30",
            status="paid",
            currency="USD",
        )
        db.add(r)
        db.flush()
        db.add(PayrollLineDB(payroll_run_id=r.id, employee_id=emp_id, compensation_type="external_usd", base_salary=6000.0, payment_status="paid"))
        db.add(PayrollLineDB(payroll_run_id=r.id, employee_id=emp_id, compensation_type="internal_usd_cash", base_salary=2500.0, payment_status="paid"))
        db.commit()

    # Create user cookies for various roles:
    # 1. Super-Admin (holds both finance.report.read and hr.salary.read)
    super_admin_cookies = create_test_user("superadmin_analytics@voyance.health", role_key="super_admin")
    # 2. Financial-Admin (holds finance.report.read only)
    finance_admin_cookies = create_test_user("finadmin_analytics@voyance.health", role_key="financial_admin")
    # 3. HR-Admin (holds hr.salary.read only)
    hr_admin_cookies = create_test_user("hradmin_analytics@voyance.health", role_key="hr_admin")
    # 4. Standard Employee (self-service only, no admin permissions) with employee_id=emp_id
    employee_own_cookies = create_test_user("diana.self@voyance.health", role_key="employee", employee_id=emp_id)
    # 5. Other Employee with employee_id=999
    other_employee_cookies = create_test_user("other.self@voyance.health", role_key="employee", employee_id=999)

    return {
        "emp_id": emp_id,
        "super_admin_cookies": super_admin_cookies,
        "finance_admin_cookies": finance_admin_cookies,
        "hr_admin_cookies": hr_admin_cookies,
        "employee_own_cookies": employee_own_cookies,
        "other_employee_cookies": other_employee_cookies,
    }


def test_both_permissions_returns_payments_and_plan(app_client, rbac_env):
    """AC 1: Caller with both permissions receives payments, currencies_available, and plan."""
    emp_id = rbac_env["emp_id"]
    resp = app_client.get(
        f"/api/analytics/employees/{emp_id}/pay",
        cookies=rbac_env["super_admin_cookies"],
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "payments" in data
    assert "currencies_available" in data
    assert "plan" in data
    assert data["employee"]["id"] == emp_id
    assert data["payments"]["totals"]["total"] == 8500.0
    assert data["plan"]["current"]["total"] == 8500.0


def test_finance_only_permission_returns_payments_and_omits_plan(app_client, rbac_env):
    """AC 1: Caller with finance.report.read only receives payments and currencies_available; plan is omitted (key absent)."""
    emp_id = rbac_env["emp_id"]
    resp = app_client.get(
        f"/api/analytics/employees/{emp_id}/pay",
        cookies=rbac_env["finance_admin_cookies"],
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "payments" in data
    assert "currencies_available" in data
    # Key absent per Decision 3
    assert "plan" not in data


def test_hr_only_permission_returns_plan_and_omits_payments(app_client, rbac_env):
    """AC 1: Caller with hr.salary.read only receives plan; payments and currencies_available are omitted (keys absent)."""
    emp_id = rbac_env["emp_id"]
    resp = app_client.get(
        f"/api/analytics/employees/{emp_id}/pay",
        cookies=rbac_env["hr_admin_cookies"],
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "plan" in data
    # Keys absent per Decision 3
    assert "payments" not in data
    assert "currencies_available" not in data


def test_neither_permission_returns_403(app_client, rbac_env):
    """AC 1: Caller with neither permission gets 403 Forbidden."""
    emp_id = rbac_env["emp_id"]
    resp = app_client.get(
        f"/api/analytics/employees/{emp_id}/pay",
        cookies=rbac_env["other_employee_cookies"],
    )
    assert resp.status_code == 403


def test_self_service_own_record_returns_403(app_client, rbac_env):
    """AC 2: Self-service own-record request returns 403 Forbidden."""
    emp_id = rbac_env["emp_id"]
    resp = app_client.get(
        f"/api/analytics/employees/{emp_id}/pay",
        cookies=rbac_env["employee_own_cookies"],
    )
    assert resp.status_code == 403


def test_unknown_employee_returns_404(app_client, rbac_env):
    """AC 2: Authorized caller requesting non-existent employee ID gets 404 Not Found."""
    resp = app_client.get(
        "/api/analytics/employees/999999/pay",
        cookies=rbac_env["super_admin_cookies"],
    )
    assert resp.status_code == 404
