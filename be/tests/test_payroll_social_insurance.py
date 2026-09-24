"""
be/tests/test_payroll_social_insurance.py
Targeted verification tests for Social Insurance Deduction from Payroll:
- 2x2 blocking condition matrix
- Insured base <= internal salary validation
- Effective dating: no future pre-staging & finalized-period boundary guard
- Organization-wide rate settings configuration & RBAC gating
- Snapshot immutability: subsequent live edits do not alter finalized runs
- Invariant: post_journal() creates exactly two net cash legs and no liability lines
"""
import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

from models_db import EmployeeDB, EmployeeBankAccountDB, UserDB, EmployeeSocialInsuranceDB
from finance.models import (
    PayrollRunDB,
    PayrollLineDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
    PaymentTypeDB,
    EmployeeCompensationPlanDB,
    PayrollSettingsDB,
)
from db import get_session_factory
from finance.services.payroll_service import PayrollService
from services.social_insurance_service import SocialInsuranceService


@pytest.fixture
def db_session():
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def setup_social_ins_env(db_session):
    """Seed test environment with bank accounts, categories, and clean state."""
    from db import get_engine, Base
    Base.metadata.create_all(bind=get_engine())

    # Ensure bank account
    bank = db_session.query(FinanceBankAccountDB).filter_by(account_number="INS-TEST-BANK").first()
    if not bank:
        bank = FinanceBankAccountDB(
            account_name="Social Ins Test Operating USD",
            bank_name="Test Bank",
            account_number="INS-TEST-BANK",
            currency="USD",
            opening_balance=500000.0,
            current_balance=500000.0,
            is_active=True,
        )
        db_session.add(bank)
        db_session.flush()

    # Ensure transaction category
    cat = db_session.query(TransactionCategoryDB).filter_by(name="Salaries & Wages").first()
    if not cat:
        cat = TransactionCategoryDB(name="Salaries & Wages", kind="cost", is_active=True, sort_order=1)
        db_session.add(cat)
        db_session.flush()

    # Ensure payment type
    pt = db_session.query(PaymentTypeDB).filter_by(code="OUTBOUND_TRANS").first()
    if not pt:
        pt = PaymentTypeDB(name="Outbound Wire", code="OUTBOUND_TRANS", is_active=True)
        db_session.add(pt)
        db_session.flush()

    # Reset default rates
    settings = db_session.query(PayrollSettingsDB).filter_by(id=1).first()
    if not settings:
        settings = PayrollSettingsDB(id=1, employee_rate=0.11, employer_rate=0.18, updated_by="test")
        db_session.add(settings)
    else:
        settings.employee_rate = 0.11
        settings.employer_rate = 0.18
    db_session.commit()

    # Clean existing test data
    db_session.query(PayrollLineDB).delete()
    db_session.query(PayrollRunDB).delete()
    db_session.query(EmployeeSocialInsuranceDB).delete()
    db_session.query(EmployeeCompensationPlanDB).delete()
    db_session.query(EmployeeBankAccountDB).delete()
    db_session.query(EmployeeDB).filter(EmployeeDB.email.like("%@insurancetest.com")).delete()
    db_session.commit()

    yield bank


def test_payroll_rate_settings(app_client, admin_cookies, employee_cookies, db_session, setup_social_ins_env):
    """Verifies reading and updating organization-wide contribution rates with RBAC and validation."""
    # 1. Read default settings
    res = app_client.get("/api/finance/payroll/settings", cookies=admin_cookies)
    assert res.status_code == 200
    data = res.json()
    assert data["employee_rate"] == 0.11
    assert data["employer_rate"] == 0.18

    # 2. Employee cannot update rates (403)
    res_emp = app_client.put(
        "/api/finance/payroll/settings",
        json={"employee_rate": 0.12, "employer_rate": 0.19},
        cookies=employee_cookies,
    )
    assert res_emp.status_code == 403

    # 3. Invalid rates rejected (> 1.0)
    res_bad = app_client.put(
        "/api/finance/payroll/settings",
        json={"employee_rate": 1.5},
        cookies=admin_cookies,
    )
    assert res_bad.status_code == 422 or res_bad.status_code == 400

    # 4. Admin updates rates
    res_upd = app_client.put(
        "/api/finance/payroll/settings",
        json={"employee_rate": 0.12, "employer_rate": 0.19},
        cookies=admin_cookies,
    )
    assert res_upd.status_code == 200
    upd_data = res_upd.json()
    assert upd_data["employee_rate"] == 0.12
    assert upd_data["employer_rate"] == 0.19

    # Re-read
    res_check = app_client.get("/api/finance/payroll/settings", cookies=admin_cookies)
    assert res_check.json()["employee_rate"] == 0.12


