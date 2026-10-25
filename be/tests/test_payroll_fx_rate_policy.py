"""
be/tests/test_payroll_fx_rate_policy.py
FX-1: no silent 50.0 USD-EGP rate.
- A manual rate always wins
- Otherwise the rate comes from the USD-to-EGP transfer history
- With neither, the run is rejected (HTTP 400) and the statutory helper raises a blocking MISSING_FX_RATE
- Refreshing a draft keeps working from the rate stored on the run
"""
import uuid
import pytest
from fastapi import HTTPException

from db import get_session_factory
from models_db import EmployeeDB
from finance.models import (
    AccountTransferDB,
    EmployeeCompensationPlanDB,
    FinanceBankAccountDB,
)
from finance.services.payroll_service import PayrollService
from finance.services.payroll_calculation_helper import validate_and_calculate_internal_statutory

NO_RATE = "No USD-EGP rate available for this period. Enter the rate manually."


@pytest.fixture
def db_session():
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def no_transfers(app_client, db_session):
    db_session.query(AccountTransferDB).filter(
        AccountTransferDB.from_currency == "USD", AccountTransferDB.to_currency == "EGP"
    ).delete()
    db_session.commit()
    return db_session


def _transfer(db, date, usd, egp):
    db.add(AccountTransferDB(date=date, from_amount=usd, from_currency="USD", to_amount=egp, to_currency="EGP",
                             fx_rate=egp / usd, transfer_type="same_bank_fx"))
    db.commit()


def test_manual_rate_always_wins(no_transfers):
    _transfer(no_transfers, "2026-08-15", 1000.0, 48000.0)
    svc = PayrollService(no_transfers)
    for source in ("first_of_month", "payment_date", "manual"):
        assert svc._resolve_fx_rate(source, 52.5, "2026-09-01", "2026-09-30") == 52.5


def test_rate_comes_from_the_transfer_history_when_no_manual_value(no_transfers):
    _transfer(no_transfers, "2026-08-15", 1000.0, 49000.0)
    _transfer(no_transfers, "2026-09-20", 1000.0, 50000.0)
    svc = PayrollService(no_transfers)
    # first_of_month: latest transfer on or before the period start
    assert svc._resolve_fx_rate("first_of_month", None, "2026-09-01", "2026-09-30") == 49.0
    # payment_date: latest transfer on or before the period end
    assert svc._resolve_fx_rate("payment_date", None, "2026-09-01", "2026-09-30") == 50.0
    # zero or negative manual values are not a rate
    assert svc._resolve_fx_rate("first_of_month", 0, "2026-09-01", "2026-09-30") == 49.0


@pytest.mark.parametrize("source", ["first_of_month", "payment_date", "manual", None])
def test_no_manual_rate_and_no_transfer_is_rejected(no_transfers, source):
    svc = PayrollService(no_transfers)
    for manual in (None, 0, -5):
        with pytest.raises(HTTPException) as exc:
            svc._resolve_fx_rate(source, manual, "2026-09-01", "2026-09-30")
        assert exc.value.status_code == 400
        assert exc.value.detail == NO_RATE


def test_preview_api_rejects_missing_rate_and_accepts_manual(app_client, admin_cookies, no_transfers):
    body = {"period_label": "2026-09", "period_start": "2026-09-01", "period_end": "2026-09-30"}
    res = app_client.post("/api/finance/payroll/runs/preview", json=body, cookies=admin_cookies)
    assert res.status_code == 400 and res.json()["detail"] == NO_RATE
    ok = app_client.post("/api/finance/payroll/runs/preview", json={**body, "fx_rate_value": 51.0}, cookies=admin_cookies)
    assert ok.status_code == 200 and ok.json()["fx_rate_value"] == 51.0


@pytest.mark.parametrize("rate", [None, 0, -1.0])
def test_helper_blocks_a_missing_rate_instead_of_defaulting_to_50(rate):
    res, exc = validate_and_calculate_internal_statutory(
        employee_id=7, employee_name="E", internal_usd_amount=2000.0, salary_basis="NET", locked_fx_rate=rate,
        insured_flag=False, insured_base=None, insured_currency=None, employee_rate=0.11, employer_rate=0.18,
        tax_settings={"tax_limit_p_egp": 20000.0, "brackets": [{"upper_bound": None, "rate": 0.0, "base": None, "fixed": 0.0}]},
    )
    blocking = [e for e in exc if e["code"] == "MISSING_FX_RATE"]
    assert len(blocking) == 1 and blocking[0]["severity"] == "blocking" and blocking[0]["employee_id"] == 7
    assert res["fx_rate"] == 0.0 and res["final_internal_net_egp"] == 0.0  # nothing was converted at a guessed rate


def test_helper_with_a_rate_is_unchanged():
    res, exc = validate_and_calculate_internal_statutory(
        employee_id=7, employee_name="E", internal_usd_amount=1000.0, salary_basis="GROSS", locked_fx_rate=50.0,
        insured_flag=False, insured_base=None, insured_currency=None, employee_rate=0.11, employer_rate=0.18,
        tax_settings={"tax_limit_p_egp": 20000.0, "brackets": [{"upper_bound": None, "rate": 0.0, "base": None, "fixed": 0.0}]},
    )
    assert exc == [] and res["fx_rate"] == 50.0 and res["final_internal_net_egp"] == 50000.0


def test_refresh_keeps_working_from_the_rate_stored_on_the_run(no_transfers):
    db = no_transfers
    bank = FinanceBankAccountDB(account_name="FX Test USD", bank_name="Test Bank", account_number=f"FX-{uuid.uuid4().hex[:8]}",
                                currency="USD", opening_balance=100000.0, current_balance=100000.0, is_active=True)
    emp = EmployeeDB(name="FX Employee", email=f"fx+{uuid.uuid4().hex[:8]}@fxtest.com", role="employee", status="Active",
                     internal_salary_usd=0.0, external_salary_usd=1500.0, salary=1500.0)
    db.add_all([bank, emp])
    db.flush()
    db.query(EmployeeDB).filter(EmployeeDB.id != emp.id).update({"status": "Inactive"})
    db.add(EmployeeCompensationPlanDB(employee_id=emp.id, component_type="external_usd", amount=1500.0,
                                      salary_basis="NET", effective_start_date="2026-01-01"))
    db.commit()

    svc = PayrollService(db)
    run = svc.generate_run_from_compensation_plans(
        period_label="2026-09", period_start="2026-09-01", period_end="2026-09-30",
        bank_account_id=bank.id, fx_rate_value=51.0,
    )
    assert run["fx_rate_value"] == 51.0
    # no transfers exist, yet refresh uses the stored 51.0 rather than failing or guessing
    refreshed = svc.refresh_run(run["id"])
    assert refreshed["fx_rate_value"] == 51.0
