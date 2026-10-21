"""
be/tests/test_finance_compensation_plan_atomic.py
Atomic PUT /api/finance/employees/{id}/compensation-plan (plan 27, slice P2, D-034).
"""
from datetime import datetime

from db import get_db_context
from finance.models import EmployeeCompensationPlanDB, PayrollRunDB
from models_db import EmployeeDB
from employee_test_helpers import PERSONAL

_counter = [0]


def _create(app_client, admin_cookies, internal=0.0, external=0.0, join_date="2026-01-01"):
    _counter[0] += 1
    resp = app_client.post(
        "/api/employees",
        json={
            **PERSONAL, "name": "Atomic Plan Test",
            "email": f"atomic_plan_{_counter[0]}_{int(datetime.utcnow().timestamp() * 1000)}@hrflow.test",
            "dept": "Engineering", "job_role": "Engineer", "join_date": join_date, "status": "Active",
            "vac_total": 21, "next_raise": "2027-01-01", "employment_state": "Full-Time",
            "internal_salary_usd": internal, "external_salary_usd": external,
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _rows(emp_id):
    with get_db_context() as db:
        rows = (
            db.query(EmployeeCompensationPlanDB)
            .filter(EmployeeCompensationPlanDB.employee_id == emp_id)
            .order_by(EmployeeCompensationPlanDB.component_type, EmployeeCompensationPlanDB.effective_start_date)
            .all()
        )
        return [(r.component_type, r.amount, r.effective_start_date, r.effective_end_date) for r in rows]


def _put(app_client, cookies, emp_id, internal, external, start, **extra):
    body = {"effective_start_date": start, "internal_usd_cash": internal, "external_usd": external}
    body.update(extra)
    return app_client.put(f"/api/finance/employees/{emp_id}/compensation-plan", json=body, cookies=cookies)


def test_provisions_empty_plan_and_returns_changes(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies)
    resp = _put(app_client, admin_cookies, emp_id, 1200.0, 2500.0, "2026-02-01", internal_salary_basis="GROSS")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total_monthly_usd"] == 3700.0
    assert data["internal_usd_cash"]["salary_basis"] == "GROSS"
    assert {c["component_type"]: (c["action"], c["previous_amount"], c["new_amount"]) for c in data["changes"]} == {
        "internal_usd_cash": ("created", 0.0, 1200.0),
        "external_usd": ("created", 0.0, 2500.0),
    }
    with get_db_context() as db:
        emp = db.query(EmployeeDB).filter(EmployeeDB.id == emp_id).first()
        assert emp.salary == 3700.0


def test_raise_style_change_unchanged_and_switch_via_zero(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, internal=1000.0, external=2000.0)
    resp = _put(app_client, admin_cookies, emp_id, 1000.0, 2500.0, "2026-07-01")
    actions = {c["component_type"]: c["action"] for c in resp.json()["changes"]}
    assert actions == {"internal_usd_cash": "unchanged", "external_usd": "updated"}
    resp = _put(app_client, admin_cookies, emp_id, 0.0, 2500.0, "2026-08-01")
    assert resp.status_code == 200, resp.text
    assert resp.json()["internal_usd_cash"] is None
    assert ("internal_usd_cash", 1000.0, "2026-01-01", "2026-07-31") in _rows(emp_id)


def test_both_zero_rejected_nothing_written(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, internal=1000.0, external=2000.0)
    before = _rows(emp_id)
    resp = _put(app_client, admin_cookies, emp_id, 0.0, 0.0, "2026-07-01")
    assert resp.status_code == 400
    assert "At least one component must be above 0" in resp.text
    assert _rows(emp_id) == before


def test_failing_second_component_leaves_first_untouched(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, internal=1000.0, external=2000.0)
    # External starts later than the requested date, so ending it on that date is invalid.
    assert app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan/external_usd",
        json={"amount": 2000.0, "effective_start_date": "2026-06-01"}, cookies=admin_cookies,
    ).status_code == 200
    before = _rows(emp_id)
    resp = _put(app_client, admin_cookies, emp_id, 1500.0, 0.0, "2026-03-01")
    assert resp.status_code == 400, resp.text
    assert _rows(emp_id) == before


def test_negative_amount_is_rejected(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, internal=1000.0)
    assert _put(app_client, admin_cookies, emp_id, -1.0, 500.0, "2026-07-01").status_code == 422


def test_get_exposes_earliest_effective_date(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, internal=1000.0)
    url = f"/api/finance/employees/{emp_id}/compensation-plan"
    assert app_client.get(url, cookies=admin_cookies).json()["earliest_effective_date"] is None
    with get_db_context() as db:
        db.add(PayrollRunDB(period_label="atomic-p", period_start="2026-09-01", period_end="2026-09-30", status="finalized"))
        db.commit()
    try:
        assert app_client.get(url, cookies=admin_cookies).json()["earliest_effective_date"] == "2026-10-01"
        assert _put(app_client, admin_cookies, emp_id, 1100.0, 0.0, "2026-09-30").status_code == 400
        assert _put(app_client, admin_cookies, emp_id, 1100.0, 0.0, "2026-10-01").status_code == 200
    finally:
        with get_db_context() as db:
            db.query(PayrollRunDB).filter(PayrollRunDB.period_label == "atomic-p").delete()
            db.commit()


def test_permissions(app_client, admin_cookies, employee_cookies):
    emp_id = _create(app_client, admin_cookies, internal=1000.0)
    body = {"effective_start_date": "2026-07-01", "internal_usd_cash": 1100.0, "external_usd": 0.0}
    url = f"/api/finance/employees/{emp_id}/compensation-plan"
    assert app_client.put(url, json=body).status_code == 401
    assert app_client.put(url, json=body, cookies=employee_cookies).status_code == 403
