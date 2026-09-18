"""
be/tests/test_finance_payroll_commission_bonus.py
Verification test suite for FUX-418: Commission & Bonus Entry within a payroll run.

Covers:
  - Adding sales commission ($500) and support commission ($200) to an employee in a draft run.
  - Adding commission/bonus to an employee without an active recurring compensation plan.
  - Allowing multiple commission/bonus lines for the same employee in the same run.
  - Commission/bonus amounts defaulting to taxable/insurable and correctly included in
    finalize_run()'s statutory obligation estimates (FUX-410).
  - Status integrity guard: rejecting line addition or deletion on approved/finalized runs.
  - Deleting a draft line correctly recalculating run aggregates and liabilities.
"""
import json
import pytest
from datetime import datetime
from db import get_db_context
from models_db import EmployeeDB, EmployeeBankAccountDB
from finance.models import (
    PayrollRunDB,
    PayrollLineDB,
    EmployeeCompensationPlanDB,
    StatutoryObligationDB,
)


def _cleanup():
    with get_db_context() as db:
        db.query(StatutoryObligationDB).filter(StatutoryObligationDB.source_type == "payroll_run").delete()
        db.query(PayrollLineDB).delete()
        db.query(PayrollRunDB).delete()
        db.query(EmployeeCompensationPlanDB).delete()
        db.query(EmployeeBankAccountDB).delete()
        db.query(EmployeeDB).delete()
        db.commit()


def _setup_employee(name, email, ext_amount=None, int_amount=None):
    with get_db_context() as db:
        emp = EmployeeDB(
            name=name,
            email=email,
            role="employee",
            dept="Sales",
            job_role="Account Exec",
            salary=(ext_amount or 0.0) + (int_amount or 0.0),
            internal_salary_usd=int_amount or 0.0,
            external_salary_usd=ext_amount or 0.0,
            status="Active",
        )
        db.add(emp)
        db.flush()

        bank = EmployeeBankAccountDB(
            employee_id=emp.id,
            bank_name="Commercial Bank",
            iban="EG998877665544332211009988",
            swift_code="COMMEXEG",
        )
        db.add(bank)
        db.flush()

        if ext_amount:
            db.add(EmployeeCompensationPlanDB(
                employee_id=emp.id,
                component_type="external_usd",
                amount=ext_amount,
                currency="USD",
                effective_start_date="2026-09-01",
                effective_end_date=None,
                notes="External salary",
            ))

        if int_amount:
            db.add(EmployeeCompensationPlanDB(
                employee_id=emp.id,
                component_type="internal_usd_cash",
                amount=int_amount,
                currency="USD",
                effective_start_date="2026-09-01",
                effective_end_date=None,
                notes="Internal salary",
            ))

        db.commit()
        db.refresh(emp)
        return emp.id


def test_add_commission_and_bonus_lines(app_client, admin_cookies):
    """Add sales commission and support commission to an employee in a draft run; confirm independent persistence and total_gross."""
    _cleanup()
    emp_id = _setup_employee("Alice Rep", "alice.rep@hrflow.test", ext_amount=2000.0, int_amount=1000.0)

    # 1. Generate run from plans
    gen_resp = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "fx_rate_source": "first_of_month",
            "fx_rate_value": 48.5,
        },
        cookies=admin_cookies,
    )
    assert gen_resp.status_code == 201
    run_id = gen_resp.json()["id"]
    initial_gross = gen_resp.json()["total_gross"]
    assert initial_gross == 3000.0  # 2000 external + 1000 internal

    # 2. Add sales commission: $500
    c1_resp = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/lines",
        json={
            "employee_id": emp_id,
            "compensation_type": "commission_sales",
            "amount": 500.0,
            "notes": "September deal commission",
        },
        cookies=admin_cookies,
    )
    assert c1_resp.status_code == 201, c1_resp.text
    c1 = c1_resp.json()
    assert c1["compensation_type"] == "commission_sales"
    assert c1["base_salary"] == 500.0
    assert c1["is_taxable_local"] is True
    assert c1["is_insurable"] is True
    assert c1["tax_amount"] == 0.0
    assert c1["deductions_total"] == 0.0
    assert c1["employer_cost_extra"] == 0.0
    assert c1["net_pay"] == 500.0

    # 3. Add support commission: $200
    c2_resp = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/lines",
        json={
            "employee_id": emp_id,
            "compensation_type": "commission_support",
            "amount": 200.0,
            "notes": "Support ticket bonus",
        },
        cookies=admin_cookies,
    )
    assert c2_resp.status_code == 201
    c2 = c2_resp.json()
    assert c2["compensation_type"] == "commission_support"
    assert c2["base_salary"] == 200.0
    assert c2["tax_amount"] == 0.0
    assert c2["deductions_total"] == 0.0
    assert c2["net_pay"] == 200.0

    # 4. Verify run totals updated
    run_detail = app_client.get(f"/api/finance/payroll/runs/{run_id}", cookies=admin_cookies).json()
    assert run_detail["total_gross"] == 3700.0  # 3000 + 500 + 200
    assert len(run_detail["lines"]) == 4  # 2 plan lines + 2 commission lines


