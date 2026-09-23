"""
be/repositories/social_insurance_repository.py
Repository for Employee Social Insurance Configurations.
Handles active insurance retrieval, effective period lookups, history, and effective-dated row closure.
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from models_db import EmployeeSocialInsuranceDB


class SocialInsuranceRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_active_insurance(self, employee_id: int) -> Optional[EmployeeSocialInsuranceDB]:
        """Fetch the single currently active (open-ended) social insurance row for an employee."""
        return (
            self.db.query(EmployeeSocialInsuranceDB)
            .filter(
                EmployeeSocialInsuranceDB.employee_id == employee_id,
                EmployeeSocialInsuranceDB.effective_end_date.is_(None),
            )
            .first()
        )

    def get_insurance_for_period(
        self, employee_id: int, period_start: str, period_end: str
    ) -> Optional[EmployeeSocialInsuranceDB]:
        """Fetch the applicable social insurance row overlapping the specified payroll period."""
        return (
            self.db.query(EmployeeSocialInsuranceDB)
            .filter(
                EmployeeSocialInsuranceDB.employee_id == employee_id,
                EmployeeSocialInsuranceDB.effective_start_date <= period_end,
                (
                    EmployeeSocialInsuranceDB.effective_end_date.is_(None)
                    | (EmployeeSocialInsuranceDB.effective_end_date >= period_start)
                ),
            )
            .order_by(
                desc(EmployeeSocialInsuranceDB.effective_start_date),
                desc(EmployeeSocialInsuranceDB.id),
            )
            .first()
        )

    def get_history(self, employee_id: int) -> List[EmployeeSocialInsuranceDB]:
        """Fetch full effective-dated history of social insurance rows for an employee."""
        return (
            self.db.query(EmployeeSocialInsuranceDB)
            .filter(EmployeeSocialInsuranceDB.employee_id == employee_id)
            .order_by(
                desc(EmployeeSocialInsuranceDB.effective_start_date),
                desc(EmployeeSocialInsuranceDB.id),
            )
            .all()
        )

    def close_insurance(
        self, active_row: EmployeeSocialInsuranceDB, effective_end_date: str
    ) -> None:
        """Close an active social insurance row by setting its effective_end_date."""
        active_row.effective_end_date = effective_end_date
        self.db.flush()

    def create_insurance(
        self,
        employee_id: int,
        insured_flag: bool,
        insured_base: Optional[float],
        effective_start_date: str,
        notes: str = "",
        currency: str = "USD",
        created_by: str = "",
    ) -> EmployeeSocialInsuranceDB:
        """Create a new active social insurance row."""
        existing_active = self.get_active_insurance(employee_id)
        if existing_active:
            raise ValueError(
                f"An active social insurance record for employee {employee_id} already exists. Close it before inserting a new active row."
            )

        row = EmployeeSocialInsuranceDB(
            employee_id=employee_id,
            insured_flag=bool(insured_flag),
            insured_base=round(float(insured_base), 2) if (insured_base is not None and insured_flag) else None,
            currency=currency or "USD",
            effective_start_date=effective_start_date,
            effective_end_date=None,
            notes=notes or "",
            created_by=created_by or "",
        )
        self.db.add(row)
        self.db.flush()
        return row
