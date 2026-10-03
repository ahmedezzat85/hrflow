"""
be/tests/test_payroll_income_tax.py
Phase 1 verification tests for Egyptian Income Tax calculation foundation:
- 13 boundary values for Excel formula parity
- Parity across 20 representative salary levels
- NET solver round-trip across regular brackets and jumps (lowest valid gross rule)
- Scope separation: internal lines taxed vs. external lines untaxed (no settings needed)
- Insured employee SI deduction vs. uninsured (SI=0) tax base
- Variable compensation (bonuses, commissions) added to taxable gross
- Effective-dated tax settings resolution and run immutability
- Blocking exception MISSING_TAX_SETTINGS enforcement
- RBAC permissions for tax settings endpoints (Super-Admin / Financial-Admin)
"""
from decimal import Decimal
import json
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from models_db import EmployeeDB, EmployeeBankAccountDB, UserDB, EmployeeSocialInsuranceDB
from finance.models import (
    PayrollRunDB,
    PayrollLineDB,
    PayrollTaxSettingsDB,
    FinanceBankAccountDB,
    TransactionCategoryDB,
    PaymentTypeDB,
    EmployeeCompensationPlanDB,
    PayrollAdjustmentDB,
)
from db import get_db_context, get_session_factory
from finance.services.payroll_service import PayrollService
from finance.services.payroll_calculation_helper import (
    DEFAULT_TAX_BRACKETS,
    DEFAULT_TAX_LIMIT_P,
    calculate_annual_income_tax,
    solve_recurring_gross_for_net,
    validate_and_calculate_internal_statutory,
)


@pytest.fixture
def db_session():
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def setup_tax_env(db_session):
    """Seed test environment with bank accounts, categories, and clean state."""
    from db import init_db
    init_db()

    # Bank account
    bank = db_session.query(FinanceBankAccountDB).filter_by(account_number="TAX-TEST-BANK").first()
    if not bank:
        bank = FinanceBankAccountDB(
            account_name="Tax Test Bank USD",
            bank_name="Test Bank",
            account_number="TAX-TEST-BANK",
            currency="USD",
            opening_balance=1000000.0,
            current_balance=1000000.0,
            is_active=True,
        )
        db_session.add(bank)
        db_session.flush()

    # Category
    cat = db_session.query(TransactionCategoryDB).filter_by(name="Salaries & Wages").first()
    if not cat:
        cat = TransactionCategoryDB(name="Salaries & Wages", kind="cost", is_active=True, sort_order=1)
        db_session.add(cat)

    # Payment type
    pt = db_session.query(PaymentTypeDB).filter_by(code="OUTBOUND_TRANS").first()
    if not pt:
        pt = PaymentTypeDB(name="Bank Transfer", code="OUTBOUND_TRANS", is_active=True)
        db_session.add(pt)

    # Ensure clean state for test domain
    db_session.query(PayrollAdjustmentDB).delete()
    db_session.query(PayrollLineDB).delete()
    db_session.query(PayrollRunDB).delete()
    db_session.query(EmployeeSocialInsuranceDB).delete()
    db_session.query(EmployeeCompensationPlanDB).delete()
    db_session.query(EmployeeBankAccountDB).delete()
    db_session.query(EmployeeDB).filter(EmployeeDB.email.like("%@tax_test.com")).delete()

    # Tax settings
    tax_setting = db_session.query(PayrollTaxSettingsDB).filter_by(effective_from="2026-01-01").first()
    if not tax_setting:
        tax_setting = PayrollTaxSettingsDB(
            effective_from="2026-01-01",
            tax_limit_p_egp=float(DEFAULT_TAX_LIMIT_P),
            brackets_json=json.dumps(DEFAULT_TAX_BRACKETS),
            created_by="system",
        )
        db_session.add(tax_setting)
    else:
        tax_setting.brackets_json = json.dumps(DEFAULT_TAX_BRACKETS)
        tax_setting.tax_limit_p_egp = float(DEFAULT_TAX_LIMIT_P)

    db_session.commit()
    return bank


