"""
be/services/tax_method_service.py
Service layer for Employee Tax Method configurations (progressive or flat rate).
Enforces validation (method and flat rate, no future pre-staging, finalized run boundary guard,
effective-dated row closure, and audit logging).

Period rule: payroll periods are calendar months and the latest-starting row that overlaps the
period wins, so a row starting mid-month applies to that whole month. Date changes on the 1st.
"""
from datetime import datetime, timedelta
import json
from typing import List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models_db import EmployeeDB, AuditLogDB, EmployeeTaxMethodDB
from finance.models import PayrollRunDB
from repositories.tax_method_repository import TaxMethodRepository

TAX_METHODS = ("progressive", "flat")


class TaxMethodService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = TaxMethodRepository(db)

    def _ensure_employee(self, employee_id: int) -> EmployeeDB:
        emp = self.db.query(EmployeeDB).filter(EmployeeDB.id == employee_id).first()
        if not emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee {employee_id} not found",
            )
        return emp

    def get_active(self, employee_id: int) -> Optional[EmployeeTaxMethodDB]:
        """Fetch the active tax method configuration for an employee."""
        self._ensure_employee(employee_id)
        return self.repo.get_active(employee_id)

    def get_history(self, employee_id: int) -> List[EmployeeTaxMethodDB]:
        """Fetch the full effective-dated history of tax method records for an employee."""
        self._ensure_employee(employee_id)
        return self.repo.get_history(employee_id)

    def set_tax_method(
        self,
        employee_id: int,
        method: str,
        flat_rate: Optional[float],
        effective_start_date: str,
        notes: str = "",
        user_email: Optional[str] = None,
    ) -> EmployeeTaxMethodDB:
        """
        Configure or update an employee's tax method (progressive or flat rate).
        Enforces effective-dating rules, finalized-period guards and flat rate validation.
        """
        self._ensure_employee(employee_id)

        try:
            start_dt = datetime.strptime(effective_start_date, "%Y-%m-%d")
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="effective_start_date must be in YYYY-MM-DD format",
            )

        # 1. Method and rate validation
        if method not in TAX_METHODS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"method must be one of: {', '.join(TAX_METHODS)}",
            )
        cleaned_rate: Optional[float] = None
        if method == "flat":
            if flat_rate is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="flat_rate is required when the tax method is flat",
                )
            try:
                cleaned_rate = round(float(flat_rate), 6)
            except (ValueError, TypeError):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="flat_rate must be a valid number",
                )
            if not (0 < cleaned_rate <= 1):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="flat_rate must be greater than 0 and at most 1 (for example 0.10 for 10%)",
                )

        # 2. No future pre-staging
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        if effective_start_date > today_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"effective_start_date ({effective_start_date}) cannot be in the future (today is {today_str}). Future pre-staging is not permitted.",
            )

        # 3. Finalized payroll run boundary guard
        finalized_runs = (
            self.db.query(PayrollRunDB)
            .filter(PayrollRunDB.status.in_(["finalized", "paid", "partially_paid"]))
            .all()
        )
        if finalized_runs:
            max_period_end = max(r.period_end for r in finalized_runs)
            if effective_start_date <= max_period_end:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"effective_start_date ({effective_start_date}) cannot be in or before an "
                        f"already finalized payroll period (latest finalized period ends {max_period_end})"
                    ),
                )

        # 4. Effective-dated row closure & update
        active_row = self.repo.get_active(employee_id)
        if active_row and effective_start_date == active_row.effective_start_date:
            active_row.method = method
            active_row.flat_rate = cleaned_rate
            if notes is not None:
                active_row.notes = notes
            new_row = active_row
        elif active_row and effective_start_date < active_row.effective_start_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"New effective_start_date ({effective_start_date}) must be strictly after the "
                    f"current record start date ({active_row.effective_start_date})"
                ),
            )
        else:
            if active_row:
                end_date_str = (start_dt - timedelta(days=1)).strftime("%Y-%m-%d")
                self.repo.close(active_row, end_date_str)
            new_row = self.repo.create(
                employee_id=employee_id,
                method=method,
                flat_rate=cleaned_rate,
                effective_start_date=effective_start_date,
                notes=notes or "",
                created_by=user_email or "system",
            )

        # 5. Audit Logging
        try:
            audit = AuditLogDB(
                timestamp=datetime.utcnow().isoformat() + "Z",
                actor_email=user_email or "system@hrflow.internal",
                action="employee.tax_method.updated",
                target_type="employee",
                target_id=str(employee_id),
                details=json.dumps({
                    "method": method,
                    "flat_rate": cleaned_rate,
                    "effective_start_date": effective_start_date,
                    "notes": notes,
                }),
            )
            self.db.add(audit)
        except Exception:
            pass

        self.db.commit()
        self.db.refresh(new_row)
        return new_row
