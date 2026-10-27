"""
be/tests/test_analytics_employee_pay_unit.py
Composer unit tests for EmployeePayService:
- No payroll
- One run
- Several runs
- Commission-only month
- Bonus month
- Quarterly vs Monthly aggregation
- Raise inside and outside period
- Mixed run statuses (draft, paid, pending, cancelled excluded)
- Two currencies (filtering and currencies_available)
"""
import pytest
from datetime import datetime
from db import get_db_context
from models_db import EmployeeDB, SalaryHistoryDB
from finance.models import (
    PayrollRunDB,
    PayrollLineDB,
    FinanceBankAccountDB,
    EmployeeCompensationPlanDB,
)
from repositories.sql.employees import SqlEmployeeRepository
from finance.services.payroll_read_service import PayrollReadService
from finance.services.compensation_plan_service import CompensationPlanService
from analytics.services.employee_pay_service import EmployeePayService


@pytest.fixture
def pay_unit_env(app_client):
    """Sets up a clean test environment with bank accounts, an employee, and services."""
    with get_db_context() as db:
        ext_bank = db.query(FinanceBankAccountDB).filter_by(account_number="BANK-EXT-UNIT").first()
        if not ext_bank:
            ext_bank = FinanceBankAccountDB(
                account_name="Unit Wire Bank",
                bank_name="Unit Chase",
                account_number="BANK-EXT-UNIT",
                currency="USD",
                opening_balance=1000000.0,
                current_balance=1000000.0,
                is_active=True,
            )
            db.add(ext_bank)

        int_bank = db.query(FinanceBankAccountDB).filter_by(account_number="BANK-INT-UNIT").first()
        if not int_bank:
            int_bank = FinanceBankAccountDB(
                account_name="Unit Cash Drawer",
                bank_name="Unit Cash",
                account_number="BANK-INT-UNIT",
                currency="USD",
                opening_balance=500000.0,
                current_balance=500000.0,
                is_active=True,
            )
            db.add(int_bank)

        emp = EmployeeDB(
            name="Charlie Pay",
            email="charlie.pay@voyance.health",
            dept="Product",
            job_role="Senior Product Manager",
            status="active",
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)

        p_ext = EmployeeCompensationPlanDB(
            employee_id=emp.id,
            component_type="external_usd",
            amount=8000.0,
            currency="USD",
            effective_start_date="2026-01-01",
        )
        p_int = EmployeeCompensationPlanDB(
            employee_id=emp.id,
            component_type="internal_usd_cash",
            amount=4000.0,
            currency="USD",
            effective_start_date="2026-01-01",
        )
        db.add_all([p_ext, p_int])

        # Salary history (raises)
        h1 = SalaryHistoryDB(
            employee_id=emp.id,
            date="2025-06-01",
            reason="Mid-year review",
            applied_by="hr@voyance.health",
        )
        h2 = SalaryHistoryDB(
            employee_id=emp.id,
            date="2026-01-01",
            reason="Promotion to Lead PM",
            applied_by="hr@voyance.health",
        )
        db.add_all([h1, h2])
        db.commit()

        emp_id = emp.id
        ext_bank_id = ext_bank.id
        int_bank_id = int_bank.id

    return {
        "emp_id": emp_id,
        "ext_bank_id": ext_bank_id,
        "int_bank_id": int_bank_id,
    }


def _get_service(db):
    employee_repo = SqlEmployeeRepository()
    payroll_read_service = PayrollReadService(db)
    comp_plan_service = CompensationPlanService(db)
    return EmployeePayService(
        db=db,
        employee_repo=employee_repo,
        payroll_read_service=payroll_read_service,
        comp_plan_service=comp_plan_service,
    )


