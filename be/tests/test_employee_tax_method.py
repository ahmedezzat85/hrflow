"""
be/tests/test_employee_tax_method.py
FT-1 (D-040): employee-level tax method (progressive | flat rate), effective-dated.
- Helper maths for the flat method (NET/GROSS, bonus and commission, social insurance, validation)
- Service/API: history, same-day edit, date guards, validation, audit log, permissions
- Payroll integration: the method in force for each month, line snapshots, flat tax breakdown, CSV columns
"""
import json
import uuid
import pytest
from datetime import datetime, timedelta

from models_db import EmployeeDB, EmployeeSocialInsuranceDB, AuditLogDB, EmployeeTaxMethodDB
from finance.models import (
    PayrollRunDB,
    PayrollLineDB,
    FinanceBankAccountDB,
    EmployeeCompensationPlanDB,
    PayrollTaxSettingsDB,
)
from db import get_session_factory
from finance.services.payroll_service import PayrollService
from finance.services.payroll_calculation_helper import validate_and_calculate_internal_statutory


@pytest.fixture
def db_session():
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def _employee(db, email, internal=2000.0):
    emp = EmployeeDB(
        name=f"Tax Method {email.split('@')[0]}",
        email=email.replace("@", f"+{uuid.uuid4().hex[:8]}@"),
        role="employee",
        status="Active",
        internal_salary_usd=internal,
        external_salary_usd=0.0,
        salary=internal,
    )
    db.add(emp)
    db.commit()
    return emp


def _calc(**kw):
    args = dict(
        employee_id=1,
        employee_name="E",
        internal_usd_amount=2000.0,
        salary_basis="NET",
        locked_fx_rate=50.0,
        insured_flag=False,
        insured_base=None,
        insured_currency=None,
        employee_rate=0.11,
        employer_rate=0.18,
        tax_method="flat",
        flat_rate=0.10,
    )
    args.update(kw)
    return validate_and_calculate_internal_statutory(**args)


# ---------------------------------------------------------------------------
# Helper maths
# ---------------------------------------------------------------------------

def test_flat_net_no_bonus_grosses_up_and_needs_no_tax_settings():
    res, exc = _calc()
    assert exc == []  # no MISSING_TAX_SETTINGS although no tax settings were passed
    assert res["tax_method"] == "flat" and res["tax_rate"] == 0.10
    assert res["base_gross_egp"] == 111111.11
    assert res["taxable_gross_egp"] == 111111.11
    assert res["employee_tax_egp"] == 11111.11
    assert res["final_internal_net_egp"] == 100000.0
    assert res["annual_taxed_salary_egp"] == round(111111.11 * 12, 2)
    assert res["annual_tax_egp"] == round(11111.11 * 12, 2)
    assert res["tax_settings_version_id"] is None
    assert res["final_internal_payment_usd"] == 2000


def test_flat_gross_basis_deducts_tax_from_gross():
    res, exc = _calc(salary_basis="GROSS")
    assert exc == []
    assert res["base_gross_egp"] == 100000.0
    assert res["employee_tax_egp"] == 10000.0
    assert res["final_internal_net_egp"] == 90000.0
    assert res["final_internal_payment_usd"] == 1800


def test_flat_with_bonus_and_commission_taxed_on_top_recurring_net_protected():
    res, exc = _calc(bonus_usd=60.0, commission_usd=40.0)
    assert exc == []
    assert res["variable_gross_egp"] == 5000.0
    assert res["taxable_gross_egp"] == 116111.11
    assert res["employee_tax_egp"] == 11611.11
    # recurring net (100,000) protected; variable pay arrives net of 10%
    assert res["final_internal_net_egp"] == 104500.0


def test_flat_with_social_insurance_deducts_si_and_taxes_gross():
    res, exc = _calc(insured_flag=True, insured_base=5000.0, insured_currency="EGP")
    assert exc == []
    assert res["employee_social_insurance_egp"] == 550.0
    assert res["base_gross_egp"] == 111722.22
    assert res["employee_tax_egp"] == 11172.22
    assert res["final_internal_net_egp"] == 100000.0


