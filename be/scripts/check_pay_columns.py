"""
be/scripts/check_pay_columns.py
Read-only check to run BEFORE migration 0048 (D-046). Lists employees whose stored pay columns
(employees.internal_salary_usd / external_salary_usd) differ from the compensation plan in force today, so the owner
can fix the plan first. Changes nothing.

Usage (from be/, with the same environment as the app): python scripts/check_pay_columns.py
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import inspect, text  # noqa: E402

from db import get_engine  # noqa: E402


def main() -> int:
    engine = get_engine()
    with engine.connect() as conn:
        cols = [c["name"] for c in inspect(conn).get_columns("employees")]
        if "internal_salary_usd" not in cols:
            print("employees.internal_salary_usd is already gone: nothing to check.")
            return 0
        today = date.today().isoformat()
        plan = {}
        for emp_id, component, amount in conn.execute(text(
            "SELECT employee_id, component_type, amount FROM finance_employee_compensation_plans "
            "WHERE effective_start_date <= :d AND (effective_end_date IS NULL OR effective_end_date >= :d)"
        ), {"d": today}):
            cur = plan.setdefault(emp_id, [0.0, 0.0])
            cur[0 if component == "internal_usd_cash" else 1] += float(amount or 0.0)
        mismatches = 0
        for emp_id, name, old_int, old_ext in conn.execute(text(
            "SELECT id, name, internal_salary_usd, external_salary_usd FROM employees ORDER BY id"
        )):
            old = (round(float(old_int or 0), 2), round(float(old_ext or 0), 2))
            now = tuple(round(v, 2) for v in plan.get(emp_id, [0.0, 0.0]))
            if old != now and old != (0.0, 0.0):
                mismatches += 1
                print(f"employee {emp_id} ({name}): stored internal/external {old}, plan in force today {now}")
        print(f"{mismatches} employee(s) differ." if mismatches else "No differences: safe to migrate.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
