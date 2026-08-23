"""
be/repositories/sql/salary.py
SQLAlchemy-backed implementation of SalaryRepository.
"""
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Union

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import EmployeeDB, SalaryHistoryDB


def _history_to_dict(h: SalaryHistoryDB) -> dict:
    return {
        "id": h.id,
        "employee_id": h.employee_id,
        "date": h.date or "",
        "previous_salary": h.previous_salary if h.previous_salary is not None else 0.0,
        "new_salary": h.new_salary if h.new_salary is not None else 0.0,
        "pct_change": h.pct_change or "",
        "reason": h.reason or "",
        "applied_by": h.applied_by or "",
        "previous_internal_usd": h.previous_internal_usd if h.previous_internal_usd is not None else 0.0,
        "previous_external_usd": h.previous_external_usd if h.previous_external_usd is not None else 0.0,
        "new_internal_usd": h.new_internal_usd if h.new_internal_usd is not None else 0.0,
        "new_external_usd": h.new_external_usd if h.new_external_usd is not None else 0.0,
    }


class SqlSalaryRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def get_history(self, employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            query = db.query(SalaryHistoryDB)
            if employee_id is not None:
                query = query.filter(SalaryHistoryDB.employee_id == int(employee_id))
            history = query.order_by(SalaryHistoryDB.id).all()
            return [_history_to_dict(h) for h in history]

    def apply_raise(
        self,
        employee_id: Union[int, str],
        new_internal: float,
        new_external: float,
        effective_date: Optional[str],
        reason: str,
        actor_email: str,
    ) -> Dict[str, Any]:
        with self._get_session() as db:
            emp = db.query(EmployeeDB).filter(EmployeeDB.id == int(employee_id)).first()
            if not emp:
                raise ValueError("Employee not found")

            current_internal = float(emp.internal_salary_usd or 0)
            current_external = float(emp.external_salary_usd or 0)
            current_total = current_internal + current_external

            new_internal = round(new_internal, 2)
            new_external = round(new_external, 2)
            new_total = round(new_internal + new_external, 2)

            if new_internal < 0 or new_external < 0 or new_total <= 0:
                raise ValueError("Resulting salary must be non-negative and total must be positive")

            internal_delta_amount = round(new_internal - current_internal, 2)
            internal_delta_pct = round(internal_delta_amount / current_internal * 100, 2) if current_internal > 0 else 0.0
            external_delta_amount = round(new_external - current_external, 2)
            external_delta_pct = round(external_delta_amount / current_external * 100, 2) if current_external > 0 else 0.0
            total_delta_amount = round(new_total - current_total, 2)
            total_delta_pct = round(total_delta_amount / current_total * 100, 2) if current_total > 0 else 0.0

            eff_date = effective_date or datetime.utcnow().strftime("%Y-%m-%d")

            history = SalaryHistoryDB(
                employee_id=emp.id,
                date=eff_date,
                previous_salary=current_total,
                new_salary=new_total,
                pct_change=f"{'+' if total_delta_pct >= 0 else ''}{total_delta_pct}%",
                reason=reason,
                applied_by=actor_email,
                previous_internal_usd=current_internal,
                previous_external_usd=current_external,
                new_internal_usd=new_internal,
                new_external_usd=new_external,
            )
            db.add(history)

            is_backdated = effective_date is not None and eff_date < datetime.utcnow().strftime("%Y-%m-%d")
            if not is_backdated:
                next_raise_date = (datetime.strptime(eff_date, "%Y-%m-%d") + timedelta(days=365)).strftime("%Y-%m-%d")
                emp.internal_salary_usd = new_internal
                emp.external_salary_usd = new_external
                emp.salary = new_total
                emp.next_raise = next_raise_date

            emp_dict = {
                "id": emp.id,
                "name": emp.name,
                "email": emp.email,
            }
            db.commit()

            return {
                "message": "Raise applied",
                "previous_salary": current_total,
                "new_salary": new_total,
                "pct_change": total_delta_pct,
                "previous_internal_salary_usd": current_internal,
                "new_internal_salary_usd": new_internal,
                "previous_external_salary_usd": current_external,
                "new_external_salary_usd": new_external,
                "internal_delta_amount": internal_delta_amount,
                "internal_delta_pct": internal_delta_pct,
                "external_delta_amount": external_delta_amount,
                "external_delta_pct": external_delta_pct,
                "total_delta_amount": total_delta_amount,
                "total_delta_pct": total_delta_pct,
                "employee": emp_dict,
            }
