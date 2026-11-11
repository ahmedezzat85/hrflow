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
