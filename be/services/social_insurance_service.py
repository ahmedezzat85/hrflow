"""
be/services/social_insurance_service.py
Service layer for Employee Social Insurance Configurations.
Enforces validation (insured base <= internal salary, no future pre-staging,
finalized run boundary guard, effective-dated row closure, and audit logging).
"""
from datetime import datetime, timedelta
import json
from typing import Dict, Any, List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models_db import EmployeeDB, AuditLogDB, EmployeeSocialInsuranceDB
from finance.models import PayrollRunDB
from repositories.social_insurance_repository import SocialInsuranceRepository


class SocialInsuranceService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = SocialInsuranceRepository(db)

    def _ensure_employee(self, employee_id: int) -> EmployeeDB:
        emp = self.db.query(EmployeeDB).filter(EmployeeDB.id == employee_id).first()
        if not emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee {employee_id} not found",
            )
        return emp

    def get_active_insurance(self, employee_id: int) -> Optional[EmployeeSocialInsuranceDB]:
        """Fetch the active social insurance configuration for an employee."""
        self._ensure_employee(employee_id)
        return self.repo.get_active_insurance(employee_id)

    def get_history(self, employee_id: int) -> List[EmployeeSocialInsuranceDB]:
        """Fetch full effective-dated history of social insurance records for an employee."""
        self._ensure_employee(employee_id)
        return self.repo.get_history(employee_id)

    def set_insurance(
        self,
        employee_id: int,
        insured_flag: bool,
        insured_base: Optional[float],
        effective_start_date: str,
        notes: str = "",
        user_email: Optional[str] = None,
    ) -> EmployeeSocialInsuranceDB:
        """
        Configure or update an employee's social insurance coverage and insured base.
        Enforces effective-dating rules, finalized-period guards, and internal-salary ceilings.
        """
        emp = self._ensure_employee(employee_id)

        try:
            start_dt = datetime.strptime(effective_start_date, "%Y-%m-%d")
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="effective_start_date must be in YYYY-MM-DD format",
            )

        # 1. No future pre-staging: effective_start_date cannot be in the future
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        if effective_start_date > today_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"effective_start_date ({effective_start_date}) cannot be in the future (today is {today_str}). Future pre-staging is not permitted.",
            )

        # 2. Finalized payroll run boundary guard
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

        # 3. Validation on insured base
        cleaned_base: Optional[float] = None
        if insured_flag:
            if insured_base is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="insured_base is required when social insurance coverage is enabled",
                )
            try:
                cleaned_base = round(float(insured_base), 2)
            except (ValueError, TypeError):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="insured_base must be a valid number",
                )

            if cleaned_base < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="insured_base cannot be negative",
                )
        else:
            cleaned_base = None

        # 4. Effective-dated row closure & update
        active_row = self.repo.get_active_insurance(employee_id)
        if active_row:
            if effective_start_date == active_row.effective_start_date:
                active_row.insured_flag = bool(insured_flag)
                active_row.insured_base = cleaned_base
                active_row.currency = "EGP"
                if notes is not None:
                    active_row.notes = notes
                new_row = active_row
            elif effective_start_date < active_row.effective_start_date:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"New effective_start_date ({effective_start_date}) must be strictly after the "
                        f"current record start date ({active_row.effective_start_date})"
                    ),
                )
            else:
                # Close previous row: effective_end_date = effective_start_date - 1 day
                end_date_str = (start_dt - timedelta(days=1)).strftime("%Y-%m-%d")
                self.repo.close_insurance(active_row, end_date_str)
                new_row = self.repo.create_insurance(
                    employee_id=employee_id,
                    insured_flag=bool(insured_flag),
                    insured_base=cleaned_base,
                    effective_start_date=effective_start_date,
                    notes=notes or "",
                    currency="EGP",
                    created_by=user_email or "system",
                )
        else:
            new_row = self.repo.create_insurance(
                employee_id=employee_id,
                insured_flag=bool(insured_flag),
                insured_base=cleaned_base,
                effective_start_date=effective_start_date,
                notes=notes or "",
                currency="EGP",
                created_by=user_email or "system",
            )

        # 5. Audit Logging
        try:
            audit = AuditLogDB(
                timestamp=datetime.utcnow().isoformat() + "Z",
                actor_email=user_email or "system@hrflow.internal",
                action="employee.social_insurance.updated",
                target_type="employee",
                target_id=str(employee_id),
                details=json.dumps({
                    "insured_flag": bool(insured_flag),
                    "insured_base": cleaned_base,
                    "currency": "EGP",
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
