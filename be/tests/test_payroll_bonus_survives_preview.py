"""
be/tests/test_payroll_bonus_survives_preview.py
A bonus or commission added on the run screen must reach the saved run. The screen adds it to a preview and then asks for a
fresh preview (new id) before saving, and saving does not pass the preview id, so the adjustments of an earlier preview of the
same period have to carry over. This holds for historical periods and for employees who are no longer Active.
"""
from datetime import datetime

from finance.models import PayrollAdjustmentDB, PayrollRunDB
from finance.schemas import PayrollAdjustmentCreate
from finance.services.payroll_service import PayrollService
from test_payroll_historical_eligibility import create, db, env, fixed_today, make_emp, month_bounds, preview  # noqa: F401


def _bonus(emp_id, amount=275.0, source="INT"):
    return PayrollAdjustmentCreate(employee_id=emp_id, type="BONUS", amount=amount, payment_source=source, description="Bonus")


def test_bonus_for_a_leaver_survives_a_fresh_preview_and_is_saved_with_the_run(env, fixed_today):
    active = make_emp(env, "Active Ann", status="Active", amount=1000.0)
    leaver = make_emp(env, "Left Lee", status="Inactive", amount=2000.0)
    svc = PayrollService(env)

    first = preview(env, 2025, 3)
    svc.create_preview_adjustment(first["preview_id"], _bonus(leaver.id, 275.0))
    svc.create_preview_adjustment(first["preview_id"], _bonus(active.id, 100.0, "EXT"))

    second = preview(env, 2025, 3)                      # the screen asks for a fresh preview after adding a bonus
    assert second["preview_id"] != first["preview_id"]
    by_emp = {r["employee_id"]: r for r in second["recipients"]}
    assert by_emp[leaver.id]["int_adjustments_total"] == 275.0 and by_emp[active.id]["ext_adjustments_total"] == 100.0
    assert second["total_bonuses"] == 375.0

    run = create(env, 2025, 3)                           # saving does not pass the preview id
    saved = env.query(PayrollAdjustmentDB).filter(PayrollAdjustmentDB.payroll_run_id == run["id"]).all()
    assert {(a.employee_id, a.amount, a.payment_source) for a in saved} == {(leaver.id, 275.0, "INT"), (active.id, 100.0, "EXT")}
    assert all(a.status == "DRAFT" for a in saved)


def test_a_bonus_for_someone_not_on_the_period_is_dropped_not_saved(env, fixed_today):
    on = make_emp(env, "On Plan", amount=1000.0, plans=(("2020-01-01", None),))
    later = make_emp(env, "Plan From June", amount=500.0, plans=(("2025-06-01", None),))
    svc = PayrollService(env)
    first = preview(env, 2025, 7)
    svc.create_preview_adjustment(first["preview_id"], _bonus(later.id, 50.0))
    second = preview(env, 2025, 3)   # a different month does not inherit July's bonuses
    assert second["total_bonuses"] == 0.0
    run = create(env, 2025, 3)
    assert env.query(PayrollAdjustmentDB).filter(PayrollAdjustmentDB.payroll_run_id == run["id"]).count() == 0
    assert on.id  # the employee exists; only the month mattered


def test_after_a_run_exists_or_is_deleted_old_bonuses_do_not_come_back(env, fixed_today):
    emp = make_emp(env, "Gone Gail", status="Inactive", amount=1000.0)
    svc = PayrollService(env)
    first = preview(env, 2025, 4)
    svc.create_preview_adjustment(first["preview_id"], _bonus(emp.id, 80.0))
    run = create(env, 2025, 4)
    assert env.query(PayrollAdjustmentDB).filter(PayrollAdjustmentDB.payroll_run_id == run["id"]).count() == 1

    # while the run exists, a new preview of the period carries nothing over (the run holds the bonus)
    assert preview(env, 2025, 4)["total_bonuses"] == 0.0

    # the owner deletes the run and starts over: the old bonus must not reappear
    env.query(PayrollAdjustmentDB).filter(PayrollAdjustmentDB.payroll_run_id == run["id"]).delete()
    env.query(PayrollRunDB).filter(PayrollRunDB.id == run["id"]).delete()
    env.commit()
    assert preview(env, 2025, 4)["total_bonuses"] == 0.0