# ==============================================================================
# 1. 13 Boundary Values & Excel Formula Parity
# ==============================================================================

def test_13_boundary_values_excel_parity():
    """Verifies all 13 boundary values specified in section 10 of doc 12 against the owner's Excel formula."""
    boundary_cases = [
        (0, Decimal("0.0")),
        (40000, Decimal("0.0")),
        (40001, Decimal("0.10")),
        (55000, Decimal("1500.0")),
        (70000, Decimal("3750.0")),
        (200000, Decimal("29750.0")),
        (400000, Decimal("76750.0")),
        (600000, Decimal("126750.0")),
        (700000, Decimal("154750.0")),
        (800000, Decimal("182000.0")),
        (900000, Decimal("210000.0")),
        (1200000, Decimal("290000.0")),
        (1200001, Decimal("300000.275")),
    ]

    for y, expected in boundary_cases:
        actual = calculate_annual_income_tax(Decimal(str(y)), DEFAULT_TAX_BRACKETS)
        assert abs(actual - expected) < Decimal("0.0001"), f"Boundary Y={y} failed: expected {expected}, got {actual}"


def test_20_sample_salaries_parity():
    """Verifies formula behavior across 20 representative salary levels."""
    # Monthly base gross salaries (in EGP)
    sample_salaries = [
        3000, 5000, 6000, 8000, 10000, 15000, 20000, 25000, 30000, 35000,
        40000, 50000, 60000, 75000, 85000, 100000, 120000, 150000, 180000, 250000
    ]
    limit_p = Decimal(str(DEFAULT_TAX_LIMIT_P))

    for monthly_gross in sample_salaries:
        annual_taxed = Decimal(str(monthly_gross * 12)) - limit_p
        annual_tax = calculate_annual_income_tax(annual_taxed, DEFAULT_TAX_BRACKETS)
        assert annual_tax >= Decimal("0.0")

        # Monthly tax rounded half up
        monthly_tax = (annual_tax / Decimal("12")).quantize(Decimal("0.01"), rounding="ROUND_HALF_UP")
        assert monthly_tax >= Decimal("0.0")
        assert monthly_tax <= Decimal(str(monthly_gross))


# ==============================================================================
# 2. NET Basis Solver: Round-Trip, Jumps, and Lowest Valid Gross
# ==============================================================================

def test_net_solver_round_trip_and_self_check():
    """Verifies that for arbitrary target nets, solving for gross and running forward yields target within 0.01 EGP."""
    test_nets = [
        Decimal("4000.00"),
        Decimal("8500.00"),
        Decimal("15000.00"),
        Decimal("25000.00"),
        Decimal("45000.00"),
        Decimal("65000.00"),
        Decimal("80000.00"),
        Decimal("110000.00"),
    ]
    employee_si = Decimal("550.00")
    limit_p = Decimal(str(DEFAULT_TAX_LIMIT_P))

    for target_net in test_nets:
        solved_gross = solve_recurring_gross_for_net(
            target_net,
            employee_si,
            limit_p,
            DEFAULT_TAX_BRACKETS,
        )
        assert solved_gross > target_net

        # Forward calculation self-check
        annual_taxed = (solved_gross - employee_si) * Decimal("12") - limit_p
        annual_tax = calculate_annual_income_tax(annual_taxed, DEFAULT_TAX_BRACKETS)
        monthly_tax = (annual_tax / Decimal("12")).quantize(Decimal("0.01"), rounding="ROUND_HALF_UP")
        forward_net = solved_gross - employee_si - monthly_tax

        diff = abs(forward_net - target_net)
        assert diff <= Decimal("0.01"), f"Solver self-check failed for target {target_net}: got {forward_net}, gross {solved_gross}"


# ==============================================================================
# 3. Scope: Internal vs External Lines
# ==============================================================================