@pytest.mark.parametrize("rate", [None, 0, -0.1, 1.5])
def test_flat_invalid_rate_is_blocking(rate):
    res, exc = _calc(flat_rate=rate)
    assert any(e["code"] == "INVALID_FLAT_TAX_RATE" and e["severity"] == "blocking" for e in exc)
    assert res["employee_tax_egp"] == 0.0


def test_flat_full_rate_blocks_net_but_not_gross():
    _, exc_net = _calc(flat_rate=1.0)
    assert any(e["code"] == "INVALID_FLAT_TAX_RATE" for e in exc_net)
    res, exc_gross = _calc(flat_rate=1.0, salary_basis="GROSS")
    assert exc_gross == []
    assert res["employee_tax_egp"] == 100000.0


def test_progressive_is_unchanged_and_still_needs_tax_settings():
    res, exc = _calc(tax_method="progressive", flat_rate=None)
    assert any(e["code"] == "MISSING_TAX_SETTINGS" for e in exc)
    assert res["tax_method"] == "progressive" and res["tax_rate"] is None
    settings = {"id": 7, "tax_limit_p_egp": 20000.0, "brackets": [{"upper_bound": None, "rate": 0.0, "base": None, "fixed": 0.0}]}
    res2, exc2 = _calc(tax_method="progressive", flat_rate=None, tax_settings=settings)
    assert exc2 == []
    assert res2["employee_tax_egp"] == 0.0
    assert res2["tax_settings_version_id"] == 7


def test_flat_without_internal_salary_has_no_tax():
    res, exc = _calc(internal_usd_amount=0.0, flat_rate=None)
    assert exc == []
    assert res["employee_tax_egp"] == 0.0


# ---------------------------------------------------------------------------
# Service / API
# ---------------------------------------------------------------------------

def test_history_close_and_open_same_day_edit_and_audit(app_client, admin_cookies, db_session):
    emp = _employee(db_session, "hist@taxmethodtest.com")
    url = f"/api/employees/{emp.id}/tax-method"

    assert app_client.get(url, cookies=admin_cookies).json() is None

    r1 = app_client.put(url, json={"method": "flat", "flat_rate": 0.10, "effective_start_date": "2024-03-01", "notes": "owner"}, cookies=admin_cookies)
    assert r1.status_code == 200, r1.text
    assert r1.json()["method"] == "flat" and r1.json()["flat_rate"] == 0.10
    assert r1.json()["effective_end_date"] is None

    # same start date edits the active row in place
    r2 = app_client.put(url, json={"method": "flat", "flat_rate": 0.12, "effective_start_date": "2024-03-01"}, cookies=admin_cookies)
    assert r2.status_code == 200
    assert r2.json()["id"] == r1.json()["id"] and r2.json()["flat_rate"] == 0.12

    # a later start closes the previous row the day before
    r3 = app_client.put(url, json={"method": "progressive", "flat_rate": 0.5, "effective_start_date": "2025-07-01"}, cookies=admin_cookies)
    assert r3.status_code == 200
    assert r3.json()["method"] == "progressive" and r3.json()["flat_rate"] is None

    hist = app_client.get(f"{url}/history", cookies=admin_cookies).json()
    assert [h["effective_start_date"] for h in hist] == ["2025-07-01", "2024-03-01"]  # newest first
    assert hist[1]["effective_end_date"] == "2025-06-30"
    assert hist[0]["effective_end_date"] is None
    assert app_client.get(url, cookies=admin_cookies).json()["id"] == r3.json()["id"]

    # earlier than the active row is rejected
    r4 = app_client.put(url, json={"method": "flat", "flat_rate": 0.1, "effective_start_date": "2025-01-01"}, cookies=admin_cookies)
    assert r4.status_code == 400 and "strictly after" in r4.json()["detail"]

    db_session.expire_all()
    audits = db_session.query(AuditLogDB).filter(AuditLogDB.action == "employee.tax_method.updated", AuditLogDB.target_id == str(emp.id)).all()
    assert len(audits) == 3
    assert json.loads(audits[0].details)["method"] == "flat"


