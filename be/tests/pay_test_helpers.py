"""
be/tests/pay_test_helpers.py
Pay is not stored on the employee any more (D-046): tests read it from the compensation plan.
"""
from db import get_db_context
from finance.current_pay import current_pay


def pay_of(emp_id):
    """{"internal", "external", "total"} in force today for the employee."""
    with get_db_context() as db:
        return current_pay(db, emp_id)


def seed_plan(emp_id, internal=0.0, external=0.0, start="2020-01-01", end=None, basis="NET"):
    """Give an employee plan rows directly (the only stored pay)."""
    from finance.models import EmployeeCompensationPlanDB
    with get_db_context() as db:
        for component, amount in (("internal_usd_cash", internal), ("external_usd", external)):
            if amount:
                db.add(EmployeeCompensationPlanDB(
                    employee_id=emp_id, component_type=component, amount=amount, salary_basis=basis,
                    effective_start_date=start, effective_end_date=end))
        db.commit()