def test_composer_no_payroll(pay_unit_env):
    """When employee has no payroll runs, payments totals are 0 and series is empty."""
    emp_id = pay_unit_env["emp_id"]
    with get_db_context() as db:
        service = _get_service(db)
        res = service.get_employee_pay_view(emp_id)

    assert res["employee"]["id"] == emp_id
    assert res["employee"]["name"] == "Charlie Pay"
    assert res["employee"]["department"] == "Product"
    assert res["currencies_available"] == ["USD"]

    payments = res["payments"]
    assert payments["totals"]["cycles"] == 0
    assert payments["totals"]["total"] == 0.0
    assert payments["totals"]["buckets_with_commission"] == 0
    assert payments["series"] == []

    plan = res["plan"]
    assert plan["current"]["internal"] == 4000.0
    assert plan["current"]["external"] == 8000.0
    assert plan["current"]["total"] == 12000.0
    assert len(plan["changes"]) == 2


def _seed_runs(db, emp_id):
    # Run 1: 2026-06 (Base EXT 8000, Base INT 4000) - Paid
    r1 = PayrollRunDB(
        period_label="2026-06",
        period_start="2026-06-01",
        period_end="2026-06-30",
        status="paid",
        currency="USD",
        paid_at=datetime(2026, 7, 1, 10, 0, 0),
    )
    db.add(r1)
    db.flush()
    db.add(PayrollLineDB(payroll_run_id=r1.id, employee_id=emp_id, compensation_type="external_usd", base_salary=8000.0, payment_status="paid"))
    db.add(PayrollLineDB(payroll_run_id=r1.id, employee_id=emp_id, compensation_type="internal_usd_cash", base_salary=4000.0, payment_status="paid"))

    # Run 2: 2026-07 (Base EXT 8000, Base INT 4000 + Commission 1500) - Paid
    r2 = PayrollRunDB(
        period_label="2026-07",
        period_start="2026-07-01",
        period_end="2026-07-31",
        status="paid",
        currency="USD",
        paid_at=datetime(2026, 8, 1, 10, 0, 0),
    )
    db.add(r2)
    db.flush()
    db.add(PayrollLineDB(payroll_run_id=r2.id, employee_id=emp_id, compensation_type="external_usd", base_salary=8000.0, payment_status="paid"))
    db.add(PayrollLineDB(payroll_run_id=r2.id, employee_id=emp_id, compensation_type="internal_usd_cash", base_salary=4000.0, payment_status="paid"))
    db.add(PayrollLineDB(payroll_run_id=r2.id, employee_id=emp_id, compensation_type="commission_sales", base_salary=1500.0, payment_status="paid"))

    # Run 3: 2026-08 (Base EXT 8000, Base INT 4000 + Bonus 2000) - Paid
    r3 = PayrollRunDB(
        period_label="2026-08",
        period_start="2026-08-01",
        period_end="2026-08-31",
        status="paid",
        currency="USD",
        paid_at=datetime(2026, 9, 1, 10, 0, 0),
    )
    db.add(r3)
    db.flush()
    db.add(PayrollLineDB(payroll_run_id=r3.id, employee_id=emp_id, compensation_type="external_usd", base_salary=8000.0, payment_status="paid"))
    db.add(PayrollLineDB(payroll_run_id=r3.id, employee_id=emp_id, compensation_type="internal_usd_cash", base_salary=4000.0, payment_status="paid"))
    db.add(PayrollLineDB(payroll_run_id=r3.id, employee_id=emp_id, compensation_type="bonus", base_salary=2000.0, payment_status="paid"))

    # Run 4: 2026-09 Commission-only run
    r4 = PayrollRunDB(
        period_label="2026-09",
        period_start="2026-09-01",
        period_end="2026-09-30",
        status="paid",
        currency="USD",
        paid_at=datetime(2026, 10, 1, 10, 0, 0),
    )
    db.add(r4)
    db.flush()
    db.add(PayrollLineDB(payroll_run_id=r4.id, employee_id=emp_id, compensation_type="commission_support", base_salary=500.0, payment_status="paid"))
    db.commit()