def test_add_commission_to_employee_without_plan(app_client, admin_cookies):
    """A commission/bonus can be added to an employee without an active compensation plan."""
    _cleanup()
    # Employee 1 has a plan
    emp1_id = _setup_employee("Fixed Worker", "fixed.worker@hrflow.test", int_amount=1000.0)

    # Employee 2 has NO plan (e.g. pure contractor or variable commission agent)
    with get_db_context() as db:
        emp2 = EmployeeDB(
            name="Bob CommissionOnly",
            email="bob.commission@hrflow.test",
            role="employee",
            dept="Sales",
            status="On Leave",
            salary=0.0,
        )
        db.add(emp2)
        db.commit()
        db.refresh(emp2)
        emp2_id = emp2.id

    # Generate run with only emp1
    gen_resp = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
        },
        cookies=admin_cookies,
    )
    assert gen_resp.status_code == 201
    run_id = gen_resp.json()["id"]

    # Re-activate Bob
    with get_db_context() as db:
        emp2_db = db.query(EmployeeDB).filter(EmployeeDB.id == emp2_id).first()
        emp2_db.status = "Active"
        db.commit()

    # Now add commission for Bob into the draft run
    c_resp = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/lines",
        json={
            "employee_id": emp2_id,
            "compensation_type": "commission_sales",
            "amount": 1500.0,
            "notes": "Direct commission for pure variable worker",
        },
        cookies=admin_cookies,
    )
    assert c_resp.status_code == 201
    assert c_resp.json()["employee_id"] == emp2_id
    assert c_resp.json()["base_salary"] == 1500.0

    run_detail = app_client.get(f"/api/finance/payroll/runs/{run_id}", cookies=admin_cookies).json()
    assert run_detail["headcount"] == 2  # Both Fixed Worker and Bob are in the run now!


def test_multiple_lines_same_type_same_employee(app_client, admin_cookies):
    """Multiple commission/bonus lines for the same employee in the same run are allowed."""
    _cleanup()
    emp_id = _setup_employee("Multi Rep", "multi.rep@hrflow.test", int_amount=1500.0)

    gen_resp = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
        },
        cookies=admin_cookies,
    )
    assert gen_resp.status_code == 201
    run_id = gen_resp.json()["id"]

    # Add Deal 1 commission
    r1 = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/lines",
        json={"employee_id": emp_id, "compensation_type": "commission_sales", "amount": 400.0, "notes": "Deal 1"},
        cookies=admin_cookies,
    )
    assert r1.status_code == 201
    line1_id = r1.json()["id"]

    # Add Deal 2 commission (same employee, same type)
    r2 = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/lines",
        json={"employee_id": emp_id, "compensation_type": "commission_sales", "amount": 600.0, "notes": "Deal 2"},
        cookies=admin_cookies,
    )
    assert r2.status_code == 201
    line2_id = r2.json()["id"]

    assert line1_id != line2_id

    run_detail = app_client.get(f"/api/finance/payroll/runs/{run_id}", cookies=admin_cookies).json()
    sales_lines = [l for l in run_detail["lines"] if l["compensation_type"] == "commission_sales"]
    assert len(sales_lines) == 2
    assert {l["base_salary"] for l in sales_lines} == {400.0, 600.0}


