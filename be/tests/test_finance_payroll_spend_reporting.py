"""
be/tests/test_finance_payroll_spend_reporting.py
Verification test suite for FUX-419: Compensation Spend & Variance Reporting.

Covers:
  - Per-employee compensation report sums external, internal, commission, bonus for selected date range.
  - Company salary spend report grand total strictly matches sum of individual employee reports.
  - Statutory remitted report shows ONLY amount_remitted (actual money paid), excluding accrued-only items.
  - Payable/paid status view distinguishes pending vs settled across all 4 money flows (external, internal, tax, insurance) for company and single employee.
  - Custom date range query crossing a calendar year boundary calculates correctly without double-counting.
"""
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


def _setup_employee(name, email, ext_amount=None, int_amount=None, dept="Engineering"):
    with get_db_context() as db:
        emp = EmployeeDB(
            name=name,
            email=email,
            role="employee",
            dept=dept,
            job_role="Specialist",
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
            iban="EG001122334455667788990011",
            swift_code="COMBEGSX",
        )
        db.add(bank)
        db.flush()

        if ext_amount:
            db.add(EmployeeCompensationPlanDB(
                employee_id=emp.id,
                component_type="external_usd",
                amount=ext_amount,
                currency="USD",
                effective_start_date="2025-01-01",
                effective_end_date=None,
            ))
        if int_amount:
            db.add(EmployeeCompensationPlanDB(
                employee_id=emp.id,
                component_type="internal_usd_cash",
                amount=int_amount,
                currency="USD",
                effective_start_date="2025-01-01",
                effective_end_date=None,
            ))

        db.commit()
        db.refresh(emp)
        return emp.id


def test_per_employee_and_company_spend_reports(app_client, admin_cookies):
    """
    AC 1 & AC 2:
    Seed two consecutive payroll runs with external, internal, commission, and bonus.
    Verify per-employee report and that company report grand total matches sum of all individual reports.
    """
    _cleanup()
    emp1_id = _setup_employee("Alice Dev", "alice.dev@hrflow.test", ext_amount=3000.0, int_amount=1500.0)
    emp2_id = _setup_employee("Bob Ops", "bob.ops@hrflow.test", ext_amount=None, int_amount=2000.0, dept="Operations")

    # 1. Run 1: 2026-09
    resp1 = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "fx_rate_source": "first_of_month",
            "fx_rate_value": 50.0,
        },
        cookies=admin_cookies,
    )
    assert resp1.status_code == 201
    run1_id = resp1.json()["id"]

    # Add $500 sales commission to Alice in 2026-09
    resp_comm = app_client.post(
        f"/api/finance/payroll/runs/{run1_id}/lines",
        json={
            "employee_id": emp1_id,
            "compensation_type": "commission_sales",
            "amount": 500.0,
            "notes": "Q3 Enterprise Closed",
        },
        cookies=admin_cookies,
    )
    assert resp_comm.status_code == 201

    # Approve & Finalize Run 1
    app_client.post(f"/api/finance/payroll/runs/{run1_id}/approve", cookies=admin_cookies)
    app_client.post(f"/api/finance/payroll/runs/{run1_id}/finalize", cookies=admin_cookies)

    # 2. Run 2: 2026-10
    resp2 = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-10",
            "period_start": "2026-10-01",
            "period_end": "2026-10-31",
            "fx_rate_source": "first_of_month",
            "fx_rate_value": 50.0,
        },
        cookies=admin_cookies,
    )
    assert resp2.status_code == 201
    run2_id = resp2.json()["id"]

    # Add $200 bonus to Alice in 2026-10
    resp_bonus = app_client.post(
        f"/api/finance/payroll/runs/{run2_id}/lines",
        json={
            "employee_id": emp1_id,
            "compensation_type": "bonus",
            "amount": 200.0,
            "notes": "Performance Spot Bonus",
        },
        cookies=admin_cookies,
    )
    assert resp_bonus.status_code == 201

    # Approve & Finalize Run 2
    app_client.post(f"/api/finance/payroll/runs/{run2_id}/approve", cookies=admin_cookies)
    app_client.post(f"/api/finance/payroll/runs/{run2_id}/finalize", cookies=admin_cookies)

    # --- Test Alice Per-Employee Report across both months (2026-09 to 2026-10) ---
    r_alice = app_client.get(
        f"/api/finance/reports/compensation/employee/{emp1_id}?start_date=2026-09-01&end_date=2026-10-31",
        cookies=admin_cookies,
    )
    assert r_alice.status_code == 200
    d_alice = r_alice.json()
    assert d_alice["employee_id"] == emp1_id
    assert d_alice["employee_name"] == "Alice Dev"
    assert d_alice["total_external"] == 6000.0  # 3000 * 2
    assert d_alice["total_internal"] == 3000.0  # 1500 * 2
    assert d_alice["total_commission"] == 500.0
    assert d_alice["total_bonus"] == 200.0
    assert d_alice["grand_total"] == 9700.0     # 6000 + 3000 + 500 + 200
    assert d_alice["payroll_runs_count"] == 2
    assert len(d_alice["lines"]) == 6           # 2 in Sept (ext, int) + 1 comm; 2 in Oct (ext, int) + 1 bonus

    # --- Test Single Month Filter for Alice (2026-09 only) ---
    r_alice_sep = app_client.get(
        f"/api/finance/reports/compensation/employee/{emp1_id}?start_date=2026-09-01&end_date=2026-09-30",
        cookies=admin_cookies,
    )
    assert r_alice_sep.status_code == 200
    d_sep = r_alice_sep.json()
    assert d_sep["total_external"] == 3000.0
    assert d_sep["total_internal"] == 1500.0
    assert d_sep["total_commission"] == 500.0
    assert d_sep["total_bonus"] == 0.0
    assert d_sep["grand_total"] == 5000.0

    # --- Test Bob Per-Employee Report across both months ---
    r_bob = app_client.get(
        f"/api/finance/reports/compensation/employee/{emp2_id}?start_date=2026-09-01&end_date=2026-10-31",
        cookies=admin_cookies,
    )
    assert r_bob.status_code == 200
    d_bob = r_bob.json()
    assert d_bob["total_external"] == 0.0
    assert d_bob["total_internal"] == 4000.0  # 2000 * 2
    assert d_bob["grand_total"] == 4000.0

    # --- Test Company Spend Report ---
    r_company = app_client.get(
        "/api/finance/reports/compensation/company?start_date=2026-09-01&end_date=2026-10-31&breakdown_employees=true",
        cookies=admin_cookies,
    )
    assert r_company.status_code == 200
    d_comp = r_company.json()
    assert d_comp["total_external"] == 6000.0
    assert d_comp["total_internal"] == 7000.0  # Alice 3000 + Bob 4000
    assert d_comp["total_commission"] == 500.0
    assert d_comp["total_bonus"] == 200.0
    assert d_comp["grand_total"] == 13700.0    # 9700 (Alice) + 4000 (Bob)
    assert d_comp["total_headcount"] == 2
    assert d_comp["payroll_runs_count"] == 2

    # Verification: company grand total strictly matches sum of individual employee totals
    assert d_comp["grand_total"] == round(d_alice["grand_total"] + d_bob["grand_total"], 2)