def test_composer_one_and_several_runs_with_commissions_and_bonuses(pay_unit_env):
    """Tests one run, several runs, commission-only and bonus months."""
    emp_id = pay_unit_env["emp_id"]
    with get_db_context() as db:
        _seed_runs(db, emp_id)
        service = _get_service(db)
        res = service.get_employee_pay_view(emp_id, start_date="2026-06-01", end_date="2026-09-30")

    payments = res["payments"]
    totals = payments["totals"]
    series = payments["series"]

    assert len(series) == 4
    assert totals["cycles"] == 4
    assert totals["buckets_with_commission"] == 2  # Jul and Sep

    # Assert totals equal sum of series (AC 3)
    assert totals["base_external"] == round(sum(s["base_external"] for s in series), 2)
    assert totals["base_internal"] == round(sum(s["base_internal"] for s in series), 2)
    assert totals["commission"] == round(sum(s["commission"] for s in series), 2)
    assert totals["bonus"] == round(sum(s["bonus"] for s in series), 2)
    assert totals["total"] == round(sum(s["total"] for s in series), 2)

    # Specific series checks
    # June: base only
    assert series[0]["bucket"] == "2026-06"
    assert series[0]["base_external"] == 8000.0
    assert series[0]["base_internal"] == 4000.0
    assert series[0]["commission"] == 0.0
    assert series[0]["bonus"] == 0.0
    assert series[0]["total"] == 12000.0
    assert series[0]["payment_status"] == "paid"

    # July: base + commission
    assert series[1]["bucket"] == "2026-07"
    assert series[1]["commission"] == 1500.0
    assert series[1]["total"] == 13500.0

    # August: base + bonus
    assert series[2]["bucket"] == "2026-08"
    assert series[2]["bonus"] == 2000.0
    assert series[2]["total"] == 14000.0

    # September: commission-only
    assert series[3]["bucket"] == "2026-09"
    assert series[3]["base_external"] == 0.0
    assert series[3]["base_internal"] == 0.0
    assert series[3]["commission"] == 500.0
    assert series[3]["total"] == 500.0


def test_composer_quarterly_grouping_equals_sum_of_months(pay_unit_env):
    """AC 3: Quarterly grouping sums months of the quarter; totals equal sum of series."""
    emp_id = pay_unit_env["emp_id"]
    with get_db_context() as db:
        _seed_runs(db, emp_id)
        service = _get_service(db)
        res_m = service.get_employee_pay_view(emp_id, start_date="2026-06-01", end_date="2026-09-30", group_by="month")
        res_q = service.get_employee_pay_view(emp_id, start_date="2026-06-01", end_date="2026-09-30", group_by="quarter")

    monthly_totals = res_m["payments"]["totals"]
    quarterly_totals = res_q["payments"]["totals"]

    assert monthly_totals["total"] == quarterly_totals["total"]
    assert monthly_totals["base_external"] == quarterly_totals["base_external"]
    assert monthly_totals["base_internal"] == quarterly_totals["base_internal"]
    assert monthly_totals["commission"] == quarterly_totals["commission"]
    assert monthly_totals["bonus"] == quarterly_totals["bonus"]

    # In quarterly: 2026-06 is Q2; 2026-07, 2026-08, 2026-09 are Q3
    q_series = res_q["payments"]["series"]
    assert len(q_series) == 2
    assert q_series[0]["bucket"] == "2026-Q2"
    assert q_series[0]["label"] == "Q2 2026"
    assert q_series[0]["total"] == 12000.0

    assert q_series[1]["bucket"] == "2026-Q3"
    assert q_series[1]["label"] == "Q3 2026"
    assert q_series[1]["total"] == round(13500.0 + 14000.0 + 500.0, 2)


