"""
be/tests/test_salary_history_data_entry_checks.py

Regression tests for salary data entry (plan 27, findings F1-F9, decision D-034).

Slice P1 fixed F6 (edit re-save), F7 (backdated raise) and F8 (raise -> plan) and added
zero-closes-a-component. Slice P3 fixed F3 with "Pay effective from" on create.
D-036 / S3 then moved pay out of the employee create/update API: tests here give an employee pay
through the Pay plan (set_pay), effective on the join date, and assert that create/update ignore pay.

Run:  cd be && python -m pytest tests/test_salary_history_data_entry_checks.py -q
Uses the standard test fixtures (isolated temp DB). Touches no production data.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from finance.current_pay import current_pay
from db import get_db_context
from finance.models import EmployeeCompensationPlanDB, PayrollRunDB
from finance.services.compensation_plan_service import CompensationPlanService
from models_db import AuditLogDB, EmployeeDB, SalaryHistoryDB
from employee_test_helpers import PERSONAL, set_pay

TODAY = datetime.utcnow().strftime("%Y-%m-%d")
YESTERDAY = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
_counter = [0]


_HISTORY_BASE = {}


def _create_via_api(app_client, admin_cookies, internal=0.0, external=0.0, join_date="2026-01-01", **extra):
    """Same payload shape the Add Employee modal sends (no pay), then pay through the Pay plan."""
    _counter[0] += 1
    resp = app_client.post(
        "/api/employees",
        json={
            **PERSONAL,
            **extra,
            "name": "Salary Entry Test",
            "email": f"salary_entry_{_counter[0]}_{int(datetime.utcnow().timestamp() * 1000)}@hrflow.test",
            "dept": "Engineering",
            "job_role": "Engineer",
            "join_date": join_date,
            "status": "Active",
            "vac_total": 21,
            "next_raise": "2027-01-01",
            "employment_state": "Full-Time",
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    emp_id = resp.json()["id"]
    set_pay(app_client, admin_cookies, emp_id, internal, external, start=join_date)
    with get_db_context() as db:
        # The starting-pay history row is written by the Pay plan; tests count rows added after it.
        _HISTORY_BASE[emp_id] = db.query(SalaryHistoryDB).filter(SalaryHistoryDB.employee_id == emp_id).count()
    return emp_id


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


def _active(emp_id):
    return {t: a for t, a, _s, e in _plan_rows(emp_id) if e is None}


def _put_component(app_client, admin_cookies, emp_id, ctype, amount, start):
    return app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/{ctype}",
        json={"amount": amount, "effective_start_date": start, "notes": "test"},
        cookies=admin_cookies,
    )


def _raise(app_client, admin_cookies, emp_id, internal, external, date=TODAY):
    return app_client.post(
        "/api/salary/raise",
        json={"employee_id": emp_id, "new_internal_salary_usd": internal, "new_external_salary_usd": external,
              "effective_date": date, "reason": "test raise"},
        cookies=admin_cookies,
    )


def _history_count(emp_id):
    """History rows written since the employee's starting pay was set."""
    with get_db_context() as db:
        total = db.query(SalaryHistoryDB).filter(SalaryHistoryDB.employee_id == emp_id).count()
    return total - _HISTORY_BASE.get(emp_id, 0)


# ---------------------------------------------------------------- creation modal