def test_statutory_remitted_report_and_payable_status(app_client, admin_cookies):
    """
    AC 3 & AC 4:
    - Statutory remitted report shows only amount_remitted (not accrued/estimated).
    - Payable status view distinguishes pending vs settled across all 4 money flows for company and single employee.
    """
    _cleanup()
    emp1_id = _setup_employee("Alice Spend", "alice.spend@hrflow.test", ext_amount=2000.0, int_amount=1000.0)

    # 1. Generate & finalize run for 2026-09
    resp_gen = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "fx_rate_source": "first_of_month",
            "fx_rate_value": 50.0,
        },
        cookies=admin_cookies,
    )
    run_id = resp_gen.json()["id"]
    app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies)
    app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=admin_cookies)

    # Initially: auto-generated statutory obligations have amount_remitted = 0.0
    resp_stat_init = app_client.get(
        "/api/finance/reports/statutory/remitted?start_date=2026-09-01&end_date=2026-09-30",
        cookies=admin_cookies,
    )
    assert resp_stat_init.status_code == 200
    assert resp_stat_init.json()["total_remitted"] == 0.0
    assert len(resp_stat_init.json()["items"]) == 0

    # Payable status before any payout or tax settlement
    resp_pay_init = app_client.get(
        "/api/finance/reports/payroll/payable-status?period=2026-09",
        cookies=admin_cookies,
    )
    assert resp_pay_init.status_code == 200
    d_pay = resp_pay_init.json()
    flows_by_type = {f["flow_type"]: f for f in d_pay["flows"]}

    # External USD: pending 2000, settled 0
    assert flows_by_type["external_transfer"]["pending_amount"] == 2000.0
    assert flows_by_type["external_transfer"]["settled_amount"] == 0.0
    assert flows_by_type["external_transfer"]["status"] == "pending"

    # Internal Cash: net pay for 1000 base salary = 850 (1000 - 100 tax - 50 SI)
    assert flows_by_type["internal_cash"]["pending_amount"] == 850.0
    assert flows_by_type["internal_cash"]["settled_amount"] == 0.0
    assert flows_by_type["internal_cash"]["status"] == "pending"

    # Tax: income tax accrued = 100.0, remitted = 0.0
    assert flows_by_type["tax_obligation"]["pending_amount"] == 100.0
    assert flows_by_type["tax_obligation"]["settled_amount"] == 0.0
    assert flows_by_type["tax_obligation"]["status"] == "pending"

    # Insurance: 50 employee SI + 120 employer SI = 170.0
    assert flows_by_type["insurance_obligation"]["pending_amount"] == 170.0
    assert flows_by_type["insurance_obligation"]["settled_amount"] == 0.0
    assert flows_by_type["insurance_obligation"]["status"] == "pending"

    # 2. Settle the income tax obligation
    with get_db_context() as db:
        tax_obl = (
            db.query(StatutoryObligationDB)
            .filter(StatutoryObligationDB.source_type == "payroll_run", StatutoryObligationDB.source_id == run_id)
            .filter(StatutoryObligationDB.obligation_type == "income_tax")
            .first()
        )
        assert tax_obl is not None
        tax_obl.amount_remitted = 100.0
        tax_obl.status = "remitted"
        db.commit()

    # Verify Statutory Remitted Report now reflects ONLY the $100 paid income tax
    resp_stat_after = app_client.get(
        "/api/finance/reports/statutory/remitted?start_date=2026-09-01&end_date=2026-09-30",
        cookies=admin_cookies,
    )
    assert resp_stat_after.status_code == 200
    d_stat = resp_stat_after.json()
    assert d_stat["total_remitted"] == 100.0
    assert d_stat["by_obligation_type"]["income_tax"] == 100.0
    assert "social_insurance_employee" not in d_stat["by_obligation_type"]

    # 3. Pay the payroll run (sets external and internal lines to paid)
    resp_pay_run = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/pay",
        json={},
        cookies=admin_cookies,
    )
    assert resp_pay_run.status_code == 200

    # 4. Check Payable Status again
    resp_pay_final = app_client.get(
        "/api/finance/reports/payroll/payable-status?period=2026-09",
        cookies=admin_cookies,
    )
    assert resp_pay_final.status_code == 200
    flows_after = {f["flow_type"]: f for f in resp_pay_final.json()["flows"]}

    # External is now settled
    assert flows_after["external_transfer"]["pending_amount"] == 0.0
    assert flows_after["external_transfer"]["settled_amount"] == 2000.0
    assert flows_after["external_transfer"]["status"] == "settled"

    # Internal is now settled
    assert flows_after["internal_cash"]["pending_amount"] == 0.0
    assert flows_after["internal_cash"]["settled_amount"] == 850.0
    assert flows_after["internal_cash"]["status"] == "settled"

    # Tax obligation is settled
    assert flows_after["tax_obligation"]["pending_amount"] == 0.0
    assert flows_after["tax_obligation"]["settled_amount"] == 100.0
    assert flows_after["tax_obligation"]["status"] == "settled"

    # Insurance obligation remains pending
    assert flows_after["insurance_obligation"]["pending_amount"] == 170.0
    assert flows_after["insurance_obligation"]["settled_amount"] == 0.0
    assert flows_after["insurance_obligation"]["status"] == "pending"

    # 5. Check Single Employee view
    resp_pay_emp = app_client.get(
        f"/api/finance/reports/payroll/payable-status?period=2026-09&employee_id={emp1_id}",
        cookies=admin_cookies,
    )
    assert resp_pay_emp.status_code == 200
    emp_flows = {f["flow_type"]: f for f in resp_pay_emp.json()["flows"]}
    assert emp_flows["external_transfer"]["status"] == "settled"
    assert emp_flows["internal_cash"]["status"] == "settled"
    assert emp_flows["tax_obligation"]["status"] == "settled"
    assert emp_flows["insurance_obligation"]["status"] == "pending"


