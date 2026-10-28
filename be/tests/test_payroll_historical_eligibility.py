"""
be/tests/test_payroll_historical_eligibility.py
HP-1 (D-045): who is on a payroll run depends on the period.
- Current month and later: unchanged (status Active only; a missing plan blocks or raises 400)
- Historical period (period_end before the first of the current month): every employee with a plan overlapping
  the period and a join_date not after period_end; the rest are returned as skipped_employees with a reason
"""
import json
import uuid
from datetime import date, datetime

import pytest
from fastapi import HTTPException

from db import get_session_factory
from models_db import EmployeeDB
from finance import payroll_eligibility
from finance.models import (
    EmployeeCompensationPlanDB,
    FinanceBankAccountDB,
    PayrollLineDB,
    PayrollRunDB,
    PayrollTaxSettingsDB,
)
from finance.services.payroll_service import PayrollService
from fx_test_helpers import seed_usd_egp_rate
from payroll_test_helpers import set_funding_accounts_in


@pytest.fixture
def db(app_client):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def env(db):
    """Funding account, flat zero tax and seeded employees inactive and without plans, so only the test's own employees show up."""
    seed_usd_egp_rate(50.0)
    bank = FinanceBankAccountDB(account_name="HP1 USD", bank_name="Test Bank", account_number=f"HP-{uuid.uuid4().hex[:8]}",
                                currency="USD", opening_balance=100000.0, current_balance=100000.0, is_active=True)
    db.add(bank)
    db.flush()
    set_funding_accounts_in(db, bank.id)
    db.query(EmployeeCompensationPlanDB).delete()
    db.query(EmployeeDB).update({"status": "Inactive"})
    db.query(PayrollTaxSettingsDB).filter_by(effective_from="2020-01-01").delete()
    db.add(PayrollTaxSettingsDB(effective_from="2020-01-01", tax_limit_p_egp=20000.0, created_by="test",
                                brackets_json=json.dumps([{"upper_bound": None, "rate": 0.0, "base": None, "fixed": 0.0}])))
    db.commit()
    return db


def make_emp(db, name, status="Active", join_date="", plans=(("2020-01-01", None),), amount=1000.0):
    emp = EmployeeDB(name=name, email=f"{uuid.uuid4().hex[:8]}@hp1.test", role="employee", status=status,
                     join_date=join_date)
    db.add(emp)
    db.flush()
    for start, end in plans:
        db.add(EmployeeCompensationPlanDB(employee_id=emp.id, component_type="external_usd", amount=amount,
                                          salary_basis="GROSS", effective_start_date=start, effective_end_date=end))
    db.commit()
    return emp


def month_bounds(year, month):
    start = date(year, month, 1)
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    return start.isoformat(), date.fromordinal(nxt.toordinal() - 1).isoformat()


def preview(db, year, month):
    start, end = month_bounds(year, month)
    return PayrollService(db).preview_run(period_label=f"{year}-{month:02d}", period_start=start, period_end=end)


def create(db, year, month):
    start, end = month_bounds(year, month)
    return PayrollService(db).create_run(period_label=f"{year}-{month:02d}", period_start=start, period_end=end)


def ids(items):
    return {i["employee_id"] for i in items}


def generate(db, year, month):
    start, end = month_bounds(year, month)
    return PayrollService(db).generate_run_from_compensation_plans(
        period_label=f"{year}-{month:02d}", period_start=start, period_end=end)


# ---- Golden tests: the current month behaves as before HP-1 ----

def test_golden_current_month_includes_active_only(env):
    today = date.today()
    active = make_emp(env, "Golden Active")
    inactive = make_emp(env, "Golden Inactive", status="Inactive")
    on_leave = make_emp(env, "Golden On Leave", status="On Leave")
    p = preview(env, today.year, today.month)
    assert ids(p["lines"]) == {active.id}
    assert inactive.id not in ids(p["lines"]) and on_leave.id not in ids(p["lines"])
    assert p["headcount"] == 1
    assert p["total_net"] == 1000.0
    assert not p["has_blocking_exceptions"]


def test_golden_current_month_missing_plan_blocks_preview_and_fails_generate(env):
    today = date.today()
    ok = make_emp(env, "Golden Planned")
    bare = make_emp(env, "Golden Planless", plans=())
    p = preview(env, today.year, today.month)
    assert p["has_blocking_exceptions"]
    blocking = [e for e in p["exceptions"] if e["code"] == "MISSING_COMP_PLAN"]
    assert [e["employee_id"] for e in blocking] == [bare.id]
    assert ids(p["lines"]) == {ok.id}
    with pytest.raises(HTTPException) as err:
        generate(env, today.year, today.month)
    assert err.value.status_code == 400
    assert "without active compensation plan" in err.value.detail
    assert f"'Golden Planless' (ID #{bare.id})" in err.value.detail


# ---- HP-1: historical periods ----

