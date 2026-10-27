"""
be/finance/current_pay.py
Current pay of employees, derived from the compensation plan (D-046): the plan table is the only stored source of
amounts. The old employees.salary / internal_salary_usd / external_salary_usd columns are gone; the API keeps the
same field names and fills them from here.

"Current" means the plan rows in force on the given day: effective_start_date <= day and (effective_end_date empty
or >= day). Dates are YYYY-MM-DD strings.
"""
from datetime import date
from typing import Dict, Iterable, Optional

from sqlalchemy.orm import Session

from finance.models import EmployeeCompensationPlanDB

INTERNAL = "internal_usd_cash"
EXTERNAL = "external_usd"

# {employee_id: {"internal": x, "external": y, "total": x + y}}
PayMap = Dict[int, Dict[str, float]]


def zero_pay() -> Dict[str, float]:
    return {"internal": 0.0, "external": 0.0, "total": 0.0}


def current_pay_map(db: Session, employee_ids: Optional[Iterable[int]] = None, as_of: Optional[str] = None) -> PayMap:
    """Pay in force on as_of (default: today) for the given employees, or for every employee with a plan row."""
    day = as_of or date.today().isoformat()
    query = db.query(
        EmployeeCompensationPlanDB.employee_id,
        EmployeeCompensationPlanDB.component_type,
        EmployeeCompensationPlanDB.amount,
    ).filter(
        EmployeeCompensationPlanDB.effective_start_date <= day,
        (EmployeeCompensationPlanDB.effective_end_date.is_(None)) | (EmployeeCompensationPlanDB.effective_end_date >= day),
    )
    if employee_ids is not None:
        ids = list(employee_ids)
        if not ids:
            return {}
        query = query.filter(EmployeeCompensationPlanDB.employee_id.in_(ids))
    result: PayMap = {}
    for employee_id, component, amount in query.all():
        pay = result.setdefault(employee_id, zero_pay())
        if component == INTERNAL:
            pay["internal"] += float(amount or 0.0)
        elif component == EXTERNAL:
            pay["external"] += float(amount or 0.0)
    for pay in result.values():
        pay["internal"] = round(pay["internal"], 2)
        pay["external"] = round(pay["external"], 2)
        pay["total"] = round(pay["internal"] + pay["external"], 2)
    return result


def current_pay(db: Session, employee_id: int, as_of: Optional[str] = None) -> Dict[str, float]:
    return current_pay_map(db, [employee_id], as_of).get(employee_id, zero_pay())