def test_a_stale_preview_from_long_ago_is_not_carried_over(env, fixed_today, monkeypatch):
    emp = make_emp(env, "Old Olga", amount=1000.0)
    svc = PayrollService(env)
    first = preview(env, 2025, 5)
    svc.create_preview_adjustment(first["preview_id"], _bonus(emp.id, 60.0))
    first["generated_at"] = "2020-01-01T00:00:00Z"
    assert preview(env, 2025, 5)["total_bonuses"] == 0.0
    assert datetime.utcnow().year >= 2025


# ---- A bonus can be added to and removed from a run that is already saved as a draft ----

def _saved_draft(env, *emps_args):
    emp = make_emp(env, *emps_args[:1], **emps_args[1])
    run = create(env, 2025, 8)
    return emp, run


def test_add_and_delete_a_bonus_on_a_saved_draft_run(env, fixed_today):
    from finance.models import PayrollLineDB
    emp, run = _saved_draft(env, "Draft Dan", {"status": "Inactive", "amount": 1000.0})
    svc = PayrollService(env)
    base_net = env.query(PayrollRunDB).filter_by(id=run["id"]).one().total_net

    adj = svc.add_run_adjustment(run["id"], _bonus(emp.id, 250.0, "EXT"), user_email="prep@hp1.test")
    assert adj["payroll_run_id"] == run["id"] and adj["status"] == "DRAFT" and adj["amount"] == 250.0
    env.expire_all()
    saved = env.query(PayrollRunDB).filter_by(id=run["id"]).one()
    assert saved.total_net == base_net + 250.0
    bonus_lines = env.query(PayrollLineDB).filter(PayrollLineDB.payroll_run_id == run["id"], PayrollLineDB.compensation_type == "bonus").all()
    assert [(l.employee_id, l.net_pay) for l in bonus_lines] == [(emp.id, 250.0)]
    detail = svc._format_run_detail(saved)   # what the screen loads when it reopens the run
    assert [a["id"] for a in detail["adjustments"]] == [adj["id"]] and detail["total_bonuses"] == 250.0

    svc.delete_run_adjustment(run["id"], adj["id"], user_email="prep@hp1.test")
    env.expire_all()
    assert env.query(PayrollRunDB).filter_by(id=run["id"]).one().total_net == base_net
    assert env.query(PayrollAdjustmentDB).filter_by(payroll_run_id=run["id"]).count() == 0
    assert env.query(PayrollLineDB).filter(PayrollLineDB.payroll_run_id == run["id"], PayrollLineDB.compensation_type == "bonus").count() == 0


def test_run_adjustments_are_refused_off_draft_unknown_employee_and_duplicates(env, fixed_today):
    from fastapi import HTTPException
    import pytest
    emp, run = _saved_draft(env, "Guard Gus", {"amount": 1000.0})
    other = make_emp(env, "Not On Run", amount=500.0, plans=(("2025-12-01", None),))
    svc = PayrollService(env)

    with pytest.raises(HTTPException) as e1:
        svc.add_run_adjustment(run["id"], _bonus(other.id, 10.0))
    assert e1.value.status_code == 404 and "not on payroll run" in e1.value.detail

    with_ref = PayrollAdjustmentCreate(employee_id=emp.id, type="BONUS", amount=10.0, payment_source="INT", external_reference="REF-1")
    svc.add_run_adjustment(run["id"], with_ref)
    with pytest.raises(HTTPException) as e2:
        svc.add_run_adjustment(run["id"], with_ref)
    assert e2.value.status_code == 409

    with pytest.raises(HTTPException) as e3:
        svc.delete_run_adjustment(run["id"], "adj_missing")
    assert e3.value.status_code == 404

    env.query(PayrollRunDB).filter_by(id=run["id"]).update({"status": "approved"})
    env.commit()
    with pytest.raises(HTTPException) as e4:
        svc.add_run_adjustment(run["id"], _bonus(emp.id, 5.0))
    assert e4.value.status_code == 400 and "Revert it to draft" in e4.value.detail


def test_run_adjustment_routes_need_the_prepare_permission(app_client, employee_cookies):
    assert app_client.post("/api/finance/payroll/runs/1/adjustments", json={"employee_id": 1, "type": "BONUS", "amount": 5, "payment_source": "INT"}, cookies=employee_cookies).status_code == 403
    assert app_client.delete("/api/finance/payroll/runs/1/adjustments/adj_x", cookies=employee_cookies).status_code == 403
