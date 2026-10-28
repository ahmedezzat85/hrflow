"""
be/services/employee_derived.py
Employee facts that used to be stored as copies on `employees` and are now derived on read (database redesign,
Stage 1). The API keeps the same field names (`vac_used`, `next_raise`).

- vac_used: approved annual-leave days that start in the calendar year, from `vacation_history`.
- next_raise: one year after the latest pay change in `salary_history`; empty when there has been none.
"""
from datetime import date, timedelta
from typing import Dict, Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models_db import SalaryHistoryDB, VacationHistoryDB

RAISE_INTERVAL_DAYS = 365
ANNUAL_LEAVE = "Annual Leave"


def vacation_days_used_map(db: Session, employee_ids: Iterable[int], year: Optional[int] = None) -> Dict[int, int]:
    """{employee_id: approved annual-leave days starting in `year` (default: this year)}; absent means 0."""
    ids = list(employee_ids)
    if not ids:
        return {}
    year = year or date.today().year
    rows = (
        db.query(VacationHistoryDB.employee_id, func.coalesce(func.sum(VacationHistoryDB.days), 0))
        .filter(
            VacationHistoryDB.employee_id.in_(ids),
            VacationHistoryDB.status == "Approved",
            (VacationHistoryDB.type == ANNUAL_LEAVE) | (VacationHistoryDB.type.is_(None)) | (VacationHistoryDB.type == ""),
            VacationHistoryDB.start_date >= f"{year}-01-01",
            VacationHistoryDB.start_date < f"{year + 1}-01-01",
        )
        .group_by(VacationHistoryDB.employee_id)
        .all()
    )
    return {employee_id: int(days or 0) for employee_id, days in rows}


def next_raise_map(db: Session, employee_ids: Iterable[int]) -> Dict[int, str]:
    """{employee_id: YYYY-MM-DD}; employees without a pay change are absent."""
    ids = list(employee_ids)
    if not ids:
        return {}
    rows = (
        db.query(SalaryHistoryDB.employee_id, func.max(SalaryHistoryDB.date))
        .filter(SalaryHistoryDB.employee_id.in_(ids))
        .group_by(SalaryHistoryDB.employee_id)
        .all()
    )
    result: Dict[int, str] = {}
    for employee_id, latest in rows:
        try:
            result[employee_id] = (date.fromisoformat(str(latest)[:10]) + timedelta(days=RAISE_INTERVAL_DAYS)).isoformat()
        except ValueError:
            continue
    return result