def test_custom_date_range_crossing_year_boundary(app_client, admin_cookies):
    """
    AC 5:
    Query a custom date range crossing a calendar year boundary (e.g. 2025-11-01 to 2026-02-28).
    Confirm totals are correct, runs across the boundary are aggregated, and none are skipped or double counted.
    """
    _cleanup()
    emp_id = _setup_employee("Year Crosser", "year.crosser@hrflow.test", ext_amount=1000.0, int_amount=1000.0)

    # Generate runs in 2025-12 and 2026-01
    for label, start, end in [
        ("2025-12", "2025-12-01", "2025-12-31"),
        ("2026-01", "2026-01-01", "2026-01-31"),
    ]:
        resp = app_client.post(
            "/api/finance/payroll/runs/generate",
            json={
                "period_label": label,
                "period_start": start,
                "period_end": end,
                "fx_rate_source": "first_of_month",
                "fx_rate_value": 50.0,
            },
            cookies=admin_cookies,
        )
        assert resp.status_code == 201
        run_id = resp.json()["id"]
        app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies)
        app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=admin_cookies)

    # Query custom date range crossing year boundary
    resp_emp = app_client.get(
        f"/api/finance/reports/compensation/employee/{emp_id}?start_date=2025-11-01&end_date=2026-02-28",
        cookies=admin_cookies,
    )
    assert resp_emp.status_code == 200
    d_emp = resp_emp.json()
    assert d_emp["payroll_runs_count"] == 2
    assert d_emp["total_external"] == 2000.0
    assert d_emp["total_internal"] == 2000.0
    assert d_emp["grand_total"] == 4000.0

    resp_comp = app_client.get(
        "/api/finance/reports/compensation/company?start_date=2025-11-01&end_date=2026-02-28",
        cookies=admin_cookies,
    )
    assert resp_comp.status_code == 200
    assert resp_comp.json()["grand_total"] == 4000.0
    assert resp_comp.json()["payroll_runs_count"] == 2
