"""
be/tests/test_salary_history_data_entry_checks.py

Characterization checks for filling production with salary data. NOT a feature spec.

Each test pins down how the code behaves TODAY so the data-entry procedure can rely
on it. Tests marked [RISK] pass when the suspected problem is real; if one of them
fails, the problem does not exist and the matching caution can be dropped.

Plan: docs/finance-module/27-pay-plan-sync-and-modal-plan.md (findings F1-F9). Slice P1 flips the [RISK] tests.

Run:  cd be && python -m pytest tests/test_salary_history_data_entry_checks.py -v
Uses the standard test fixtures (isolated temp DB). Touches no production data.
"""
from datetime import datetime, timedelta

import pytest

from db import get_db_context
from finance.models import EmployeeCompensationPlanDB, PayrollRunDB
from models_db import EmployeeDB, SalaryHistoryDB

TODAY = datetime.utcnow().strftime("%Y-%m-%d")
_counter = [0]


def _create_via_api(app_client, admin_cookies, internal=0.0, external=0.0, join_date="2026-01-01"):
    """Same payload shape the Add Employee modal sends."""
    _counter[0] += 1
    resp = app_client.post(
        "/api/employees",
        json={
            "name": "Salary Entry Test",
            "email": f"salary_entry_{_counter[0]}_{int(datetime.utcnow().timestamp() * 1000)}@hrflow.test",
            "dept": "Engineering",
            "job_role": "Engineer",
            "join_date": join_date,
            "status": "Active",
            "vac_total": 21,
            "next_raise": "2027-01-01",
            "employment_state": "Full-Time",
            "internal_salary_usd": internal,
            "external_salary_usd": external,
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _plan_rows(emp_id):
    with get_db_context() as db:
        rows = (
            db.query(EmployeeCompensationPlanDB)
            .filter(EmployeeCompensationPlanDB.employee_id == emp_id)
            .order_by(EmployeeCompensationPlanDB.component_type, EmployeeCompensationPlanDB.effective_start_date)
            .all()
        )
        return [
            (r.component_type, r.amount, r.effective_start_date, r.effective_end_date)
            for r in rows
        ]


def _put_component(app_client, admin_cookies, emp_id, ctype, amount, start):
    return app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/{ctype}",
        json={"amount": amount, "effective_start_date": start, "notes": "test"},
        cookies=admin_cookies,
    )


# ---------------------------------------------------------------- creation modal

def test_creation_with_salary_creates_plan_rows_at_join_date(app_client, admin_cookies):
    """Salary typed in the creation modal is written through to the plan. No second entry needed."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-03-01")
    rows = _plan_rows(emp_id)
    assert ("external_usd", 2000.0, "2026-03-01", None) in rows
    assert ("internal_usd_cash", 1000.0, "2026-03-01", None) in rows
    assert len(rows) == 2


def test_creation_with_zero_salary_creates_no_plan_rows(app_client, admin_cookies):
    """Both salary fields at 0 -> no plan; the plan can then be set with an exact effective date."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=0.0, external=0.0, join_date="2022-05-01")
    assert _plan_rows(emp_id) == []


def test_plan_start_after_zero_salary_creation_can_be_any_date(app_client, admin_cookies):
    """Recommended path: create with 0/0, then set the plan from the real effective date."""
    emp_id = _create_via_api(app_client, admin_cookies, join_date="2022-05-01")
    assert _put_component(app_client, admin_cookies, emp_id, "external_usd", 3000.0, "2026-01-01").status_code == 200
    assert _put_component(app_client, admin_cookies, emp_id, "internal_usd_cash", 1500.0, "2026-01-01").status_code == 200
    assert _plan_rows(emp_id) == [
        ("external_usd", 3000.0, "2026-01-01", None),
        ("internal_usd_cash", 1500.0, "2026-01-01", None),
    ]


def test_old_join_date_stamps_latest_salary_as_effective_since_join(app_client, admin_cookies):
    """[RISK] Join 2022 + 2026 salary typed in the modal => 2026 amount recorded as effective since 2022."""
    emp_id = _create_via_api(app_client, admin_cookies, external=2000.0, join_date="2022-05-01")
    assert ("external_usd", 2000.0, "2022-05-01", None) in _plan_rows(emp_id)


# ---------------------------------------------------------------- plan history rules

def test_plan_history_is_forward_only(app_client, admin_cookies):
    """An earlier date is rejected, the same date overwrites, a later date closes the old row the day before."""
    emp_id = _create_via_api(app_client, admin_cookies)
    assert _put_component(app_client, admin_cookies, emp_id, "external_usd", 2000.0, "2026-01-01").status_code == 200

    earlier = _put_component(app_client, admin_cookies, emp_id, "external_usd", 1800.0, "2025-06-01")
    assert earlier.status_code == 400  # cannot prepend 2025 history

    same = _put_component(app_client, admin_cookies, emp_id, "external_usd", 2100.0, "2026-01-01")
    assert same.status_code == 200
    assert _plan_rows(emp_id) == [("external_usd", 2100.0, "2026-01-01", None)]  # overwritten in place

    later = _put_component(app_client, admin_cookies, emp_id, "external_usd", 2500.0, "2026-07-01")
    assert later.status_code == 200
    assert _plan_rows(emp_id) == [
        ("external_usd", 2100.0, "2026-01-01", "2026-06-30"),
        ("external_usd", 2500.0, "2026-07-01", None),
    ]


def test_finalized_payroll_period_locks_plan_dates(app_client, admin_cookies):
    """Dates on or before the latest finalized period end are rejected."""
    emp_id = _create_via_api(app_client, admin_cookies)
    with get_db_context() as db:
        db.add(PayrollRunDB(
            period_label="2026-09", period_start="2026-09-01", period_end="2026-09-30", status="finalized",
        ))
        db.commit()
    blocked = _put_component(app_client, admin_cookies, emp_id, "external_usd", 1000.0, "2026-09-30")
    allowed = _put_component(app_client, admin_cookies, emp_id, "external_usd", 1000.0, "2026-10-01")
    assert blocked.status_code == 400
    assert allowed.status_code == 200


# ---------------------------------------------------------------- employee edit modal

def test_edit_modal_resave_splits_plan_row_at_today(app_client, admin_cookies):
    """[RISK] Re-saving the edit modal with UNCHANGED salaries adds an identical plan row dated today."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    before = _plan_rows(emp_id)
    assert len(before) == 2

    resp = app_client.put(
        f"/api/employees/{emp_id}",
        json={
            "name": "Salary Entry Test", "dept": "Engineering", "job_role": "Engineer",
            "internal_salary_usd": 1000.0, "external_salary_usd": 2000.0,   # unchanged
            "address_line_1": "Only the address changed",
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 200, resp.text

    after = _plan_rows(emp_id)
    assert len(after) == 4, f"expected the plan to be split, got {after}"
    assert ("external_usd", 2000.0, TODAY, None) in after
    assert ("external_usd", 2000.0, "2026-01-01",
            (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")) in after


def test_edit_modal_without_salary_fields_leaves_plan_untouched(app_client, admin_cookies):
    """Safe alternative: an update that omits the salary fields does not touch the plan."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    before = _plan_rows(emp_id)
    resp = app_client.put(f"/api/employees/{emp_id}", json={"address_line_1": "New address"}, cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    assert _plan_rows(emp_id) == before


# ---------------------------------------------------------------- raises

def test_backdated_raise_logs_history_but_not_current_salary(app_client, admin_cookies):
    """Backdated raise: history row only, employee's current salary unchanged."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    resp = app_client.post(
        "/api/salary/raise",
        json={"employee_id": emp_id, "new_internal_salary_usd": 1000.0, "new_external_salary_usd": 2000.0,
              "effective_date": "2024-06-01", "reason": "historical"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    with get_db_context() as db:
        emp = db.query(EmployeeDB).filter(EmployeeDB.id == emp_id).first()
        assert emp.internal_salary_usd == 1000.0 and emp.external_salary_usd == 2000.0
        hist = db.query(SalaryHistoryDB).filter(SalaryHistoryDB.employee_id == emp_id).all()
        assert len(hist) == 1 and hist[0].date == "2024-06-01"


def test_backdated_raise_previous_salary_is_taken_from_current_salary(app_client, admin_cookies):
    """[RISK] A 2024 raise to 2500 total shows 'previous' = today's 3000, so the delta is wrong (-16.67%)."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    resp = app_client.post(
        "/api/salary/raise",
        json={"employee_id": emp_id, "new_internal_salary_usd": 800.0, "new_external_salary_usd": 1700.0,
              "effective_date": "2024-06-01", "reason": "historical"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    with get_db_context() as db:
        h = db.query(SalaryHistoryDB).filter(SalaryHistoryDB.employee_id == emp_id).one()
        assert h.previous_salary == 3000.0      # current salary, not the salary in 2024
        assert h.new_salary == 2500.0
        assert h.pct_change.startswith("-")     # a "decrease" although it was a raise on that date


@pytest.mark.xfail(strict=True, reason="F8: raise does not update the compensation plan (plan 27, fixed in slice P1)")
def test_todays_raise_updates_employee_fields_and_plan_together(app_client, admin_cookies):
    """[RISK] If this FAILS on the plan assertion, a normal raise does not reach the plan that payroll reads."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    resp = app_client.post(
        "/api/salary/raise",
        json={"employee_id": emp_id, "new_internal_salary_usd": 1200.0, "new_external_salary_usd": 2500.0,
              "effective_date": TODAY, "reason": "test raise"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    with get_db_context() as db:
        emp = db.query(EmployeeDB).filter(EmployeeDB.id == emp_id).first()
        assert emp.internal_salary_usd == 1200.0 and emp.external_salary_usd == 2500.0

    active = {t: a for t, a, _s, e in _plan_rows(emp_id) if e is None}
    assert active.get("internal_usd_cash") == 1200.0, f"plan not updated by raise: {_plan_rows(emp_id)}"
    assert active.get("external_usd") == 2500.0, f"plan not updated by raise: {_plan_rows(emp_id)}"
