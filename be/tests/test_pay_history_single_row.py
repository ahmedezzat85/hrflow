"""
be/tests/test_pay_history_single_row.py

Slice S1 of plan 29 (decision D-036): every pay change writes exactly one salary_history row
carrying both components, and the Pay plan modal reads that table through
GET /api/finance/employees/{id}/compensation-plan/pay-history.

Run:  cd be && python -m pytest tests/test_pay_history_single_row.py -q
"""
from datetime import datetime

from db import get_db_context
from models_db import SalaryHistoryDB
from employee_test_helpers import PERSONAL, set_pay

TODAY = datetime.utcnow().strftime("%Y-%m-%d")
_counter = [0]


def _create_employee(app_client, admin_cookies, internal=1000.0, external=2000.0):
    _counter[0] += 1
    resp = app_client.post(
        "/api/employees",
        json={
            **PERSONAL, "name": "Pay History Test",
            "email": f"pay_history_{_counter[0]}_{int(datetime.utcnow().timestamp() * 1000)}@hrflow.test",
            "dept": "Engineering",
            "job_role": "Engineer",
            "join_date": "2026-01-01",
            "status": "Active",
            "vac_total": 21,
            "next_raise": "2027-01-01",
            "employment_state": "Full-Time",
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    emp_id = resp.json()["id"]
    set_pay(app_client, admin_cookies, emp_id, internal, external, start="2026-01-01")   # writes the starting-pay row
    return emp_id


def _put_plan(app_client, admin_cookies, emp_id, internal, external, start=TODAY, notes="test change"):
    return app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan",
        json={"effective_start_date": start, "internal_usd_cash": internal, "external_usd": external, "notes": notes},
        cookies=admin_cookies,
    )


def _rows(emp_id):
    """History rows as plain dicts (the session is closed when the test inspects them)."""
    cols = ("date", "reason", "applied_by",
            "previous_internal_usd", "previous_external_usd", "new_internal_usd", "new_external_usd")
    with get_db_context() as db:
        found = (
            db.query(SalaryHistoryDB)
            .filter(SalaryHistoryDB.employee_id == emp_id)
            .order_by(SalaryHistoryDB.id)
            .all()
        )
        rows = [{c: getattr(h, c) for c in cols} for h in found]
        for r in rows:  # the totals are derived, never stored (D-046)
            r["previous_salary"] = r["previous_internal_usd"] + r["previous_external_usd"]
            r["new_salary"] = r["new_internal_usd"] + r["new_external_usd"]
        return rows


def _history(app_client, admin_cookies, emp_id):
    resp = app_client.get(
        f"/api/finance/employees/{emp_id}/compensation-plan/pay-history", cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_first_pay_plan_writes_a_starting_pay_row(app_client, admin_cookies):
    emp_id = _create_employee(app_client, admin_cookies, internal=1000.0, external=2000.0)
    rows = _rows(emp_id)
    assert len(rows) == 1
    h = rows[0]
    assert (h["previous_internal_usd"], h["previous_external_usd"]) == (0.0, 0.0)
    assert (h["new_internal_usd"], h["new_external_usd"]) == (1000.0, 2000.0)
    assert h["date"] == "2026-01-01"


def test_an_employee_with_no_pay_has_no_history(app_client, admin_cookies):
    emp_id = _create_employee(app_client, admin_cookies, internal=0.0, external=0.0)
    assert _rows(emp_id) == []
    assert _history(app_client, admin_cookies, emp_id) == []


def test_pay_plan_save_writes_one_history_row_with_both_components(app_client, admin_cookies):
    emp_id = _create_employee(app_client, admin_cookies, internal=1000.0, external=2000.0)
    resp = _put_plan(app_client, admin_cookies, emp_id, 1200.0, 2500.0, notes="Q4 adjustment")
    assert resp.status_code == 200, resp.text

    rows = _rows(emp_id)
    assert len(rows) == 2                      # the starting-pay row, then this change
    h = rows[-1]
    assert (h["previous_internal_usd"], h["previous_external_usd"]) == (1000.0, 2000.0)
    assert (h["new_internal_usd"], h["new_external_usd"]) == (1200.0, 2500.0)
    assert (h["previous_salary"], h["new_salary"]) == (3000.0, 3700.0)
    assert h["date"] == TODAY
    assert h["reason"] == "Q4 adjustment"
    assert h["applied_by"]


def test_pay_plan_save_with_nothing_changed_writes_no_history(app_client, admin_cookies):
    emp_id = _create_employee(app_client, admin_cookies, internal=1000.0, external=2000.0)
    resp = _put_plan(app_client, admin_cookies, emp_id, 1000.0, 2000.0)
    assert resp.status_code == 200, resp.text
    assert len(_rows(emp_id)) == 1             # still only the starting-pay row


def test_closing_a_component_is_one_row_with_zero_in_its_column(app_client, admin_cookies):
    emp_id = _create_employee(app_client, admin_cookies, internal=1000.0, external=2000.0)
    # Closing needs a date after the active row's start (the plan starts on the join date).
    resp = _put_plan(app_client, admin_cookies, emp_id, 1000.0, 0.0, notes="external ends")
    assert resp.status_code == 200, resp.text

    rows = _rows(emp_id)
    assert len(rows) == 2
    assert (rows[-1]["new_internal_usd"], rows[-1]["new_external_usd"]) == (1000.0, 0.0)
    assert (rows[-1]["previous_internal_usd"], rows[-1]["previous_external_usd"]) == (1000.0, 2000.0)


def test_raise_writes_exactly_one_row_through_the_plan_service(app_client, admin_cookies):
    emp_id = _create_employee(app_client, admin_cookies, internal=1000.0, external=2000.0)
    resp = app_client.post(
        "/api/salary/raise",
        json={"employee_id": emp_id, "new_internal_salary_usd": 1100.0, "new_external_salary_usd": 2100.0,
              "effective_date": TODAY, "reason": "annual"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    rows = _rows(emp_id)
    assert len(rows) == 2
    assert rows[-1]["reason"] == "annual"
    assert (rows[-1]["previous_salary"], rows[-1]["new_salary"]) == (3000.0, 3200.0)


def test_pay_history_endpoint_returns_one_row_per_change_newest_first(app_client, admin_cookies):
    emp_id = _create_employee(app_client, admin_cookies, internal=1000.0, external=2000.0)
    assert _put_plan(app_client, admin_cookies, emp_id, 1100.0, 2000.0, notes="first").status_code == 200
    assert _put_plan(app_client, admin_cookies, emp_id, 1100.0, 2400.0, notes="second").status_code == 200

    history = _history(app_client, admin_cookies, emp_id)
    assert len(history) == 3                   # starting pay + two changes
    newest = history[0]
    assert newest["reason"] == "second"
    assert (newest["new_internal_usd"], newest["new_external_usd"], newest["new_total_usd"]) == (1100.0, 2400.0, 3500.0)
    assert (newest["previous_internal_usd"], newest["previous_external_usd"]) == (1100.0, 2000.0)
    assert history[1]["reason"] == "first"
    assert history[2]["previous_internal_usd"] == 0.0     # the starting-pay row is last


def test_pay_history_endpoint_for_unknown_employee_is_404(app_client, admin_cookies):
    resp = app_client.get(
        "/api/finance/employees/999999/compensation-plan/pay-history", cookies=admin_cookies)
    assert resp.status_code == 404


def test_pay_history_endpoint_requires_a_payroll_read_permission(app_client, employee_cookies):
    resp = app_client.get(
        "/api/finance/employees/1/compensation-plan/pay-history", cookies=employee_cookies)
    assert resp.status_code == 403