def test_social_insurance_validation_and_effective_dating(app_client, admin_cookies, db_session, setup_social_ins_env):
    """Verifies insured base validation (<= internal salary), no future pre-staging, and effective row closure."""
    # Create test employee with $1,000 internal salary
    emp = EmployeeDB(
        name="Insurance Test Employee",
        email="emp1@insurancetest.com",
        role="employee",
        status="Active",
        internal_salary_usd=1000.0,
        external_salary_usd=0.0,
        salary=1000.0,
    )
    db_session.add(emp)
    db_session.commit()

    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    tomorrow_str = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

    # 1. Reject future pre-staging
    res_future = app_client.put(
        f"/api/employees/{emp.id}/social-insurance",
        json={
            "insured_flag": True,
            "insured_base": 500.0,
            "effective_start_date": tomorrow_str,
        },
        cookies=admin_cookies,
    )
    assert res_future.status_code == 400
    assert "cannot be in the future" in res_future.json()["detail"]

    # 2. Save-time does NOT reject base > internal_salary_usd (EGP base is evaluated in payroll with locked FX)
    res_large = app_client.put(
        f"/api/employees/{emp.id}/social-insurance",
        json={
            "insured_flag": True,
            "insured_base": 60000.0,
            "effective_start_date": today_str,
        },
        cookies=admin_cookies,
    )
    assert res_large.status_code == 200
    assert res_large.json()["currency"] == "EGP"
    assert res_large.json()["insured_base"] == 60000.0

    # 3. Valid initial save with EGP currency default
    res_valid = app_client.put(
        f"/api/employees/{emp.id}/social-insurance",
        json={
            "insured_flag": True,
            "insured_base": 6000.0,
            "effective_start_date": today_str,
            "notes": "Initial insurance setup",
        },
        cookies=admin_cookies,
    )
    assert res_valid.status_code == 200
    rec = res_valid.json()
    assert rec["insured_flag"] is True
    assert rec["insured_base"] == 6000.0
    assert rec["currency"] == "EGP"
    assert rec["effective_end_date"] is None

    # 4. Same-date edit updates in place
    res_edit = app_client.put(
        f"/api/employees/{emp.id}/social-insurance",
        json={
            "insured_flag": True,
            "insured_base": 7000.0,
            "effective_start_date": today_str,
            "notes": "Updated in place",
        },
        cookies=admin_cookies,
    )
    assert res_edit.status_code == 200
    assert res_edit.json()["insured_base"] == 7000.0
    assert res_edit.json()["currency"] == "EGP"
    assert res_edit.json()["id"] == rec["id"]


def test_finalized_period_guard(app_client, admin_cookies, db_session, setup_social_ins_env):
    """Verifies that an insurance start date in or before a finalized payroll period is rejected."""
    emp = EmployeeDB(
        name="Finalized Guard Emp",
        email="emp_guard@insurancetest.com",
        role="employee",
        status="Active",
        internal_salary_usd=800.0,
        salary=800.0,
    )
    db_session.add(emp)
    db_session.flush()

    # Create a finalized payroll run ending 2026-08-31
    finalized_run = PayrollRunDB(
        period_label="2026-08",
        period_start="2026-08-01",
        period_end="2026-08-31",
        payment_date="2026-08-31",
        status="finalized",
        total_net=800.0,
    )
    db_session.add(finalized_run)
    db_session.commit()

    # Attempt to set insurance effective in August 2026
    res = app_client.put(
        f"/api/employees/{emp.id}/social-insurance",
        json={
            "insured_flag": True,
            "insured_base": 400.0,
            "effective_start_date": "2026-08-15",
        },
        cookies=admin_cookies,
    )
    assert res.status_code == 400
    assert "already finalized payroll period" in res.json()["detail"]