def test_creation_ignores_salary_fields_and_creates_no_plan(app_client, admin_cookies):
    """D-036: pay is not a create input. Old clients that still send it get an employee with no plan."""
    resp = app_client.post(
        "/api/employees",
        json={**PERSONAL, "name": "Old Client", "email": "old_client_pay@hrflow.test",
              "internal_salary_usd": 1000.0, "external_salary_usd": 2000.0, "join_date": "2026-03-01"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    assert _plan_rows(resp.json()["id"]) == []


def test_pay_plan_after_creation_writes_both_rows_at_the_chosen_date(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-03-01")
    rows = _plan_rows(emp_id)
    assert ("external_usd", 2000.0, "2026-03-01", None) in rows
    assert ("internal_usd_cash", 1000.0, "2026-03-01", None) in rows
    assert len(rows) == 2


def test_plan_start_after_creation_without_pay_can_be_any_date(app_client, admin_cookies):
    """Create with no pay, then set the plan from the real effective date, even long after the join date."""
    emp_id = _create_via_api(app_client, admin_cookies, join_date="2022-05-01")
    assert _plan_rows(emp_id) == []
    assert _put_component(app_client, admin_cookies, emp_id, "external_usd", 3000.0, "2026-01-01").status_code == 200
    assert _put_component(app_client, admin_cookies, emp_id, "internal_usd_cash", 1500.0, "2026-01-01").status_code == 200
    assert _plan_rows(emp_id) == [
        ("external_usd", 3000.0, "2026-01-01", None),
        ("internal_usd_cash", 1500.0, "2026-01-01", None),
    ]


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


def test_per_component_put_still_rejects_zero(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, external=2000.0, join_date="2026-01-01")
    assert _put_component(app_client, admin_cookies, emp_id, "external_usd", 0.0, "2026-06-01").status_code in (400, 422)


# ---------------------------------------------------------------- employee edit modal

def test_edit_modal_save_never_touches_the_plan(app_client, admin_cookies):
    """F6, closed for good by D-036: the profile update has no pay inputs, so the plan cannot be split by it."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    before = _plan_rows(emp_id)
    assert len(before) == 2

    resp = app_client.put(
        f"/api/employees/{emp_id}",
        json={"name": "Salary Entry Test", "dept": "Engineering", "job_role": "Engineer",
              "internal_salary_usd": 1000.0, "external_salary_usd": 2000.0},    # ignored
        cookies=admin_cookies,
    )
    assert resp.status_code == 200, resp.text
    assert _plan_rows(emp_id) == before
    assert _history_count(emp_id) == 0


def test_edit_cannot_change_pay_even_when_a_client_sends_it(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    resp = app_client.put(f"/api/employees/{emp_id}", json={"external_salary_usd": 2500.0}, cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    assert _active(emp_id) == {"internal_usd_cash": 1000.0, "external_usd": 2000.0}
    with get_db_context() as db:
        pay = current_pay(db, emp_id)
        assert pay["external"] == 2000.0 and pay["total"] == 3000.0


def test_employee_with_no_plan_can_still_be_edited(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, join_date="2026-01-01")
    resp = app_client.put(f"/api/employees/{emp_id}", json={"dept": "Design"}, cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    assert _plan_rows(emp_id) == []


# ---------------------------------------------------------------- raises

def test_raise_with_unchanged_amounts_logs_history_without_plan_rows(app_client, admin_cookies):
    """Amounts equal to the plan: history row only, plan untouched (even for an old date)."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    before = _plan_rows(emp_id)
    resp = _raise(app_client, admin_cookies, emp_id, 1000.0, 2000.0, "2024-06-01")
    assert resp.status_code == 201, resp.text
    assert _plan_rows(emp_id) == before
    with get_db_context() as db:
        hist = db.query(SalaryHistoryDB).filter(SalaryHistoryDB.employee_id == emp_id).order_by(SalaryHistoryDB.id).all()
        assert len(hist) == _HISTORY_BASE[emp_id] + 1 and hist[-1].date == "2024-06-01"


def test_backdated_raise_before_active_plan_is_rejected_and_writes_nothing(app_client, admin_cookies):
    """F7 fixed: a raise dated before the active plan row fails the guards; no history row, no change."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    before = _plan_rows(emp_id)
    resp = _raise(app_client, admin_cookies, emp_id, 800.0, 1700.0, "2024-06-01")
    assert resp.status_code == 400, resp.text
    assert _plan_rows(emp_id) == before
    assert _history_count(emp_id) == 0


def test_todays_raise_updates_employee_fields_and_plan_together(app_client, admin_cookies):
    """F8 fixed: a raise reaches the plan payroll reads, with correct previous values and next raise."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    resp = _raise(app_client, admin_cookies, emp_id, 1200.0, 2500.0)
    assert resp.status_code == 201, resp.text
    with get_db_context() as db:
        emp = db.query(EmployeeDB).filter(EmployeeDB.id == emp_id).first()
        pay = current_pay(db, emp_id)
        assert pay["internal"] == 1200.0 and pay["external"] == 2500.0
        assert pay["total"] == 3700.0
        from services.employee_derived import next_raise_map
        assert next_raise_map(db, [emp_id])[emp_id] == (datetime.strptime(TODAY, "%Y-%m-%d") + timedelta(days=365)).strftime("%Y-%m-%d")
        assert _history_count(emp_id) == 1
        h = db.query(SalaryHistoryDB).filter(SalaryHistoryDB.employee_id == emp_id).order_by(SalaryHistoryDB.id.desc()).first()
        from finance.pay_history import history_view
        view = history_view(db, [h])[0]
        assert view["previous_salary"] == 3000.0 and view["new_salary"] == 3700.0
    assert _active(emp_id) == {"internal_usd_cash": 1200.0, "external_usd": 2500.0}


def test_future_dated_raise_is_rejected(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    future = (datetime.utcnow() + timedelta(days=5)).strftime("%Y-%m-%d")
    before = _plan_rows(emp_id)
    assert _raise(app_client, admin_cookies, emp_id, 1200.0, 2000.0, future).status_code == 400
    assert _plan_rows(emp_id) == before
    assert _history_count(emp_id) == 0


def test_raise_blocked_by_finalized_period_writes_no_history(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    with get_db_context() as db:
        db.add(PayrollRunDB(period_label="p-lock", period_start="2026-01-01", period_end="2999-12-31", status="finalized"))
        db.commit()
    try:
        before = _plan_rows(emp_id)
        assert _raise(app_client, admin_cookies, emp_id, 1200.0, 2000.0).status_code == 400
        assert _plan_rows(emp_id) == before
        assert _history_count(emp_id) == 0
    finally:
        with get_db_context() as db:
            db.query(PayrollRunDB).filter(PayrollRunDB.period_label == "p-lock").delete()
            db.commit()


# ---------------------------------------------------------------- zero closes a component

def test_raise_to_zero_closes_that_component_only(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    resp = _raise(app_client, admin_cookies, emp_id, 0.0, 2000.0)
    assert resp.status_code == 201, resp.text
    rows = _plan_rows(emp_id)
    assert ("internal_usd_cash", 1000.0, "2026-01-01", YESTERDAY) in rows
    assert ("external_usd", 2000.0, "2026-01-01", None) in rows
    with get_db_context() as db:
        pay = current_pay(db, emp_id)
        assert pay["internal"] == 0.0 and pay["total"] == 2000.0


def test_both_zero_is_rejected_with_no_partial_write(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    before = _plan_rows(emp_id)
    assert _raise(app_client, admin_cookies, emp_id, 0.0, 0.0).status_code == 400
    assert _plan_rows(emp_id) == before
    assert _history_count(emp_id) == 0


def test_apply_pay_change_both_zero_message_and_no_write(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    before = _plan_rows(emp_id)
    with get_db_context() as db:
        with pytest.raises(HTTPException) as ei:
            CompensationPlanService(db).apply_pay_change(emp_id, 0.0, 0.0, TODAY)
        assert ei.value.status_code == 400
        assert ei.value.detail == "At least one component must be above 0"
    assert _plan_rows(emp_id) == before


def test_apply_pay_change_switch_closes_one_creates_other_and_audits_once(app_client, admin_cookies):
    """Internal-only -> external-only in one call: one row closed, one created, one audit entry."""
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=0.0, join_date="2026-01-01")
    with get_db_context() as db:
        res = CompensationPlanService(db).apply_pay_change(
            emp_id, 0.0, 3000.0, TODAY, notes="switch", actor_email="switch@hrflow.test")
        actions = {c["component_type"]: c["action"] for c in res["changes"]}
        assert actions == {"internal_usd_cash": "closed", "external_usd": "created"}
        assert db.query(AuditLogDB).filter(
            AuditLogDB.target_id == str(emp_id),
            AuditLogDB.action == "employee.compensation_plan.updated",
            AuditLogDB.actor_email == "switch@hrflow.test",
        ).count() == 1
    assert _active(emp_id) == {"external_usd": 3000.0}


def test_apply_pay_change_unchanged_writes_nothing(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    before = _plan_rows(emp_id)
    with get_db_context() as db:
        res = CompensationPlanService(db).apply_pay_change(emp_id, 1000.0, 2000.0, TODAY)
        assert {c["action"] for c in res["changes"]} == {"unchanged"}
    assert _plan_rows(emp_id) == before


def test_close_on_or_before_active_start_is_rejected(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    with get_db_context() as db:
        with pytest.raises(HTTPException) as ei:
            CompensationPlanService(db).apply_pay_change(emp_id, 0.0, 2000.0, "2026-01-01")
        assert ei.value.status_code == 400
    assert len([r for r in _plan_rows(emp_id) if r[3] is None]) == 2


def test_readding_closed_component_with_overlapping_date_is_rejected(app_client, admin_cookies):
    emp_id = _create_via_api(app_client, admin_cookies, internal=1000.0, external=2000.0, join_date="2026-01-01")
    with get_db_context() as db:
        svc = CompensationPlanService(db)
        svc.apply_pay_change(emp_id, 0.0, 2000.0, "2026-06-01")          # closes internal, end 2026-05-31
        with pytest.raises(HTTPException) as ei:
            svc.apply_pay_change(emp_id, 900.0, 2000.0, "2026-05-31")    # overlaps the closed row
        assert ei.value.status_code == 400
        svc.apply_pay_change(emp_id, 900.0, 2000.0, "2026-07-01")        # later date is fine
    rows = _plan_rows(emp_id)
    assert ("internal_usd_cash", 1000.0, "2026-01-01", "2026-05-31") in rows
    assert ("internal_usd_cash", 900.0, "2026-07-01", None) in rows