def test_composer_mixed_run_statuses_and_cancellation(pay_unit_env):
    """AC 4: Cancelled runs excluded, draft runs show draft status, mixed show mixed."""
    emp_id = pay_unit_env["emp_id"]
    with get_db_context() as db:
        # Run A: Cancelled run in 2026-10 (should be completely omitted)
        r_canc = PayrollRunDB(
            period_label="2026-10",
            period_start="2026-10-01",
            period_end="2026-10-31",
            status="cancelled",
            currency="USD",
        )
        db.add(r_canc)
        db.flush()
        db.add(PayrollLineDB(payroll_run_id=r_canc.id, employee_id=emp_id, compensation_type="external_usd", base_salary=99999.0))

        # Run B: Draft run in 2026-11 (should appear as draft per Decision 6)
        r_draft = PayrollRunDB(
            period_label="2026-11",
            period_start="2026-11-01",
            period_end="2026-11-30",
            status="draft",
            currency="USD",
        )
        db.add(r_draft)
        db.flush()
        db.add(PayrollLineDB(payroll_run_id=r_draft.id, employee_id=emp_id, compensation_type="external_usd", base_salary=8000.0, payment_status="pending"))

        # Run C: Mixed run in 2026-12 (one line paid, one line pending)
        r_mixed = PayrollRunDB(
            period_label="2026-12",
            period_start="2026-12-01",
            period_end="2026-12-31",
            status="partially_paid",
            currency="USD",
        )
        db.add(r_mixed)
        db.flush()
        db.add(PayrollLineDB(payroll_run_id=r_mixed.id, employee_id=emp_id, compensation_type="external_usd", base_salary=8000.0, payment_status="paid"))
        db.add(PayrollLineDB(payroll_run_id=r_mixed.id, employee_id=emp_id, compensation_type="internal_usd_cash", base_salary=4000.0, payment_status="pending"))

        db.commit()

        service = _get_service(db)
        res = service.get_employee_pay_view(emp_id, start_date="2026-10-01", end_date="2026-12-31")

    series = res["payments"]["series"]
    buckets = {s["bucket"]: s for s in series}

    # Cancelled run 2026-10 must not be in series
    assert "2026-10" not in buckets

    # Draft run 2026-11 has payment_status == "draft"
    assert buckets["2026-11"]["payment_status"] == "draft"
    assert buckets["2026-11"]["base_external"] == 8000.0

    # Partially paid run 2026-12 has payment_status == "mixed"
    assert buckets["2026-12"]["payment_status"] == "mixed"


def test_composer_currency_filter_and_currencies_available(pay_unit_env):
    """AC 6: Currency filter applied, no cross-currency sum, currencies_available correct."""
    emp_id = pay_unit_env["emp_id"]
    with get_db_context() as db:
        # Seed standard USD runs
        _seed_runs(db, emp_id)

        # Create an EUR run in 2026-11
        r_eur = PayrollRunDB(
            period_label="2026-11-EUR",
            period_start="2026-11-01",
            period_end="2026-11-30",
            status="paid",
            currency="EUR",
        )
        db.add(r_eur)
        db.flush()
        db.add(PayrollLineDB(payroll_run_id=r_eur.id, employee_id=emp_id, compensation_type="external_usd", base_salary=7000.0, payment_status="paid"))
        db.commit()

        service = _get_service(db)
        # Query default USD
        res_usd = service.get_employee_pay_view(emp_id, currency="USD")
        # Query EUR
        res_eur = service.get_employee_pay_view(emp_id, currency="EUR")

    # currencies_available must contain both EUR and USD
    assert "EUR" in res_usd["currencies_available"]
    assert "USD" in res_usd["currencies_available"]

    # EUR lines must not leak into USD report
    usd_buckets = {s["bucket"]: s for s in res_usd["payments"]["series"]}
    # USD runs are from 2026-06 to 2026-09
    assert "2026-11" not in usd_buckets

    # EUR report has 7000 in 2026-11
    eur_buckets = {s["bucket"]: s for s in res_eur["payments"]["series"]}
    assert eur_buckets["2026-11"]["base_external"] == 7000.0