def test_2x2_blocking_and_calculation_matrix(app_client, db_session, setup_social_ins_env):
    """
    Verifies the full matrix under FUX-421:
    - internal_salary > 0 + flag=True + base=None -> BLOCKED (MISSING_INSURED_BASE)
    - internal_salary > 0 + flag=True + legacy currency='USD' -> BLOCKED (MISSING_INSURED_BASE)
    - internal_salary > 0 + flag=True + base > salary * fx -> BLOCKED (INSURED_BASE_EXCEEDS_SALARY)
    - internal_salary > 0 + flag=True + NET basis -> net_pay protected at 1000 USD, deduction=0, cost includes emp SI
    - internal_salary > 0 + flag=True + GROSS basis -> net_pay reduced by employee SI USD equivalent
    - internal_salary > 0 + flag=False -> deduction=0, cost=0
    - internal_salary == 0 + flag=True -> deduction=0, cost=0
    """
    # 1. Employee A: Missing base blocker
    emp_a = EmployeeDB(
        name="Employee A (Missing Base)",
        email="emp_a@insurancetest.com",
        status="Active",
        internal_salary_usd=1000.0,
        salary=1000.0,
    )
    # 2. Employee B: Insured with base (NET basis)
    emp_b = EmployeeDB(
        name="Employee B (Insured NET)",
        email="emp_b@insurancetest.com",
        status="Active",
        internal_salary_usd=1000.0,
        salary=1000.0,
    )
    # 3. Employee B2: Insured with base (GROSS basis)
    emp_b2 = EmployeeDB(
        name="Employee B2 (Insured GROSS)",
        email="emp_b2@insurancetest.com",
        status="Active",
        internal_salary_usd=1000.0,
        salary=1000.0,
    )
    # 4. Employee C: Not insured
    emp_c = EmployeeDB(
        name="Employee C (Not Insured)",
        email="emp_c@insurancetest.com",
        status="Active",
        internal_salary_usd=1000.0,
        salary=1000.0,
    )
    # 5. Employee D: Zero internal salary (external USD only)
    emp_d = EmployeeDB(
        name="Employee D (External Only)",
        email="emp_d@insurancetest.com",
        status="Active",
        internal_salary_usd=0.0,
        external_salary_usd=2000.0,
        salary=2000.0,
    )
    # 6. Employee Legacy: legacy USD currency row
    emp_leg = EmployeeDB(
        name="Employee Legacy USD",
        email="emp_leg@insurancetest.com",
        status="Active",
        internal_salary_usd=1000.0,
        salary=1000.0,
    )
    # 7. Employee Exceed: insured base exceeds internal salary * fx
    emp_exc = EmployeeDB(
        name="Employee Exceeds Base",
        email="emp_exc@insurancetest.com",
        status="Active",
        internal_salary_usd=1000.0,
        salary=1000.0,
    )
    db_session.add_all([emp_a, emp_b, emp_b2, emp_c, emp_d, emp_leg, emp_exc])
    db_session.flush()

    # Add compensation plans
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_a.id, component_type="internal_usd_cash", amount=1000.0, salary_basis="NET", effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_b.id, component_type="internal_usd_cash", amount=1000.0, salary_basis="NET", effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_b2.id, component_type="internal_usd_cash", amount=1000.0, salary_basis="GROSS", effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_c.id, component_type="internal_usd_cash", amount=1000.0, salary_basis="NET", effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_d.id, component_type="external_usd", amount=2000.0, salary_basis="NET", effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_leg.id, component_type="internal_usd_cash", amount=1000.0, salary_basis="NET", effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_exc.id, component_type="internal_usd_cash", amount=1000.0, salary_basis="NET", effective_start_date="2026-01-01"))

    # Add bank account for external emp_d
    db_session.add(EmployeeBankAccountDB(employee_id=emp_d.id, bank_name="Chase", iban="EG1234567890123456"))

    # Configure social insurance records:
    # emp_a: flag=True, base=None
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_a.id, insured_flag=True, insured_base=None, currency="EGP", effective_start_date="2026-01-01"))
    # emp_b: flag=True, base=5000.0 EGP (NET)
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_b.id, insured_flag=True, insured_base=5000.0, currency="EGP", effective_start_date="2026-01-01"))
    # emp_b2: flag=True, base=5000.0 EGP (GROSS)
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_b2.id, insured_flag=True, insured_base=5000.0, currency="EGP", effective_start_date="2026-01-01"))
    # emp_c: flag=False
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_c.id, insured_flag=False, insured_base=None, currency="EGP", effective_start_date="2026-01-01"))
    # emp_d: flag=True, base=5000.0 EGP (external USD only)
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_d.id, insured_flag=True, insured_base=5000.0, currency="EGP", effective_start_date="2026-01-01"))
    # emp_leg: legacy USD row
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_leg.id, insured_flag=True, insured_base=500.0, currency="USD", effective_start_date="2026-01-01"))
    # emp_exc: insured base 60,000 EGP > 1000 USD * 50 = 50,000 EGP
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_exc.id, insured_flag=True, insured_base=60000.0, currency="EGP", effective_start_date="2026-01-01"))
    db_session.commit()

    service = PayrollService(db_session)
    preview = service.preview_run(
        period_label="2026-09",
        period_start="2026-09-01",
        period_end="2026-09-30",
        fx_rate_value=50.0,
    )

    # 1. Blocker checks
    assert preview["has_blocking_exceptions"] is True
    # Employee A: Missing base blocker
    exc_a = next((e for e in preview["exceptions"] if e["employee_id"] == emp_a.id), None)
    assert exc_a is not None
    assert exc_a["severity"] == "blocking"
    assert exc_a["code"] == "MISSING_INSURED_BASE"

    # Employee Legacy: Legacy USD blocker
    exc_leg = next((e for e in preview["exceptions"] if e["employee_id"] == emp_leg.id), None)
    assert exc_leg is not None
    assert exc_leg["severity"] == "blocking"
    assert exc_leg["code"] == "MISSING_INSURED_BASE"
    assert "legacy USD currency" in exc_leg["description"]

    # Employee Exceeds: Insured base exceeds salary blocker
    exc_exc = next((e for e in preview["exceptions"] if e["employee_id"] == emp_exc.id), None)
    assert exc_exc is not None
    assert exc_exc["severity"] == "blocking"
    assert exc_exc["code"] == "INSURED_BASE_EXCEEDS_SALARY"

    # 2. Check lines for Employee B (NET basis)
    # Insured base = 5000 EGP, emp rate = 11%, org rate = 18%, fx = 50.0
    # Emp SI = 550 EGP ($11.0 USD eq), Org SI = 900 EGP ($18.0 USD eq)
    # Under NET basis: net_pay = 1000.0 USD, deductions_total = 0.0 USD, employer_cost_extra = 18.0 + 11.0 = 29.0 USD
    line_b = next(l for l in preview["lines"] if l["employee_id"] == emp_b.id)
    assert line_b["base_salary"] == 1000.0
    assert line_b["deductions_total"] == 0.0
    assert line_b["net_pay"] == 1000.0
    assert line_b["employer_cost_extra"] == 29.0
    assert line_b["salary_basis_snapshot"] == "NET"
    assert line_b["configured_internal_salary_usd_snapshot"] == 1000.0
    assert line_b["insured_base_egp_snapshot"] == 5000.0
    assert line_b["employee_social_insurance_egp"] == 550.0
    assert line_b["employer_social_insurance_egp"] == 900.0
    assert line_b["total_social_insurance_egp"] == 1450.0
    assert line_b["employee_social_insurance_usd_equivalent"] == 11.0
    assert line_b["final_internal_net_egp"] == 50000.0
    assert line_b["final_internal_payment_usd"] == 1000

    # 3. Check lines for Employee B2 (GROSS basis)
    # Gross EGP = 50000. Emp SI = 550 EGP ($11.0 USD eq).
    # Final internal net EGP = 50000 - 550 = 49450 EGP.
    # Final internal payment USD = round(49450 / 50) = 989 USD.
    line_b2 = next(l for l in preview["lines"] if l["employee_id"] == emp_b2.id)
    assert line_b2["base_salary"] == 1000.0
    assert line_b2["deductions_total"] == 11.0
    assert line_b2["net_pay"] == 989.0
    assert line_b2["employer_cost_extra"] == 18.0
    assert line_b2["salary_basis_snapshot"] == "GROSS"
    assert line_b2["employee_social_insurance_egp"] == 550.0
    assert line_b2["employer_social_insurance_egp"] == 900.0
    assert line_b2["final_internal_net_egp"] == 49450.0
    assert line_b2["final_internal_payment_usd"] == 989

    # 4. Check lines for Employee C (flag=False -> deduction=0, cost=0, net=1000)
    line_c = next(l for l in preview["lines"] if l["employee_id"] == emp_c.id)
    assert line_c["deductions_total"] == 0.0
    assert line_c["net_pay"] == 1000.0
    assert line_c["employer_cost_extra"] == 0.0

    # 5. Check lines for Employee D (external only -> deduction=0, cost=0, net=2000)
    line_d = next(l for l in preview["lines"] if l["employee_id"] == emp_d.id)
    assert line_d["deductions_total"] == 0.0
    assert line_d["net_pay"] == 2000.0
    assert line_d["employer_cost_extra"] == 0.0


