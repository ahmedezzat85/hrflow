"""
be/tests/test_payroll_rate_settings_dated.py
SI-1 (Q-023, D-040): effective-dated employee and employer social insurance rates.
- Seed from the global row; resolution by period start; later changes never touch earlier periods
- Guards: first of month, 0..1, not in or before a finalized period; same-date edit in place
- PUT /settings with rates becomes a dated row for the current month (decision A1)
- Draft refresh uses the rate of its own period; generated lines keep their snapshots
"""
import json
import uuid
import pytest
from datetime import datetime
from fastapi import HTTPException

from db import get_session_factory
from models_db import EmployeeDB, EmployeeSocialInsuranceDB, AuditLogDB
from finance.models import (
    EmployeeCompensationPlanDB,
    FinanceBankAccountDB,
    PayrollLineDB,
    PayrollRateSettingsDB,
    PayrollRunDB,
    PayrollTaxSettingsDB,
)
from finance.services.payroll_service import PayrollService
from fx_test_helpers import seed_usd_egp_rate
from payroll_test_helpers import set_funding_accounts_in

CURRENT_MONTH = datetime.utcnow().strftime("%Y-%m-01")
URL = "/api/finance/payroll/settings/rates"


@pytest.fixture
def db_session(app_client):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def clean_rates(db_session):
    db_session.query(PayrollRateSettingsDB).delete()
    db_session.commit()
    g = PayrollService(db_session).get_payroll_settings()
    g.employee_rate, g.employer_rate = 0.11, 0.18
    db_session.commit()
    return db_session


@pytest.fixture
def insured_employee(clean_rates):
    """One insured internal employee (insured base 5,000 EGP) so SI amounts show the rate in force."""
    db = clean_rates
    seed_usd_egp_rate(50.0)
    emp = EmployeeDB(name="Rate Employee", email=f"rate+{uuid.uuid4().hex[:8]}@ratetest.com", status="Active")
    bank = FinanceBankAccountDB(account_name="Rate USD", bank_name="Test Bank", account_number=f"RT-{uuid.uuid4().hex[:8]}",
                                currency="USD", opening_balance=100000.0, current_balance=100000.0, is_active=True)
    db.add_all([emp, bank])
    db.flush()
    db.query(EmployeeDB).filter(EmployeeDB.id != emp.id).update({"status": "Inactive"})
    set_funding_accounts_in(db, bank.id)
    db.add(EmployeeCompensationPlanDB(employee_id=emp.id, component_type="internal_usd_cash", amount=1000.0,
                                      salary_basis="GROSS", effective_start_date="2020-01-01"))
    db.add(EmployeeSocialInsuranceDB(employee_id=emp.id, insured_flag=True, insured_base=5000.0, currency="EGP",
                                     effective_start_date="2020-01-01"))
    db.query(PayrollTaxSettingsDB).filter_by(effective_from="2020-01-01").delete()
    db.add(PayrollTaxSettingsDB(effective_from="2020-01-01", tax_limit_p_egp=20000.0, created_by="test",
                                brackets_json=json.dumps([{"upper_bound": None, "rate": 0.0, "base": None, "fixed": 0.0}])))
    db.commit()
    return emp, bank


def _line(preview, emp):
    return next(l for l in preview["lines"] if l["employee_id"] == emp.id)


def test_first_use_seeds_the_dated_table_from_the_global_row(clean_rates):
    svc = PayrollService(clean_rates)
    rows = svc.list_rate_settings()
    assert [(r.effective_from, r.employee_rate, r.employer_rate) for r in rows] == [("2000-01-01", 0.11, 0.18)]
    assert svc.get_effective_rate_settings("1999-01-01") == (0.11, 0.18)  # even before the seed date: global fallback
    assert svc.get_effective_rate_settings("2026-09-01") == (0.11, 0.18)


def test_rate_resolution_by_period_start(clean_rates):
    svc = PayrollService(clean_rates)
    svc.set_rate_settings("2026-03-01", 0.12, 0.1875, "admin@x.test")
    svc.set_rate_settings("2026-07-01", 0.10, 0.17, "admin@x.test")
    assert svc.get_effective_rate_settings("2026-02-01") == (0.11, 0.18)
    assert svc.get_effective_rate_settings("2026-03-01") == (0.12, 0.1875)
    assert svc.get_effective_rate_settings("2026-06-01") == (0.12, 0.1875)
    assert svc.get_effective_rate_settings("2026-07-01") == (0.10, 0.17)
    assert svc.get_effective_rate_settings("2027-01-01") == (0.10, 0.17)


def test_preview_uses_the_rate_of_its_own_period(insured_employee, clean_rates):
    emp, _ = insured_employee
    svc = PayrollService(clean_rates)
    svc.set_rate_settings("2026-03-01", 0.12, 0.1875, "admin@x.test")

    before = _line(svc.preview_run("2026-02", "2026-02-01", "2026-02-28", fx_rate_value=50.0), emp)
    assert before["employee_rate_snapshot"] == 0.11 and before["employer_rate_snapshot"] == 0.18
    assert before["employee_social_insurance_egp"] == 550.0 and before["employer_social_insurance_egp"] == 900.0

    after = _line(svc.preview_run("2026-04", "2026-04-01", "2026-04-30", fx_rate_value=50.0), emp)
    assert after["employee_rate_snapshot"] == 0.12 and after["employer_rate_snapshot"] == 0.1875
    assert after["employee_social_insurance_egp"] == 600.0 and after["employer_social_insurance_egp"] == 937.5