@pytest.fixture
def fixed_today(monkeypatch):
    """The app is 'in' October 2026, so every 2025 month and 2026-09 are historical, 2026-10 is not."""
    monkeypatch.setattr(payroll_eligibility, "_today", lambda: date(2026, 10, 15))


def skipped(p):
    return {s["employee_id"]: s["reason"] for s in p["skipped_employees"]}


def test_pure_helpers_period_boundary_and_join_date():
    h = payroll_eligibility.is_historical_period
    assert h("2026-09-30", today=date(2026, 10, 1))
    assert h("2026-09-30", today=date(2026, 10, 31))
    assert not h("2026-10-31", today=date(2026, 10, 1))
    assert not h("2026-10-31", today=date(2026, 10, 31))
    assert not h("2026-11-30", today=date(2026, 10, 15))
    assert h("2025-12-31", today=date(2026, 1, 1))
    assert not h("2025-12-31", today=date(2025, 12, 31))
    assert not h("not-a-date", today=date(2026, 10, 15))
    skip = payroll_eligibility.historical_skip_reason
    assert skip(False, "2020-01-01", "2025-01-31") == "NO_PLAN_IN_PERIOD"
    assert skip(True, "2025-02-01", "2025-01-31") == "JOINED_AFTER_PERIOD"
    assert skip(True, "2025-01-31", "2025-01-31") is None
    assert skip(True, "2025/03/01", "2025-01-31") == "JOINED_AFTER_PERIOD"
    for unusable in ("", None, "soon", "31/02/2025", "  "):
        assert skip(True, unusable, "2025-01-31") is None


def test_period_boundary_with_the_service(env, fixed_today):
    active = make_emp(env, "Boundary Active")
    leaver = make_emp(env, "Boundary Leaver", status="Inactive")
    sept = preview(env, 2026, 9)   # ends on the last day of the previous month: historical
    octo = preview(env, 2026, 10)  # current month: Active only
    assert sept["historical_period"] and ids(sept["lines"]) == {active.id, leaver.id}
    assert not octo["historical_period"] and ids(octo["lines"]) == {active.id}
    assert octo["skipped_employees"] == []


def test_mid_year_hire_is_skipped_until_the_plan_starts(env, fixed_today):
    hire = make_emp(env, "June Hire", join_date="2025-06-10", plans=(("2025-06-01", None),))
    for month in range(1, 6):
        p = preview(env, 2025, month)
        assert hire.id not in ids(p["lines"])
        assert skipped(p)[hire.id] == "NO_PLAN_IN_PERIOD"
    for month in range(6, 13):
        p = preview(env, 2025, month)
        assert hire.id in ids(p["lines"]) and hire.id not in skipped(p)


def test_leaver_with_closed_plan_is_included_until_the_end_date(env, fixed_today):
    leaver = make_emp(env, "March Leaver", status="Inactive", plans=(("2020-01-01", "2025-03-31"),))
    for month in (1, 2, 3):
        assert leaver.id in ids(preview(env, 2025, month)["lines"])
    for month in (4, 5, 12):
        p = preview(env, 2025, month)
        assert leaver.id not in ids(p["lines"]) and skipped(p)[leaver.id] == "NO_PLAN_IN_PERIOD"


def test_gap_in_plan_history_skips_the_gap_months(env, fixed_today):
    emp = make_emp(env, "Gap Employee", plans=(("2025-01-01", "2025-03-31"), ("2025-07-01", None)))
    present = {m for m in range(1, 13) if emp.id in ids(preview(env, 2025, m)["lines"])}
    assert present == {1, 2, 3, 7, 8, 9, 10, 11, 12}


def test_join_date_after_period_end_is_skipped_even_with_a_plan(env, fixed_today):
    late = make_emp(env, "Late Joiner", join_date="2025-02-01")
    same_day = make_emp(env, "Last Day Joiner", join_date="2025-01-31")
    p = preview(env, 2025, 1)
    assert skipped(p)[late.id] == "JOINED_AFTER_PERIOD"
    assert same_day.id in ids(p["lines"])
    assert late.id in ids(preview(env, 2025, 2)["lines"])


def test_empty_or_unparsable_join_date_never_excludes(env, fixed_today):
    emps = [make_emp(env, f"Odd Join {i}", join_date=jd) for i, jd in enumerate(["", "garbage", "31/02/2025", "  "])]
    p = preview(env, 2025, 1)
    assert {e.id for e in emps} <= ids(p["lines"])
    assert not {e.id for e in emps} & set(skipped(p))


def test_inactive_and_on_leave_with_a_plan_are_included(env, fixed_today):
    a = make_emp(env, "Hist Inactive", status="Inactive")
    b = make_emp(env, "Hist On Leave", status="On Leave")
    c = make_emp(env, "Hist Resigned", status="Resigned")
    p = preview(env, 2025, 5)
    assert {a.id, b.id, c.id} <= ids(p["lines"])
    assert p["headcount"] == len(p["lines"]) == 3