def test_snapshot_immutability_and_post_journal(app_client, db_session, setup_social_ins_env):
    """
    Verifies that:
    1. Line inputs and EGP statutory snapshots are frozen upon run generation/creation/finalization.
    2. Modifying live rates or insured base afterwards does not affect the finalized run.
    3. post_journal() produces only the two net cash legs.
    """
    bank = setup_social_ins_env

    # Inactivate any seeded employees
    db_session.query(EmployeeDB).update({EmployeeDB.status: "Inactive"})
    db_session.commit()

    # Setup 2 employees: 1 internal insured (NET), 1 external
    emp_int = EmployeeDB(name="Int Emp", email="int@insurancetest.com", status="Active", internal_salary_usd=1200.0, salary=1200.0)
    emp_ext = EmployeeDB(name="Ext Emp", email="ext@insurancetest.com", status="Active", external_salary_usd=2500.0, salary=2500.0)
    db_session.add_all([emp_int, emp_ext])
    db_session.flush()

    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_int.id, component_type="internal_usd_cash", amount=1200.0, salary_basis="NET", effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_ext.id, component_type="external_usd", amount=2500.0, salary_basis="NET", effective_start_date="2026-01-01"))
    db_session.add(EmployeeBankAccountDB(employee_id=emp_ext.id, bank_name="Chase", iban="EG9998887776665554"))
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_int.id, insured_flag=True, insured_base=6000.0, currency="EGP", effective_start_date="2026-01-01"))
    db_session.commit()

    service = PayrollService(db_session)
    # Generate run at fx=50.0
    run_dict = service.generate_run_from_compensation_plans(
        period_label="2026-09",
        period_start="2026-09-01",
        period_end="2026-09-30",
        bank_account_id=bank.id,
        fx_rate_value=50.0,
    )
    run_id = run_dict["id"]

    # Verify line snapshot values
    # Base: 6000 EGP. Emp SI = 660 EGP ($13.20 USD eq). Org SI = 1080 EGP ($21.60 USD eq).
    # NET basis: net_pay = 1200.0, deductions_total = 0.0, employer_cost_extra = 21.60 + 13.20 = 34.80 USD
    line_int = db_session.query(PayrollLineDB).filter_by(payroll_run_id=run_id, employee_id=emp_int.id).first()
    assert line_int.base_salary == 1200.0
    assert line_int.deductions_total == 0.0
    assert line_int.net_pay == 1200.0
    assert line_int.employer_cost_extra == 34.8
    assert line_int.insured_base_snapshot == 6000.0
    assert line_int.employee_rate_snapshot == 0.11
    assert line_int.employer_rate_snapshot == 0.18
    assert line_int.salary_basis_snapshot == "NET"
    assert line_int.insured_base_egp_snapshot == 6000.0
    assert line_int.employee_social_insurance_egp == 660.0
    assert line_int.employer_social_insurance_egp == 1080.0
    assert line_int.total_social_insurance_egp == 1740.0
    assert line_int.employee_social_insurance_usd_equivalent == 13.2
    assert line_int.final_internal_payment_usd == 1200

    # Verify run rollups
    run_db = db_session.query(PayrollRunDB).filter_by(id=run_id).first()
    assert run_db.total_social_insurance_egp == 1740.0
    assert run_db.total_employee_tax_egp == 0.0

    # Finalize the run
    run_db.status = "finalized"
    db_session.commit()

    # Now change organization rates to 15% and 20%
    service.update_payroll_settings(employee_rate=0.15, employer_rate=0.20, user_email="admin@voyance.com")
    # And change employee insured base to 8000.0 EGP
    soc_ins = db_session.query(EmployeeSocialInsuranceDB).filter_by(employee_id=emp_int.id).first()
    soc_ins.insured_base = 8000.0
    db_session.commit()

    # Verify finalized run lines remain completely unchanged!
    db_session.refresh(line_int)
    assert line_int.deductions_total == 0.0
    assert line_int.net_pay == 1200.0
    assert line_int.employer_cost_extra == 34.8
    assert line_int.insured_base_snapshot == 6000.0
    assert line_int.employee_rate_snapshot == 0.11
    assert line_int.employer_rate_snapshot == 0.18
    assert line_int.insured_base_egp_snapshot == 6000.0
    assert line_int.employee_social_insurance_egp == 660.0

    # Verify post_journal() posts exactly 2 cash legs (1 for ext_net $2500, 1 for int_net $1200)
    journal_res = service.post_journal(run_id, user_email="admin@voyance.com")
    assert journal_res["success"] is True

    # Inspect ledger transactions created
    txs = db_session.query(LedgerTransactionDB).filter(LedgerTransactionDB.reference.like("PAYROLL-2026-09%")).all()
    assert len(txs) == 2
    refs = {t.reference for t in txs}
    assert refs == {"PAYROLL-2026-09-EXT", "PAYROLL-2026-09-INT"}

    tx_ext = next(t for t in txs if t.reference == "PAYROLL-2026-09-EXT")
    tx_int = next(t for t in txs if t.reference == "PAYROLL-2026-09-INT")
    assert tx_ext.amount == 2500.0
    assert tx_int.amount == 1200.0