def test_commissions_participate_in_statutory_obligations(app_client, admin_cookies):
    """Commission/bonus amounts flow into finalize_run() statutory obligation estimate calculation."""
    _cleanup()
    emp_id = _setup_employee("Taxable Earner", "taxable.earner@hrflow.test", ext_amount=3000.0, int_amount=1000.0)

    gen_resp = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "fx_rate_value": 50.0,
        },
        cookies=admin_cookies,
    )
    assert gen_resp.status_code == 201
    run_id = gen_resp.json()["id"]

    # Add $500 bonus
    b_resp = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/lines",
        json={"employee_id": emp_id, "compensation_type": "bonus", "amount": 500.0, "notes": "Annual Bonus"},
        cookies=admin_cookies,
    )
    assert b_resp.status_code == 201

    # Approve and finalize run
    assert app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies).status_code == 200
    fin_resp = app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=admin_cookies)
    assert fin_resp.status_code == 200
    fin_data = fin_resp.json()

    # Check liabilities summary (0.0 without automatic statutory calculation):
    liab = fin_data["liabilities_summary"]
    assert liab["income_tax_withheld"] == 0.0
    assert liab["social_insurance_employee"] == 0.0
    assert liab["social_insurance_employer"] == 0.0

    # Verify StatutoryObligationDB records (0.0 estimated amounts)
    with get_db_context() as db:
        obligations = db.query(StatutoryObligationDB).filter(
            StatutoryObligationDB.source_type == "payroll_run",
            StatutoryObligationDB.source_id == run_id,
        ).all()
        assert len(obligations) == 3
        obl_map = {o.obligation_type: o.amount_estimated for o in obligations}
        assert obl_map["income_tax"] == 0.0
        assert obl_map["social_insurance_employee"] == 0.0
        assert obl_map["social_insurance_employer"] == 0.0


def test_reject_modifications_on_locked_run(app_client, admin_cookies):
    """Attempting to add or delete a line on an approved or finalized run is rejected with HTTP 400."""
    _cleanup()
    emp_id = _setup_employee("Locked Worker", "locked.worker@hrflow.test", int_amount=1200.0)

    gen_resp = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={"period_label": "2026-09", "period_start": "2026-09-01", "period_end": "2026-09-30"},
        cookies=admin_cookies,
    )
    run_id = gen_resp.json()["id"]
    line_id = gen_resp.json()["lines"][0]["id"]

    # Approve run
    assert app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies).status_code == 200

    # Attempt to add line to approved run -> 400
    add_resp = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/lines",
        json={"employee_id": emp_id, "compensation_type": "bonus", "amount": 300.0},
        cookies=admin_cookies,
    )
    assert add_resp.status_code == 400
    assert "locked against modification" in add_resp.json()["detail"]

    # Attempt to delete line from approved run -> 400
    del_resp = app_client.delete(
        f"/api/finance/payroll/runs/{run_id}/lines/{line_id}",
        cookies=admin_cookies,
    )
    assert del_resp.status_code == 400
    assert "locked against modification" in del_resp.json()["detail"]


def test_delete_draft_line_recalculates_totals(app_client, admin_cookies):
    """Removing a line from a still-draft run correctly recalculates the run's totals and liabilities."""
    _cleanup()
    emp_id = _setup_employee("Edit Worker", "edit.worker@hrflow.test", int_amount=1000.0)

    gen_resp = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={"period_label": "2026-09", "period_start": "2026-09-01", "period_end": "2026-09-30"},
        cookies=admin_cookies,
    )
    run_id = gen_resp.json()["id"]
    initial_gross = gen_resp.json()["total_gross"]
    assert initial_gross == 1000.0

    # Add ad-hoc bonus: $400
    add_resp = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/lines",
        json={"employee_id": emp_id, "compensation_type": "bonus", "amount": 400.0},
        cookies=admin_cookies,
    )
    assert add_resp.status_code == 201
    bonus_line_id = add_resp.json()["id"]

    # Verify gross increased to 1400
    run_after_add = app_client.get(f"/api/finance/payroll/runs/{run_id}", cookies=admin_cookies).json()
    assert run_after_add["total_gross"] == 1400.0

    # Delete the bonus line
    del_resp = app_client.delete(f"/api/finance/payroll/runs/{run_id}/lines/{bonus_line_id}", cookies=admin_cookies)
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True

    # Verify totals reverted to initial 1000
    run_after_del = app_client.get(f"/api/finance/payroll/runs/{run_id}", cookies=admin_cookies).json()
    assert run_after_del["total_gross"] == 1000.0
    assert len(run_after_del["lines"]) == 1
