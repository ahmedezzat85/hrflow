"""
be/finance/repositories/compensation_plan_repository.py
Repository for Employee Compensation Plans (FUX-416).
Handles queries, active component retrieval, history queries, and effective-dated row creation.
"""
from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from finance.models import EmployeeCompensationPlanDB


class CompensationPlanRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_active_components(self, employee_id: int) -> List[EmployeeCompensationPlanDB]:
        """Fetch all currently active (open-ended) compensation plan rows for an employee."""
        return (
            self.db.query(EmployeeCompensationPlanDB)
            .filter(
                EmployeeCompensationPlanDB.employee_id == employee_id,
                EmployeeCompensationPlanDB.effective_end_date.is_(None),
            )
            .order_by(EmployeeCompensationPlanDB.component_type.asc())
            .all()
        )

    def get_active_component(
        self, employee_id: int, component_type: str
    ) -> Optional[EmployeeCompensationPlanDB]:
        """Fetch the single currently active row for an employee and component type."""
        return (
            self.db.query(EmployeeCompensationPlanDB)
            .filter(
                EmployeeCompensationPlanDB.employee_id == employee_id,
                EmployeeCompensationPlanDB.component_type == component_type,
                EmployeeCompensationPlanDB.effective_end_date.is_(None),
            )
            .first()
        )

    def get_components_for_period(
        self, employee_id: int, period_start: str, period_end: str
    ) -> List[EmployeeCompensationPlanDB]:
        """Fetch active components for an employee overlapping the specified period."""
        return (
            self.db.query(EmployeeCompensationPlanDB)
            .filter(
                EmployeeCompensationPlanDB.employee_id == employee_id,
                EmployeeCompensationPlanDB.effective_start_date <= period_end,
                (
                    EmployeeCompensationPlanDB.effective_end_date.is_(None)
                    | (EmployeeCompensationPlanDB.effective_end_date >= period_start)
                ),
            )
            .order_by(EmployeeCompensationPlanDB.component_type.asc())
            .all()
        )

    def get_history(self, employee_id: int) -> List[EmployeeCompensationPlanDB]:
        """Fetch full effective-dated history of compensation rows for an employee."""
        return (
            self.db.query(EmployeeCompensationPlanDB)
            .filter(EmployeeCompensationPlanDB.employee_id == employee_id)
            .order_by(
                desc(EmployeeCompensationPlanDB.effective_start_date),
                desc(EmployeeCompensationPlanDB.id),
            )
            .all()
        )

    def create_component(
        self,
        employee_id: int,
        component_type: str,
        amount: float,
        effective_start_date: str,
        notes: str = "",
        currency: str = "USD",
        salary_basis: str = "NET",
    ) -> EmployeeCompensationPlanDB:
        """
        Create a new active compensation plan row.
        Enforces at most one active row per employee and component type.
        """
        existing_active = self.get_active_component(employee_id, component_type)
        if existing_active:
            raise ValueError(
                f"An active compensation plan row for employee {employee_id} and component '{component_type}' already exists. Close it before inserting a new active row."
            )

        row = EmployeeCompensationPlanDB(
            employee_id=employee_id,
            component_type=component_type,
            amount=round(float(amount), 2),
            currency=currency or "USD",
            salary_basis=(salary_basis or "NET").upper(),
            effective_start_date=effective_start_date,
            effective_end_date=None,
            notes=notes or "",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self.db.add(row)
        self.db.flush()
        self.db.refresh(row)
        return row

    def close_component(
        self, component: EmployeeCompensationPlanDB, effective_end_date: str
    ) -> None:
        """Close an active component row with an effective_end_date."""
        component.effective_end_date = effective_end_date
        component.updated_at = datetime.utcnow()
        self.db.flush()