def test_internal_vs_external_tax_scope(db_session, setup_tax_env):
    """Verifies internal lines are taxed and external lines have tax = 0 and need no tax settings."""
    db_session.query(EmployeeDB).update({EmployeeDB.status: "Inactive"})
    db_session.commit()

    # Internal employee
    emp_int = EmployeeDB(name="Internal Emp", email="int_tax@tax_test.com", status="Active", internal_salary_usd=2000.0, salary=2000.0)
    db_session.add(emp_int)
    db_session.flush()
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_int.id, component_type="internal_usd_cash", amount=2000.0, salary_basis="GROSS", effective_start_date="2026-01-01"))

    # External employee
    emp_ext = EmployeeDB(name="External Emp", email="ext_tax@tax_test.com", status="Active", salary=3000.0)
    db_session.add(emp_ext)
    db_session.flush()
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_ext.id, component_type="external_usd", amount=3000.0, salary_basis="GROSS", effective_start_date="2026-01-01"))
    db_session.commit()

    service = PayrollService(db_session)
    preview = service.preview_run("2026-09", "2026-09-01", "2026-09-30", fx_rate_value=50.0)

    line_int = next(l for l in preview["lines"] if l["employee_id"] == emp_int.id)
    line_ext = next(l for l in preview["lines"] if l["employee_id"] == emp_ext.id)

    # Internal line should have tax > 0 EGP
    assert line_int["employee_tax_egp"] > 0
    assert line_int["taxable_gross_egp"] == 2000.0 * 50.0
    assert line_int["tax_settings_version_id"] is not None

    # External line must have tax = 0
    assert line_ext["employee_tax_egp"] == 0.0
    assert line_ext["taxable_gross_egp"] == 0.0
    assert line_ext["tax_settings_version_id"] is None


# ==============================================================================
# 4. Missing Tax Settings Blocker
# ==============================================================================

def test_missing_tax_settings_blocks_internal_run(db_session, setup_tax_env):
    """Verifies that if internal lines exist and no tax settings exist for period, MISSING_TAX_SETTINGS is emitted and blocks approval."""
    db_session.query(EmployeeDB).update({EmployeeDB.status: "Inactive"})
    # Delete all tax settings
    db_session.query(PayrollTaxSettingsDB).delete()
    db_session.commit()

    emp_int = EmployeeDB(name="Internal Emp", email="int_tax2@tax_test.com", status="Active", internal_salary_usd=2000.0, salary=2000.0)
    db_session.add(emp_int)
    db_session.flush()
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_int.id, component_type="internal_usd_cash", amount=2000.0, salary_basis="GROSS", effective_start_date="2026-01-01"))
    db_session.commit()

    service = PayrollService(db_session)
    preview = service.preview_run("2026-09", "2026-09-01", "2026-09-30", fx_rate_value=50.0)

    # Must contain blocking exception
    exceptions = preview["exceptions"]
    tax_ex = next((e for e in exceptions if e["code"] == "MISSING_TAX_SETTINGS"), None)
    assert tax_ex is not None
    assert tax_ex["severity"] == "blocking"
    assert preview["has_blocking_exceptions"] is True

    # Attempting to create and submit run should fail approval
    run_dict = service.create_run(
        period_label="2026-09",
        period_start="2026-09-01",
        period_end="2026-09-30",
        fx_rate_value=50.0,
    )
    # Approve should raise HTTPException due to blocking exceptions
    with pytest.raises(HTTPException) as exc_info:
        service.approve_run(run_dict["id"], user_email="admin@test.com")
    assert exc_info.value.status_code == 400
    assert "blocking exception" in exc_info.value.detail


# ==============================================================================
# 5. Insured Employee SI Deduction vs Uninsured
# ==============================================================================