def test_validation_errors_and_unknown_employee(app_client, admin_cookies, db_session):
    emp = _employee(db_session, "val@taxmethodtest.com")
    url = f"/api/employees/{emp.id}/tax-method"
    today = datetime.utcnow().strftime("%Y-%m-%d")
    tomorrow = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

    def put(**body):
        body.setdefault("effective_start_date", today)
        return app_client.put(url, json=body, cookies=admin_cookies)

    assert put(method="bogus").status_code == 400
    assert put(method="flat").status_code == 400  # rate required
    assert put(method="flat", flat_rate=0).status_code == 400
    assert put(method="flat", flat_rate=-0.1).status_code == 400
    assert put(method="flat", flat_rate=1.5).status_code == 400
    assert put(method="flat", flat_rate=0.1, effective_start_date="03/01/2024").status_code == 400
    future = put(method="flat", flat_rate=0.1, effective_start_date=tomorrow)
    assert future.status_code == 400 and "cannot be in the future" in future.json()["detail"]
    assert put(method="flat", flat_rate=1.0).status_code == 200  # 100% is the allowed upper bound
    assert app_client.put("/api/employees/999999/tax-method", json={"method": "progressive", "effective_start_date": today}, cookies=admin_cookies).status_code == 404


def test_finalized_period_guard(app_client, admin_cookies, db_session):
    emp = _employee(db_session, "guard@taxmethodtest.com")
    db_session.add(PayrollRunDB(period_label="2026-08", period_start="2026-08-01", period_end="2026-08-31",
                                payment_date="2026-08-31", status="finalized", total_net=100.0))
    db_session.commit()
    url = f"/api/employees/{emp.id}/tax-method"
    for start in ("2026-08-15", "2026-08-31", "2026-03-01"):
        res = app_client.put(url, json={"method": "flat", "flat_rate": 0.1, "effective_start_date": start}, cookies=admin_cookies)
        assert res.status_code == 400 and "already finalized payroll period" in res.json()["detail"]
    ok = app_client.put(url, json={"method": "flat", "flat_rate": 0.1, "effective_start_date": "2026-09-01"}, cookies=admin_cookies)
    assert ok.status_code == 200


def test_permissions(app_client, admin_cookies, employee_cookies, db_session):
    emp = _employee(db_session, "perm@taxmethodtest.com")
    url = f"/api/employees/{emp.id}/tax-method"
    body = {"method": "flat", "flat_rate": 0.1, "effective_start_date": "2024-03-01"}

    # unauthenticated
    assert app_client.get(url).status_code == 401
    assert app_client.get(f"{url}/history").status_code == 401
    assert app_client.put(url, json=body).status_code == 401
    # plain employee role holds neither hr.employee.read nor hr.salary.write
    assert app_client.get(url, cookies=employee_cookies).status_code == 403
    assert app_client.get(f"{url}/history", cookies=employee_cookies).status_code == 403
    assert app_client.put(url, json=body, cookies=employee_cookies).status_code == 403
    # admin
    assert app_client.put(url, json=body, cookies=admin_cookies).status_code == 200
    assert app_client.get(url, cookies=admin_cookies).status_code == 200
    assert app_client.get(f"{url}/history", cookies=admin_cookies).status_code == 200


# ---------------------------------------------------------------------------
# Payroll integration
# ---------------------------------------------------------------------------

@pytest.fixture
def payroll_env(db_session):
    from db import get_engine, Base
    Base.metadata.create_all(bind=get_engine())
    bank = FinanceBankAccountDB(account_name="Tax Method USD", bank_name="Test Bank", account_number=f"TM-{uuid.uuid4().hex[:8]}",
                                currency="USD", opening_balance=500000.0, current_balance=500000.0, is_active=True)
    db_session.add(bank)
    db_session.query(PayrollTaxSettingsDB).filter_by(effective_from="2020-01-01").delete()
    db_session.add(PayrollTaxSettingsDB(
        effective_from="2020-01-01",
        tax_limit_p_egp=20000.0,
        brackets_json=json.dumps([{"upper_bound": None, "rate": 0.0, "base": None, "fixed": 0.0}]),
        created_by="test",
    ))
    db_session.commit()
    return bank