def test_current_month_is_unchanged_under_a_fixed_today(env, fixed_today):
    ok = make_emp(env, "Now Active")
    make_emp(env, "Now Inactive", status="Inactive")
    bare = make_emp(env, "Now Planless", plans=())
    p = preview(env, 2026, 10)
    assert ids(p["lines"]) == {ok.id}
    assert [e["employee_id"] for e in p["exceptions"] if e["code"] == "MISSING_COMP_PLAN"] == [bare.id]
    with pytest.raises(HTTPException) as err:
        generate(env, 2026, 10)
    assert err.value.status_code == 400


def test_generate_in_a_historical_period_skips_planless_employees_instead_of_failing(env, fixed_today):
    ok = make_emp(env, "Gen Planned")
    bare = make_emp(env, "Gen Planless", plans=())
    run = generate(env, 2025, 4)
    assert {l["employee_id"] for l in run["lines"]} == {ok.id}
    assert run["historical_period"] is True
    assert {s["employee_id"]: s["reason"] for s in run["skipped_employees"]}[bare.id] == "NO_PLAN_IN_PERIOD"
    assert run["headcount"] == 1 and run["total_net"] == 1000.0


def test_create_run_stores_and_returns_the_skipped_list(env, fixed_today):
    ok = make_emp(env, "Create Planned")
    late = make_emp(env, "Create Late", join_date="2025-12-01")
    run = create(env, 2025, 4)
    assert run["historical_period"] is True
    assert {s["employee_id"]: s["reason"] for s in run["skipped_employees"]}[late.id] == "JOINED_AFTER_PERIOD"
    assert {l["employee_id"] for l in run["lines"]} == {ok.id}
    detail = PayrollService(env).get_run(run["id"])
    assert detail["historical_period"] is True
    assert late.id in {s["employee_id"] for s in detail["skipped_employees"]}
    assert "skipped_employees" not in detail["variance_summary"]
    current = create(env, 2026, 10)
    assert current["historical_period"] is False and current["skipped_employees"] == []


def test_refresh_follows_the_same_rule_and_never_restores_a_skipped_employee(env, fixed_today):
    ok = make_emp(env, "Refresh Planned")
    hire = make_emp(env, "Refresh Hire", plans=(("2025-06-01", None),))
    run = create(env, 2025, 2)
    assert {l["employee_id"] for l in run["lines"]} == {ok.id}
    refreshed = PayrollService(env).refresh_run(run["id"])
    assert {l["employee_id"] for l in refreshed["lines"]} == {ok.id}
    assert hire.id in {s["employee_id"] for s in refreshed["skipped_employees"]}
    # the owner closes a plan after the draft exists: the next refresh drops that line
    env.query(EmployeeCompensationPlanDB).filter_by(employee_id=ok.id).update({"effective_end_date": "2025-01-31"})
    env.commit()
    refreshed = PayrollService(env).refresh_run(run["id"])
    assert refreshed["lines"] == [] and refreshed["headcount"] == 0
    assert ok.id in {s["employee_id"] for s in refreshed["skipped_employees"]}


def test_refresh_of_a_finalized_run_is_still_refused(env, fixed_today):
    make_emp(env, "Final Planned")
    run = create(env, 2025, 2)
    env.query(PayrollRunDB).filter_by(id=run["id"]).update({"status": "finalized"})
    env.commit()
    before = env.query(PayrollLineDB).filter_by(payroll_run_id=run["id"]).count()
    with pytest.raises(HTTPException) as err:
        PayrollService(env).refresh_run(run["id"])
    assert err.value.status_code == 400
    assert env.query(PayrollLineDB).filter_by(payroll_run_id=run["id"]).count() == before


def test_twelve_months_of_2025_with_hires_leavers_and_a_gap(env, fixed_today):
    make_emp(env, "A Steady", amount=1000.0, plans=(("2020-01-01", None),))
    make_emp(env, "B June Hire", amount=2000.0, join_date="2025-06-10", plans=(("2025-06-01", None),))
    make_emp(env, "C Sept Leaver", amount=1500.0, status="Inactive", plans=(("2020-01-01", "2025-09-30"),))
    make_emp(env, "D Gap", amount=500.0, plans=(("2025-01-01", "2025-03-31"), ("2025-08-01", None)))
    expected_net = {1: 3000, 2: 3000, 3: 3000, 4: 2500, 5: 2500, 6: 4500, 7: 4500, 8: 5000, 9: 5000, 10: 3500, 11: 3500, 12: 3500}
    expected_heads = {1: 3, 2: 3, 3: 3, 4: 2, 5: 2, 6: 3, 7: 3, 8: 4, 9: 4, 10: 3, 11: 3, 12: 3}
    for month in range(1, 13):
        p = preview(env, 2025, month)
        assert p["total_net"] == expected_net[month], month
        assert p["headcount"] == expected_heads[month], month
        assert p["historical_period"] is True