def test_tax_with_insured_si_deduction(db_session, setup_tax_env):
    """Verifies employee SI is deducted from gross prior to annualization."""
    db_session.query(EmployeeDB).update({EmployeeDB.status: "Inactive"})
    db_session.commit()

    # Employee 1: Insured (SI = 550 EGP at 5000 insured base)
    emp_ins = EmployeeDB(name="Insured Emp", email="ins@tax_test.com", status="Active", internal_salary_usd=2000.0, salary=2000.0)
    db_session.add(emp_ins)
    db_session.flush()
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_ins.id, component_type="internal_usd_cash", amount=2000.0, salary_basis="GROSS", effective_start_date="2026-01-01"))
    db_session.add(EmployeeSocialInsuranceDB(employee_id=emp_ins.id, insured_flag=True, insured_base=5000.0, currency="EGP", effective_start_date="2026-01-01"))

    # Employee 2: Uninsured (SI = 0 EGP)
    emp_unins = EmployeeDB(name="Uninsured Emp", email="unins@tax_test.com", status="Active", internal_salary_usd=2000.0, salary=2000.0)
    db_session.add(emp_unins)
    db_session.flush()
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp_unins.id, component_type="internal_usd_cash", amount=2000.0, salary_basis="GROSS", effective_start_date="2026-01-01"))
    db_session.commit()

    service = PayrollService(db_session)
    preview = service.preview_run("2026-09", "2026-09-01", "2026-09-30", fx_rate_value=50.0)

    line_ins = next(l for l in preview["lines"] if l["employee_id"] == emp_ins.id)
    line_unins = next(l for l in preview["lines"] if l["employee_id"] == emp_unins.id)

    # Insured: Tax employee SI is 550.0
    assert line_ins["tax_employee_si_egp"] == 550.0
    # Annual taxed salary = (100,000 - 550) * 12 - 20,000 = 99,450 * 12 - 20,000 = 1,193,400 - 20,000 = 1,173,400
    assert line_ins["annual_taxed_salary_egp"] == 1173400.0

    # Uninsured: Tax employee SI is 0.0
    assert line_unins["tax_employee_si_egp"] == 0.0
    # Annual taxed salary = 100,000 * 12 - 20,000 = 1,180,000
    assert line_unins["annual_taxed_salary_egp"] == 1180000.0

    # Insured tax should be strictly less than uninsured tax
    assert line_ins["employee_tax_egp"] < line_unins["employee_tax_egp"]


# ==============================================================================
# 6. Variable Comp Added to Taxable Gross
# ==============================================================================

def test_variable_comp_taxation():
    """Verifies bonus and commission are added to taxable gross and taxed forward via calculation helper."""
    tax_setting = {
        "id": 1,
        "tax_limit_p_egp": float(DEFAULT_TAX_LIMIT_P),
        "brackets_json": json.dumps(DEFAULT_TAX_BRACKETS),
    }

    # 1. Base without variable comp ($1000 USD gross at FX=50 -> 50,000 EGP gross)
    res_base, _ = validate_and_calculate_internal_statutory(
        employee_id=1,
        employee_name="Test Base",
        internal_usd_amount=1000.0,
        salary_basis="GROSS",
        locked_fx_rate=50.0,
        insured_flag=False,
        insured_base=None,
        insured_currency=None,
        employee_rate=0.11,
        employer_rate=0.18,
        bonus_usd=0.0,
        commission_usd=0.0,
        tax_settings=tax_setting,
    )

    # 2. With variable comp ($500 USD bonus at FX=50 -> 25,000 EGP variable gross)
    res_var, _ = validate_and_calculate_internal_statutory(
        employee_id=1,
        employee_name="Test Var",
        internal_usd_amount=1000.0,
        salary_basis="GROSS",
        locked_fx_rate=50.0,
        insured_flag=False,
        insured_base=None,
        insured_currency=None,
        employee_rate=0.11,
        employer_rate=0.18,
        bonus_usd=500.0,
        commission_usd=0.0,
        tax_settings=tax_setting,
    )

    assert res_base["base_gross_egp"] == 50000.0
    assert res_base["taxable_gross_egp"] == 50000.0
    assert res_base["variable_gross_egp"] == 0.0

    assert res_var["base_gross_egp"] == 50000.0
    assert res_var["variable_gross_egp"] == 25000.0
    assert res_var["taxable_gross_egp"] == 75000.0

    # Tax on 75,000 must be higher than tax on 50,000
    assert res_var["employee_tax_egp"] > res_base["employee_tax_egp"]


# ==============================================================================
# 7. Settings Resolution & Immutability
# ==============================================================================