def test_refresh_uses_its_own_period_and_generated_lines_keep_snapshots(insured_employee, clean_rates):
    emp, bank = insured_employee
    svc = PayrollService(clean_rates)
    run = svc.generate_run_from_compensation_plans(
        period_label="2026-02", period_start="2026-02-01", period_end="2026-02-28",
        fx_rate_value=50.0)
    # a later month's rate never reaches the February draft, with or without a refresh
    svc.set_rate_settings("2026-06-01", 0.14, 0.2, "admin@x.test")
    svc.refresh_run(run["id"])
    line = clean_rates.query(PayrollLineDB).filter_by(payroll_run_id=run["id"], employee_id=emp.id).first()
    assert (line.employee_rate_snapshot, line.employer_rate_snapshot) == (0.11, 0.18)
    assert line.employee_social_insurance_egp == 550.0

    # a rate dated inside the open draft's own month does apply on its next refresh
    svc.set_rate_settings("2026-02-01", 0.13, 0.19, "admin@x.test")
    svc.refresh_run(run["id"])
    clean_rates.expire_all()
    line = clean_rates.query(PayrollLineDB).filter_by(payroll_run_id=run["id"], employee_id=emp.id).first()
    assert (line.employee_rate_snapshot, line.employer_rate_snapshot) == (0.13, 0.19)


def test_finalized_period_guard(clean_rates):
    clean_rates.add(PayrollRunDB(period_label="2026-08", period_start="2026-08-01", period_end="2026-08-31",
                                 payment_date="2026-08-31", status="finalized", total_net=100.0))
    clean_rates.commit()
    svc = PayrollService(clean_rates)
    for start in ("2026-08-01", "2026-03-01"):
        with pytest.raises(HTTPException) as exc:
            svc.set_rate_settings(start, 0.12, 0.18, "admin@x.test")
        assert exc.value.status_code == 400 and "already finalized payroll period" in exc.value.detail
    assert svc.set_rate_settings("2026-09-01", 0.12, 0.18, "admin@x.test").effective_from == "2026-09-01"
    # the finalized period still resolves to the old rate
    assert svc.get_effective_rate_settings("2026-08-01") == (0.11, 0.18)


def test_validation_and_same_date_edit_in_place(clean_rates):
    svc = PayrollService(clean_rates)
    for bad_date in ("2026-03-15", "03/01/2026", ""):
        with pytest.raises(HTTPException) as exc:
            svc.set_rate_settings(bad_date, 0.12, 0.18)
        assert exc.value.status_code == 400
    for emp, org in ((1.5, 0.18), (0.11, -0.1), (None, 0.18)):
        with pytest.raises(HTTPException):
            svc.set_rate_settings("2026-03-01", emp, org)

    first = svc.set_rate_settings("2026-03-01", 0.12, 0.18, "a@x.test")
    again = svc.set_rate_settings("2026-03-01", 0.125, 0.19, "b@x.test")
    assert again.id == first.id and (again.employee_rate, again.employer_rate) == (0.125, 0.19)
    assert len(svc.list_rate_settings()) == 2  # seed + one March row
    audits = clean_rates.query(AuditLogDB).filter(AuditLogDB.action == "payroll.rate_settings.saved").all()
    assert len(audits) == 2 and json.loads(audits[1].details)["previous"]["employee_rate"] == 0.12


def test_api_history_permissions_and_validation(app_client, admin_cookies, employee_cookies, clean_rates):
    body = {"effective_from": "2026-03-01", "employee_rate": 0.12, "employer_rate": 0.1875}
    assert app_client.get(URL).status_code == 401
    assert app_client.post(URL, json=body).status_code == 401
    assert app_client.get(URL, cookies=employee_cookies).status_code == 403
    assert app_client.post(URL, json=body, cookies=employee_cookies).status_code == 403

    assert app_client.post(URL, json=body, cookies=admin_cookies).status_code == 200
    assert app_client.post(URL, json={**body, "effective_from": "2026-04-01", "employee_rate": 0.13}, cookies=admin_cookies).status_code == 200
    hist = app_client.get(URL, cookies=admin_cookies).json()
    assert [h["effective_from"] for h in hist] == ["2026-04-01", "2026-03-01", "2000-01-01"]  # newest first
    assert app_client.post(URL, json={**body, "effective_from": "2026-03-15"}, cookies=admin_cookies).status_code == 422
    assert app_client.post(URL, json={**body, "employee_rate": 1.5}, cookies=admin_cookies).status_code == 422


def test_put_settings_with_rates_becomes_a_dated_row_for_the_current_month(app_client, admin_cookies, clean_rates):
    res = app_client.put("/api/finance/payroll/settings", json={"employee_rate": 0.115, "employer_rate": 0.19}, cookies=admin_cookies)
    assert res.status_code == 200 and (res.json()["employee_rate"], res.json()["employer_rate"]) == (0.115, 0.19)
    hist = app_client.get(URL, cookies=admin_cookies).json()
    assert hist[0]["effective_from"] == CURRENT_MONTH and hist[0]["employee_rate"] == 0.115
    assert hist[-1]["effective_from"] == "2000-01-01" and hist[-1]["employee_rate"] == 0.11  # history kept, not overwritten
    # only one of the two rates: the other keeps the value in force
    res = app_client.put("/api/finance/payroll/settings", json={"employee_rate": 0.12}, cookies=admin_cookies)
    assert (res.json()["employee_rate"], res.json()["employer_rate"]) == (0.12, 0.19)
    assert len(app_client.get(URL, cookies=admin_cookies).json()) == 2  # same month: edited in place
    # GET /settings shows the rate in force now
    got = app_client.get("/api/finance/payroll/settings", cookies=admin_cookies).json()
    assert (got["employee_rate"], got["employer_rate"]) == (0.12, 0.19)
    # the old range check still answers 400/422 on the compatibility path
    assert app_client.put("/api/finance/payroll/settings", json={"employee_rate": 1.5}, cookies=admin_cookies).status_code in (400, 422)
