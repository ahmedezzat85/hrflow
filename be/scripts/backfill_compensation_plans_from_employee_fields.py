"""
be/scripts/backfill_compensation_plans_from_employee_fields.py
One-time backfill: create EmployeeCompensationPlanDB rows for any employee
that has internal_salary_usd/external_salary_usd set but no active plan component
of that type yet. Safe to run multiple times (skips employees that already
have an active row for a given component type).
"""
import os
import sys
from datetime import datetime, timedelta

# Ensure be directory is in Python path when run directly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_db_context, init_db
from models_db import EmployeeDB
from finance.models import EmployeeCompensationPlanDB, PayrollRunDB
from finance.services.compensation_plan_service import CompensationPlanService


def run() -> int:
    init_db()
    with get_db_context() as db:
        service = CompensationPlanService(db)
        employees = db.query(EmployeeDB).all()
        created = 0
        finalized_runs = (
            db.query(PayrollRunDB)
            .filter(PayrollRunDB.status.in_(["finalized", "paid", "partially_paid"]))
            .all()
        )
        max_period_end = max((r.period_end for r in finalized_runs), default=None)
        today_str = datetime.utcnow().strftime("%Y-%m-%d")

        for emp in employees:
            existing_types = {
                c.component_type
                for c in db.query(EmployeeCompensationPlanDB)
                .filter(
                    EmployeeCompensationPlanDB.employee_id == emp.id,
                    EmployeeCompensationPlanDB.effective_end_date.is_(None),
                )
                .all()
            }

            join_date = emp.join_date if hasattr(emp, "join_date") else ""
            eff_date = (
                join_date
                if (join_date and len(join_date) == 10 and join_date[4] == "-" and join_date[7] == "-")
                else "2026-01-01"
            )
            if max_period_end and eff_date <= max_period_end:
                eff_date = today_str
                if eff_date <= max_period_end:
                    eff_date = (
                        datetime.strptime(max_period_end, "%Y-%m-%d") + timedelta(days=1)
                    ).strftime("%Y-%m-%d")

            int_val = float(getattr(emp, "internal_salary_usd", 0) or 0)
            if int_val > 0 and "internal_usd_cash" not in existing_types:
                service.set_component(
                    employee_id=emp.id,
                    component_type="internal_usd_cash",
                    amount=int_val,
                    effective_start_date=eff_date,
                    notes="Backfilled from legacy employee field",
                )
                created += 1

            ext_val = float(getattr(emp, "external_salary_usd", 0) or 0)
            if ext_val > 0 and "external_usd" not in existing_types:
                service.set_component(
                    employee_id=emp.id,
                    component_type="external_usd",
                    amount=ext_val,
                    effective_start_date=eff_date,
                    notes="Backfilled from legacy employee field",
                )
                created += 1

        print(f"Backfilled {created} compensation plan component(s).")
        return created


if __name__ == "__main__":
    run()