def _flat_then_progressive_employee(db_session):
    emp = _employee(db_session, "run@taxmethodtest.com")
    db_session.query(EmployeeDB).filter(EmployeeDB.id != emp.id).update({"status": "Inactive"})
    db_session.add(EmployeeCompensationPlanDB(employee_id=emp.id, component_type="internal_usd_cash", amount=2000.0,
                                               salary_basis="NET", effective_start_date="2023-01-01"))
    db_session.add(EmployeeTaxMethodDB(employee_id=emp.id, method="flat", flat_rate=0.10,
                                       effective_start_date="2024-03-01", effective_end_date="2025-06-30"))
    db_session.add(EmployeeTaxMethodDB(employee_id=emp.id, method="progressive", flat_rate=None,
                                       effective_start_date="2025-07-01"))
    db_session.commit()
    return emp


def _line(preview, emp):
    return next(l for l in preview["lines"] if l["employee_id"] == emp.id)


def test_preview_uses_the_method_in_force_for_each_month(db_session, payroll_env):
    emp = _flat_then_progressive_employee(db_session)
    service = PayrollService(db_session)

    flat = service.preview_run("2024-06", "2024-06-01", "2024-06-30", fx_rate_value=50.0)
    line = _line(flat, emp)
    assert not flat["has_blocking_exceptions"]
    assert line["tax_method_snapshot"] == "flat" and line["tax_rate_snapshot"] == 0.10
    assert line["employee_tax_egp"] == 11111.11
    assert line["final_internal_net_egp"] == 100000.0
    assert line["net_pay"] == 2000.0
    assert flat["total_employee_tax_egp"] == 11111.11
    assert flat["total_flat_tax_egp"] == 11111.11  # breakdown of the total, not an addition

    progressive = service.preview_run("2025-09", "2025-09-01", "2025-09-30", fx_rate_value=50.0)
    line = _line(progressive, emp)
    assert line["tax_method_snapshot"] == "progressive" and line["tax_rate_snapshot"] is None
    assert line["employee_tax_egp"] == 0.0
    assert progressive["total_flat_tax_egp"] == 0.0

    # month before any row => progressive
    before = service.preview_run("2024-01", "2024-01-01", "2024-01-31", fx_rate_value=50.0)
    assert _line(before, emp)["tax_method_snapshot"] == "progressive"
    assert before["total_flat_tax_egp"] == 0.0

    # a mid-month row applies to the whole month it starts in
    boundary = service.preview_run("2024-03", "2024-03-01", "2024-03-31", fx_rate_value=50.0)
    assert _line(boundary, emp)["tax_method_snapshot"] == "flat"


def test_generated_run_keeps_snapshots_after_later_changes_and_exports_csv(app_client, admin_cookies, db_session, payroll_env):
    emp = _flat_then_progressive_employee(db_session)
    service = PayrollService(db_session)
    run = service.generate_run_from_compensation_plans(
        period_label="2024-06", period_start="2024-06-01", period_end="2024-06-30",
        bank_account_id=payroll_env.id, fx_rate_value=50.0,
    )
    run_id = run["id"]
    assert run["total_flat_tax_egp"] == 11111.11
    assert run["total_employee_tax_egp"] == 11111.11

    # a later change of the method does not rewrite the stored line
    db_session.query(EmployeeTaxMethodDB).filter_by(employee_id=emp.id, method="flat").update({"flat_rate": 0.25})
    db_session.commit()
    line = db_session.query(PayrollLineDB).filter_by(payroll_run_id=run_id, employee_id=emp.id).first()
    assert line.tax_method_snapshot == "flat" and line.tax_rate_snapshot == 0.10
    assert line.employee_tax_egp == 11111.11

    detail = service.get_run(run_id)
    assert detail["total_flat_tax_egp"] == 11111.11
    assert detail["lines"][0]["tax_method_snapshot"] == "flat"

    # refreshing the draft re-evaluates with the row now in force
    refreshed = service.refresh_run(run_id)
    assert refreshed["total_flat_tax_egp"] > 11111.11
    assert refreshed["total_employee_tax_egp"] == refreshed["total_flat_tax_egp"]

    csv_text = service.export_run_csv(run_id)
    header, row = csv_text.splitlines()[0], csv_text.splitlines()[1]
    assert header.endswith("FX Rate,Tax Method,Tax Rate")
    assert row.endswith(",flat,0.2500")