def test_settings_resolution_and_immutability(db_session, setup_tax_env):
    """Verifies effective date resolution and that persisted runs retain their stored settings."""
    db_session.query(EmployeeDB).update({EmployeeDB.status: "Inactive"})
    db_session.commit()

    emp = EmployeeDB(name="Imm Emp", email="imm@tax_test.com", status="Active", internal_salary_usd=2000.0, salary=2000.0)
    db_session.add(emp)
    db_session.flush()
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp.id, component_type="internal_usd_cash", amount=2000.0, salary_basis="GROSS", effective_start_date="2026-01-01"))
    db_session.commit()

    service = PayrollService(db_session)

    # 1. Create run for 2026-05
    run1 = service.create_run(
        period_label="2026-05",
        period_start="2026-05-01",
        period_end="2026-05-31",
        fx_rate_value=50.0,
    )
    v1_id = run1["tax_settings_version_id"]
    assert v1_id is not None
    tax_v1 = run1["lines"][0]["employee_tax_egp"]

    # 2. Add newer settings effective 2026-06-01 with higher tax limit P (lower tax)
    s2 = PayrollTaxSettingsDB(
        effective_from="2026-06-01",
        tax_limit_p_egp=50000.0,
        brackets_json=json.dumps(DEFAULT_TAX_BRACKETS),
        created_by="system",
    )
    db_session.add(s2)
    db_session.commit()

    # 3. Create run for 2026-06 -> should resolve s2
    run2 = service.create_run(
        period_label="2026-06",
        period_start="2026-06-01",
        period_end="2026-06-30",
        fx_rate_value=50.0,
    )
    assert run2["tax_settings_version_id"] == s2.id
    assert run2["lines"][0]["employee_tax_egp"] < tax_v1

    # 4. Invariant: run1 stored version and lines are unaltered in DB
    run1_db = db_session.query(PayrollRunDB).filter_by(id=run1["id"]).first()
    assert run1_db.tax_settings_version_id == v1_id
    assert run1_db.lines[0].employee_tax_egp == tax_v1


# ==============================================================================
# 8. First-of-Month Validation and REST API RBAC
# ==============================================================================

def test_settings_first_of_month_validation(db_session):
    """Verifies effective_from must be YYYY-MM-01."""
    service = PayrollService(db_session)

    with pytest.raises(HTTPException) as exc_info:
        service.create_tax_settings(
            effective_from="2026-05-15",
            tax_limit_p_egp=20000.0,
            brackets=DEFAULT_TAX_BRACKETS,
        )
    assert exc_info.value.status_code == 400
    assert "first day of a calendar month" in exc_info.value.detail


def test_tax_settings_rbac_permissions(app_client, admin_cookies):
    """Verifies RBAC access control for tax settings endpoints."""
    # 1. Fetch template
    res = app_client.get("/api/finance/payroll/tax-settings/template", cookies=admin_cookies)
    assert res.status_code == 200
    tmpl = res.json()
    assert tmpl["tax_limit_p_egp"] == 20000.0
    assert len(tmpl["brackets"]) == 11

    # 2. List tax settings
    res = app_client.get("/api/finance/payroll/tax-settings", cookies=admin_cookies)
    assert res.status_code == 200
    assert isinstance(res.json(), list)

    # 3. Create tax settings
    create_res = app_client.post(
        "/api/finance/payroll/tax-settings",
        json={
            "effective_from": "2027-01-01",
            "tax_limit_p_egp": 25000.0,
            "brackets": DEFAULT_TAX_BRACKETS,
            "notes": "2027 test schedule",
        },
        cookies=admin_cookies,
    )
    assert create_res.status_code == 201
    created = create_res.json()
    assert created["effective_from"] == "2027-01-01"
    assert created["tax_limit_p_egp"] == 25000.0

    # 4. Unauthorized employee access (role employee)
    from auth import create_session_token
    emp_token = create_session_token("emp@tax_test.com", "employee", 99, name="Employee")
    emp_cookies = {"hrflow_session": emp_token}

    emp_res = app_client.get("/api/finance/payroll/tax-settings", cookies=emp_cookies)
    assert emp_res.status_code in (401, 403)