def test_payroll_csv_export_one_row_per_employee(app_client, admin_cookies, db_session, setup_social_ins_env):
    """Verifies that export_run_csv outputs exactly one row per employee with statutory columns (D-007)."""
    bank = setup_social_ins_env
    db_session.query(EmployeeDB).update({EmployeeDB.status: "Inactive"})
    db_session.commit()

    emp1 = EmployeeDB(name="Emp One", email="emp1@insurancetest.com", status="Active", internal_salary_usd=1000.0, salary=1000.0)
    emp2 = EmployeeDB(name="Emp Two", email="emp2@insurancetest.com", status="Active", external_salary_usd=1500.0, salary=1500.0)
    db_session.add_all([emp1, emp2])
    db_session.flush()

    db_session.add(EmployeeCompensationPlanDB(employee_id=emp1.id, component_type="internal_usd_cash", amount=1000.0, salary_basis="NET", effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp2.id, component_type="external_usd", amount=1500.0, salary_basis="NET", effective_start_date="2026-01-01"))
    db_session.add(EmployeeBankAccountDB(employee_id=emp2.id, bank_name="TestBank", iban="EG1122334455667788"))
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp1.id, insured_flag=True, insured_base=5000.0, currency="EGP", effective_start_date="2026-01-01"))
    db_session.commit()

    service = PayrollService(db_session)
    run_dict = service.generate_run_from_compensation_plans(
        period_label="2026-10",
        period_start="2026-10-01",
        period_end="2026-10-31",
        bank_account_id=bank.id,
        fx_rate_value=50.0,
    )
    run_id = run_dict["id"]

    res = app_client.get(f"/api/finance/payroll/runs/{run_id}/export", cookies=admin_cookies)
    assert res.status_code == 200
    csv_text = res.text
    lines = [line.strip() for line in csv_text.strip().splitlines() if line.strip()]
    # Exactly header + 2 employees = 3 lines!
    assert len(lines) == 3

    header = lines[0]
    assert "Employee ID,Employee Name,Department,Base INT,Base EXT,Commissions,Bonuses,Other Additions,Final INT,Final EXT,Final Payment,Payment Status,Payment Reference" in header
    assert "Salary Basis,Insured Base EGP,Employee SI EGP,Employer SI EGP,Total SI EGP,Employee Tax EGP,Employee SI USD Eq,Employee Tax USD Eq,FX Rate" in header

    # Employee 1 line
    emp1_row = next(l for l in lines[1:] if "Emp One" in l)
    assert "NET" in emp1_row
    assert "5000.00" in emp1_row
    assert "550.00" in emp1_row
    assert "900.00" in emp1_row
    assert "1450.00" in emp1_row
    assert "11.00" in emp1_row


