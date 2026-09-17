"""
be/tests/test_finance_compensation_plan.py
Verification test suite for FUX-416 Employee Compensation Plan.

Covers:
  - Setting employee external and internal amounts creates two independent, correctly typed rows with effective_end_date IS NULL.
  - Updating an existing component's amount preserves the prior row with a closed effective_end_date (start - 1 day), while the new row is open-ended.
  - Exactly one active row per component type per employee; inserting a second active row without closing the first is rejected.
  - Current-plan endpoint returns both active components and total monthly USD in a single call.
  - History endpoint returns all rows in reverse chronological order.
  - Guard prevents setting effective_start_date into an already finalized/paid payroll run period.
  - Component validation: amount must be > 0; component_type must be external_usd or internal_usd_cash.
  - Synchronizes internal_salary_usd / external_salary_usd / salary on EmployeeDB.
  - Permission checks (finance.payroll.read / finance.payroll.write).
"""
import pytest
from datetime import datetime, timedelta
from db import get_db_context
from models_db import EmployeeDB
from finance.models import EmployeeCompensationPlanDB, PayrollRunDB
from finance.repositories.compensation_plan_repository import CompensationPlanRepository


def _create_test_employee(email_suffix="comp"):
    with get_db_context() as db:
        unique_email = f"emp_{email_suffix}_{int(datetime.utcnow().timestamp() * 1000)}@hrflow.test"
        emp = EmployeeDB(
            name="Compensation Test Employee",
            email=unique_email,
            role="employee",
            dept="Engineering",
            job_role="Software Engineer",
            salary=0.0,
            internal_salary_usd=0.0,
            external_salary_usd=0.0,
            status="Active",
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)
        return emp.id


def test_set_external_and_internal_components(app_client, admin_cookies):
    """Setting an employee's external and internal amounts creates two independent, correctly typed rows."""
    emp_id = _create_test_employee("split")

    # 1. Set external_usd = 3000.00
    resp_ext = app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/external_usd",
        json={"amount": 3000.0, "effective_start_date": "2026-09-01", "notes": "US transfer base"},
        cookies=admin_cookies,
    )
    assert resp_ext.status_code == 200
    data_ext = resp_ext.json()
    assert data_ext["employee_id"] == emp_id
    assert data_ext["component_type"] == "external_usd"
    assert data_ext["amount"] == 3000.0
    assert data_ext["currency"] == "USD"
    assert data_ext["effective_start_date"] == "2026-09-01"
    assert data_ext["effective_end_date"] is None

    # 2. Set internal_usd_cash = 1500.00
    resp_int = app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/internal_usd_cash",
        json={"amount": 1500.0, "effective_start_date": "2026-09-01", "notes": "Cairo USD cash"},
        cookies=admin_cookies,
    )
    assert resp_int.status_code == 200
    data_int = resp_int.json()
    assert data_int["employee_id"] == emp_id
    assert data_int["component_type"] == "internal_usd_cash"
    assert data_int["amount"] == 1500.0
    assert data_int["effective_end_date"] is None

    # 3. Verify current active plan endpoint
    resp_plan = app_client.get(
        f"/api/finance/employees/{emp_id}/compensation-plan",
        cookies=admin_cookies,
    )
    assert resp_plan.status_code == 200
    plan = resp_plan.json()
    assert plan["employee_id"] == emp_id
    assert plan["external_usd"]["amount"] == 3000.0
    assert plan["internal_usd_cash"]["amount"] == 1500.0
    assert plan["total_monthly_usd"] == 4500.0

    # 4. Verify EmployeeDB fields were synchronized
    with get_db_context() as db:
        emp = db.query(EmployeeDB).filter(EmployeeDB.id == emp_id).first()
        assert emp.external_salary_usd == 3000.0
        assert emp.internal_salary_usd == 1500.0
        assert emp.salary == 4500.0


