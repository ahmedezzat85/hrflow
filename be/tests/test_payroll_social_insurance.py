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

    # 2. Reject insured base > internal salary
    res_excess = app_client.put(
        f"/api/employees/{emp.id}/social-insurance",
        json={
            "insured_flag": True,
            "insured_base": 1200.0,
            "effective_start_date": today_str,
        },
        cookies=admin_cookies,
    )
    assert res_excess.status_code == 400
    assert "cannot exceed employee internal salary" in res_excess.json()["detail"]

    # 3. Valid initial save
    res_valid = app_client.put(
        f"/api/employees/{emp.id}/social-insurance",
        json={
            "insured_flag": True,
            "insured_base": 600.0,
            "effective_start_date": today_str,
            "notes": "Initial insurance setup",
        },
        cookies=admin_cookies,
    )
    assert res_valid.status_code == 200
    rec = res_valid.json()
    assert rec["insured_flag"] is True
    assert rec["insured_base"] == 600.0
    assert rec["effective_end_date"] is None

    # 4. Same-date edit updates in place
    res_edit = app_client.put(
        f"/api/employees/{emp.id}/social-insurance",
        json={
            "insured_flag": True,
            "insured_base": 700.0,
            "effective_start_date": today_str,
            "notes": "Updated in place",
        },
        cookies=admin_cookies,
    )
    assert res_edit.status_code == 200
    assert res_edit.json()["insured_base"] == 700.0
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
    Verifies the full 2x2 matrix:
    - internal_salary > 0 + flag=True + base=None -> BLOCKED (MISSING_INSURED_BASE)
    - internal_salary > 0 + flag=True + base=500 -> Net pay reduced by 55 (11%), cost=90 (18%)
    - internal_salary > 0 + flag=False -> Deduction=0, no block
    - internal_salary == 0 + flag=True -> Deduction=0, no block
    """
    # 1. Employee A: Missing base blocker
    emp_a = EmployeeDB(
        name="Employee A (Missing Base)",
        email="emp_a@insurancetest.com",
        status="Active",
        internal_salary_usd=1000.0,
        salary=1000.0,
    )
    # 2. Employee B: Insured with base
    emp_b = EmployeeDB(
        name="Employee B (Insured Base)",
        email="emp_b@insurancetest.com",
        status="Active",
        internal_salary_usd=1000.0,
        salary=1000.0,
    )
    # 3. Employee C: Not insured
    emp_c = EmployeeDB(
        name="Employee C (Not Insured)",
        email="emp_c@insurancetest.com",
        status="Active",
        internal_salary_usd=1000.0,
        salary=1000.0,
    )
    # 4. Employee D: Zero internal salary (external USD only)
    emp_d = EmployeeDB(
        name="Employee D (External Only)",
        email="emp_d@insurancetest.com",
        status="Active",
        internal_salary_usd=0.0,
        external_salary_usd=2000.0,
        salary=2000.0,
    )
    db_session.add_all([emp_a, emp_b, emp_c, emp_d])
    db_session.flush()

    # Add compensation plans
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_a.id, component_type="internal_usd_cash", amount=1000.0, effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_b.id, component_type="internal_usd_cash", amount=1000.0, effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_c.id, component_type="internal_usd_cash", amount=1000.0, effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_d.id, component_type="external_usd", amount=2000.0, effective_start_date="2026-01-01"))

    # Add bank account for external emp_d
    db_session.add(EmployeeBankAccountDB(employee_id=emp_d.id, bank_name="Chase", iban="EG1234567890123456"))

    # Configure social insurance records:
    # emp_a: flag=True, base=None
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_a.id, insured_flag=True, insured_base=None, effective_start_date="2026-01-01"))
    # emp_b: flag=True, base=500.0
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_b.id, insured_flag=True, insured_base=500.0, effective_start_date="2026-01-01"))
    # emp_c: flag=False
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_c.id, insured_flag=False, insured_base=None, effective_start_date="2026-01-01"))
    # emp_d: flag=True, base=500.0 (but internal_salary is 0)
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_d.id, insured_flag=True, insured_base=500.0, effective_start_date="2026-01-01"))
    db_session.commit()

    service = PayrollService(db_session)
    preview = service.preview_run(
        period_label="2026-09",
        period_start="2026-09-01",
        period_end="2026-09-30",
    )

    # 1. Blocker check for Employee A
    assert preview["has_blocking_exceptions"] is True
    exc_a = next((e for e in preview["exceptions"] if e["employee_id"] == emp_a.id), None)
    assert exc_a is not None
    assert exc_a["severity"] == "blocking"
    assert exc_a["code"] == "MISSING_INSURED_BASE"

    # 2. Check lines for Employee B (Deduction 55.00, Employer Cost 90.00, Net Pay 945.00)
    line_b = next(l for l in preview["lines"] if l["employee_id"] == emp_b.id)
    assert line_b["base_salary"] == 1000.0
    assert line_b["deductions_total"] == 55.00  # 500 * 0.11
    assert line_b["net_pay"] == 945.00         # 1000 - 55
    assert line_b["employer_cost_extra"] == 90.00  # 500 * 0.18
    assert line_b["insured_base_snapshot"] == 500.0
    assert line_b["employee_rate_snapshot"] == 0.11
    assert line_b["employer_rate_snapshot"] == 0.18

    # 3. Check lines for Employee C (flag=False -> deduction=0, cost=0, net=1000)
    line_c = next(l for l in preview["lines"] if l["employee_id"] == emp_c.id)
    assert line_c["deductions_total"] == 0.0
    assert line_c["net_pay"] == 1000.0
    assert line_c["employer_cost_extra"] == 0.0

    # 4. Check lines for Employee D (internal_salary=0 -> deduction=0, cost=0, net=2000)
    line_d = next(l for l in preview["lines"] if l["employee_id"] == emp_d.id)
    assert line_d["deductions_total"] == 0.0
    assert line_d["net_pay"] == 2000.0
    assert line_d["employer_cost_extra"] == 0.0


def test_snapshot_immutability_and_post_journal(app_client, db_session, setup_social_ins_env):
    """
    Verifies that:
    1. Line inputs are frozen upon run creation/finalization.
    2. Modifying live rates or insured base afterwards does not affect the finalized run.
    3. post_journal() produces only the two net cash legs.
    """
    bank = setup_social_ins_env

    # Inactivate any seeded employees
    db_session.query(EmployeeDB).update({EmployeeDB.status: "Inactive"})
    db_session.commit()

    # Setup 2 employees: 1 internal insured, 1 external
    emp_int = EmployeeDB(name="Int Emp", email="int@insurancetest.com", status="Active", internal_salary_usd=1200.0, salary=1200.0)
    emp_ext = EmployeeDB(name="Ext Emp", email="ext@insurancetest.com", status="Active", external_salary_usd=2500.0, salary=2500.0)
    db_session.add_all([emp_int, emp_ext])
    db_session.flush()

    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_int.id, component_type="internal_usd_cash", amount=1200.0, effective_start_date="2026-01-01"))
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_ext.id, component_type="external_usd", amount=2500.0, effective_start_date="2026-01-01"))
    db_session.add(EmployeeBankAccountDB(employee_id=emp_ext.id, bank_name="Chase", iban="EG9998887776665554"))
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_int.id, insured_flag=True, insured_base=600.0, effective_start_date="2026-01-01"))
    db_session.commit()

    service = PayrollService(db_session)
    # Generate run
    run_dict = service.generate_run_from_compensation_plans(
        period_label="2026-09",
        period_start="2026-09-01",
        period_end="2026-09-30",
        bank_account_id=bank.id,
    )
    run_id = run_dict["id"]

    # Verify line snapshot values
    line_int = db_session.query(PayrollLineDB).filter_by(payroll_run_id=run_id, employee_id=emp_int.id).first()
    assert line_int.base_salary == 1200.0
    assert line_int.deductions_total == 66.0  # 600 * 0.11
    assert line_int.net_pay == 1134.0       # 1200 - 66
    assert line_int.employer_cost_extra == 108.0  # 600 * 0.18
    assert line_int.insured_base_snapshot == 600.0
    assert line_int.employee_rate_snapshot == 0.11
    assert line_int.employer_rate_snapshot == 0.18

    # Finalize the run
    run_db = db_session.query(PayrollRunDB).filter_by(id=run_id).first()
    run_db.status = "finalized"
    db_session.commit()

    # Now change organization rates to 15% and 20%
    service.update_payroll_settings(employee_rate=0.15, employer_rate=0.20, user_email="admin@voyance.com")
    # And change employee insured base to 800.0
    soc_ins = db_session.query(EmployeeSocialInsuranceDB).filter_by(employee_id=emp_int.id).first()
    soc_ins.insured_base = 800.0
    db_session.commit()

    # Verify finalized run lines remain completely unchanged!
    db_session.refresh(line_int)
    assert line_int.deductions_total == 66.0
    assert line_int.net_pay == 1134.0
    assert line_int.employer_cost_extra == 108.0
    assert line_int.insured_base_snapshot == 600.0
    assert line_int.employee_rate_snapshot == 0.11
    assert line_int.employer_rate_snapshot == 0.18

    # Verify post_journal() posts exactly 2 cash legs (1 for ext_net $2500, 1 for int_net $1134)
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
    assert tx_int.amount == 1134.0
    # No deduction or liability ledger transactions exist!