def test_locked_fx_rate_variance(db_session, setup_social_ins_env):
    """Verifies that two runs at different locked FX rates produce independent, historically stable EGP and USD outcomes."""
    bank = setup_social_ins_env
    db_session.query(EmployeeDB).update({EmployeeDB.status: "Inactive"})
    db_session.commit()

    emp = EmployeeDB(name="FX Emp", email="fx_emp@insurancetest.com", status="Active", internal_salary_usd=1000.0, salary=1000.0)
    db_session.add(emp)
    db_session.flush()

    db_session.add(EmployeeCompensationPlanDB(employee_id=emp.id, component_type="internal_usd_cash", amount=1000.0, salary_basis="GROSS", effective_start_date="2026-01-01"))
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp.id, insured_flag=True, insured_base=5000.0, currency="EGP", effective_start_date="2026-01-01"))
    db_session.commit()

    service = PayrollService(db_session)

    # Run 1 with FX = 50.0
    # Gross EGP = 50,000. Emp SI = 550 EGP. Net EGP = 49,450. USD net = round(49450 / 50) = 989.
    p1 = service.preview_run("2026-09", "2026-09-01", "2026-09-30", fx_rate_value=50.0)
    l1 = p1["lines"][0]
    assert l1["base_gross_egp"] == 50000.0
    assert l1["final_internal_payment_usd"] == 989
    assert l1["employee_social_insurance_usd_equivalent"] == 11.0

    # Run 2 with FX = 40.0
    # Gross EGP = 40,000. Emp SI = 550 EGP. Net EGP = 39,450. USD net = round(39450 / 40) = 986. Emp SI USD eq = 550 / 40 = 13.75.
    p2 = service.preview_run("2026-10", "2026-10-01", "2026-10-31", fx_rate_value=40.0)
    l2 = p2["lines"][0]
    assert l2["base_gross_egp"] == 40000.0
    assert l2["final_internal_payment_usd"] == 986
    assert l2["employee_social_insurance_usd_equivalent"] == 13.75