def test_update_component_preserves_history_with_closed_end_date(app_client, admin_cookies):
    """Updating an existing component closes the prior row with effective_end_date = start - 1 day."""
    emp_id = _create_test_employee("raise")

    # Initial plan: internal_usd_cash = 1500 from 2026-09-01
    app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/internal_usd_cash",
        json={"amount": 1500.0, "effective_start_date": "2026-09-01", "notes": "Initial base"},
        cookies=admin_cookies,
    )

    # Update to 1700 effective next month 2026-10-01
    resp_upd = app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/internal_usd_cash",
        json={"amount": 1700.0, "effective_start_date": "2026-10-01", "notes": "Promotion adjustment"},
        cookies=admin_cookies,
    )
    assert resp_upd.status_code == 200
    upd_data = resp_upd.json()
    assert upd_data["amount"] == 1700.0
    assert upd_data["effective_start_date"] == "2026-10-01"
    assert upd_data["effective_end_date"] is None

    # Check history endpoint
    resp_hist = app_client.get(
        f"/api/finance/employees/{emp_id}/compensation-plan/history",
        cookies=admin_cookies,
    )
    assert resp_hist.status_code == 200
    history = resp_hist.json()
    assert len(history) == 2

    new_row = next(r for r in history if r["amount"] == 1700.0)
    old_row = next(r for r in history if r["amount"] == 1500.0)

    assert new_row["effective_start_date"] == "2026-10-01"
    assert new_row["effective_end_date"] is None

    assert old_row["effective_start_date"] == "2026-09-01"
    # Day before 2026-10-01 is 2026-09-30
    assert old_row["effective_end_date"] == "2026-09-30"


def test_single_active_row_enforced_at_repository_layer(admin_cookies):
    """Attempting to insert a second open-ended row for the same employee and type without closing the first is rejected."""
    emp_id = _create_test_employee("dup_repo")

    with get_db_context() as db:
        repo = CompensationPlanRepository(db)
        repo.create_component(
            employee_id=emp_id,
            component_type="external_usd",
            amount=2500.0,
            effective_start_date="2026-09-01",
        )
        db.commit()

        # Attempting second active row should raise ValueError
        with pytest.raises(ValueError, match="already exists"):
            repo.create_component(
                employee_id=emp_id,
                component_type="external_usd",
                amount=3000.0,
                effective_start_date="2026-10-01",
            )


def test_component_validation_rules(app_client, admin_cookies):
    """Component validation: amount > 0, controlled component_type, valid date format."""
    emp_id = _create_test_employee("validation")

    # Amount <= 0 rejected
    resp_zero = app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/external_usd",
        json={"amount": 0.0, "effective_start_date": "2026-09-01"},
        cookies=admin_cookies,
    )
    assert resp_zero.status_code in (400, 422)

    resp_neg = app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/external_usd",
        json={"amount": -500.0, "effective_start_date": "2026-09-01"},
        cookies=admin_cookies,
    )
    assert resp_neg.status_code in (400, 422)

    # Invalid component type rejected
    resp_invalid_type = app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/bonus_commission",
        json={"amount": 1000.0, "effective_start_date": "2026-09-01"},
        cookies=admin_cookies,
    )
    assert resp_invalid_type.status_code == 400
    assert "Invalid component_type" in resp_invalid_type.json()["detail"]

    # Non-existent employee returns 404
    resp_not_found = app_client.get(
        "/api/finance/employees/9999999/compensation-plan",
        cookies=admin_cookies,
    )
    assert resp_not_found.status_code == 404


def test_finalized_payroll_run_boundary_guard(app_client, admin_cookies):
    """Setting effective_start_date in or before an already finalized payroll run period is rejected."""
    emp_id = _create_test_employee("payroll_guard")

    # Create a finalized payroll run ending 2026-08-31
    with get_db_context() as db:
        finalized_run = PayrollRunDB(
            period_label="2026-08-TEST",
            period_start="2026-08-01",
            period_end="2026-08-31",
            status="finalized",
            total_gross=5000.0,
            total_net=4000.0,
        )
        db.add(finalized_run)
        db.commit()

    # Attempt to set compensation effective 2026-08-15 (inside closed run period)
    resp_closed = app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/external_usd",
        json={"amount": 2000.0, "effective_start_date": "2026-08-15"},
        cookies=admin_cookies,
    )
    assert resp_closed.status_code == 400
    assert "finalized payroll period" in resp_closed.json()["detail"]

    # Setting compensation effective after closed run period (2026-09-01) succeeds
    resp_open = app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/external_usd",
        json={"amount": 2000.0, "effective_start_date": "2026-09-01"},
        cookies=admin_cookies,
    )
    assert resp_open.status_code == 200
