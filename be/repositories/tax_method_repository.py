"""
be/repositories/tax_method_repository.py
Repository for Employee Tax Method configurations (progressive or flat rate).
Handles active row retrieval, effective period lookups, history, and effective-dated row closure.
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from models_db import EmployeeTaxMethodDB


class TaxMethodRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_active(self, employee_id: int) -> Optional[EmployeeTaxMethodDB]:
        """Fetch the single currently active (open-ended) tax method row for an employee."""
        return (
            self.db.query(EmployeeTaxMethodDB)
            .filter(
                EmployeeTaxMethodDB.employee_id == employee_id,
                EmployeeTaxMethodDB.effective_end_date.is_(None),
            )
            .first()
        )

    def get_for_period(
        self, employee_id: int, period_start: str, period_end: str
    ) -> Optional[EmployeeTaxMethodDB]:
        """Fetch the tax method row overlapping the payroll period (latest start wins, then highest id)."""
        return (
            self.db.query(EmployeeTaxMethodDB)
            .filter(
                EmployeeTaxMethodDB.employee_id == employee_id,
                EmployeeTaxMethodDB.effective_start_date <= period_end,
                (
                    EmployeeTaxMethodDB.effective_end_date.is_(None)
                    | (EmployeeTaxMethodDB.effective_end_date >= period_start)
                ),
            )
            .order_by(
                desc(EmployeeTaxMethodDB.effective_start_date),
                desc(EmployeeTaxMethodDB.id),
            )
            .first()
        )

    def get_history(self, employee_id: int) -> List[EmployeeTaxMethodDB]:
        """Fetch the full effective-dated history of tax method rows for an employee."""
        return (
            self.db.query(EmployeeTaxMethodDB)
            .filter(EmployeeTaxMethodDB.employee_id == employee_id)
            .order_by(
                desc(EmployeeTaxMethodDB.effective_start_date),
                desc(EmployeeTaxMethodDB.id),
            )
            .all()
        )

    def close(self, active_row: EmployeeTaxMethodDB, effective_end_date: str) -> None:
        """Close an active tax method row by setting its effective_end_date."""
        active_row.effective_end_date = effective_end_date
        self.db.flush()

    def create(
        self,
        employee_id: int,
        method: str,
        flat_rate: Optional[float],
        effective_start_date: str,
        notes: str = "",
        created_by: str = "",
    ) -> EmployeeTaxMethodDB:
        """Create a new active tax method row."""
        existing_active = self.get_active(employee_id)
        if existing_active:
            raise ValueError(
                f"An active tax method record for employee {employee_id} already exists. Close it before inserting a new active row."
            )

        row = EmployeeTaxMethodDB(
            employee_id=employee_id,
            method=method,
            flat_rate=flat_rate if method == "flat" else None,
            effective_start_date=effective_start_date,
            effective_end_date=None,
            notes=notes or "",
            created_by=created_by or "",
        )
        self.db.add(row)
        self.db.flush()
        return row
