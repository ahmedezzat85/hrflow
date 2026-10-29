"""
be/services/employee_delete_guard.py
An employee who has pay or payroll history cannot be deleted: those rows are finance records (what was agreed, taxed,
insured and paid), and deleting the employee would erase them. The database refuses it too (foreign keys with RESTRICT);
this check gives the caller a readable answer first. Use the employee's status (for example Suspended) instead.
"""
from typing import Dict

from sqlalchemy import func
from sqlalchemy.orm import Session

from finance.models import EmployeeCompensationPlanDB, PayrollAdjustmentDB, PayrollLineDB
from models_db import EmployeeSocialInsuranceDB, EmployeeTaxMethodDB

HISTORY = (
    ("pay plan rows", EmployeeCompensationPlanDB),
    ("tax method rows", EmployeeTaxMethodDB),
    ("social insurance rows", EmployeeSocialInsuranceDB),
    ("payroll lines", PayrollLineDB),
    ("payroll adjustments", PayrollAdjustmentDB),
)


def pay_history_counts(db: Session, employee_id: int) -> Dict[str, int]:
    """{label: row count} for every kind of pay or payroll history the employee has; empty when there is none."""
    counts: Dict[str, int] = {}
    for label, model in HISTORY:
        n = db.query(func.count()).select_from(model).filter(model.employee_id == employee_id).scalar() or 0
        if n:
            counts[label] = int(n)
    return counts


def delete_blocked_message(counts: Dict[str, int]) -> str:
    listing = ", ".join(f"{n} {label}" for label, n in counts.items())
    return (
        f"This employee has pay history ({listing}) and cannot be deleted. "
        "Set their status to Suspended instead; their pay records stay available to finance."
    )
