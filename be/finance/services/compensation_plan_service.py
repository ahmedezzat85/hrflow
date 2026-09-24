"""
be/finance/services/compensation_plan_service.py
Service layer for Employee Compensation Plans (FUX-416).
Enforces component validation, history preservation via effective-dated row closure,
single active row invariants, and finalized payroll run boundary guards.
"""
import json
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models_db import EmployeeDB, AuditLogDB
from finance.models import EmployeeCompensationPlanDB, PayrollRunDB
from finance.repositories.compensation_plan_repository import CompensationPlanRepository

VALID_COMPONENT_TYPES = {"external_usd", "internal_usd_cash"}


class CompensationPlanService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = CompensationPlanRepository(db)

    def _ensure_employee(self, employee_id: int) -> EmployeeDB:
        emp = self.db.query(EmployeeDB).filter(EmployeeDB.id == employee_id).first()
        if not emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee {employee_id} not found",
            )
        return emp

    def get_active_plan(self, employee_id: int) -> Dict[str, Any]:
        """Fetch the current active plan for an employee with both components and monthly total."""
        self._ensure_employee(employee_id)
        components = self.repo.get_active_components(employee_id)
        ext = next((c for c in components if c.component_type == "external_usd"), None)
        int_cash = next(
            (c for c in components if c.component_type == "internal_usd_cash"), None
        )
        total = round(
            (ext.amount if ext else 0.0) + (int_cash.amount if int_cash else 0.0), 2
        )
        return {
            "employee_id": employee_id,
            "external_usd": ext,
            "internal_usd_cash": int_cash,
            "total_monthly_usd": total,
        }

    def get_history(self, employee_id: int) -> List[EmployeeCompensationPlanDB]:
        """Fetch all effective-dated compensation plan rows for an employee in reverse chronological order."""
        self._ensure_employee(employee_id)
        return self.repo.get_history(employee_id)

    def set_component(
        self,
        employee_id: int,
        component_type: str,
        amount: float,
        effective_start_date: str,
        notes: str = "",
        salary_basis: Optional[str] = "NET",
        user_email: Optional[str] = None,
    ) -> EmployeeCompensationPlanDB:
        """
        Set or update an employee compensation component.
        Closes any existing open-ended row for that component (effective_end_date = effective_start_date - 1 day)
        and inserts a new active row.
        """
        emp = self._ensure_employee(employee_id)

        if component_type not in VALID_COMPONENT_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid component_type '{component_type}'. Allowed types: {sorted(list(VALID_COMPONENT_TYPES))}",
            )

        if component_type == "internal_usd_cash":
            normalized_basis = (salary_basis or "NET").upper()
            if normalized_basis not in ("NET", "GROSS"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="salary_basis must be either 'NET' or 'GROSS'",
                )
        else:
            normalized_basis = "NET"

        try:
            amt = float(amount)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Component amount must be a valid number",
            )

        if amt <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Component amount must be greater than 0",
            )

        try:
            start_dt = datetime.strptime(effective_start_date, "%Y-%m-%d")
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="effective_start_date must be in YYYY-MM-DD format",
            )

        # Validation: effective_start_date cannot be in the past beyond the current open payroll run's period
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

        active_row = self.repo.get_active_component(employee_id, component_type)
        old_basis = getattr(active_row, "salary_basis", "NET") if active_row else None
        if active_row:
            if effective_start_date == active_row.effective_start_date:
                active_row.amount = amt
                if component_type == "internal_usd_cash":
                    active_row.salary_basis = normalized_basis
                if notes:
                    active_row.notes = notes
                new_row = active_row
            elif effective_start_date < active_row.effective_start_date:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"New effective_start_date ({effective_start_date}) must be strictly after the "
                        f"current component's start date ({active_row.effective_start_date})"
                    ),
                )
            else:
                # Close previous row: effective_end_date = effective_start_date - 1 day
                end_date_str = (start_dt - timedelta(days=1)).strftime("%Y-%m-%d")
                self.repo.close_component(active_row, end_date_str)
                new_row = self.repo.create_component(
                    employee_id=employee_id,
                    component_type=component_type,
                    amount=amt,
                    effective_start_date=effective_start_date,
                    notes=notes or "",
                    currency="USD",
                    salary_basis=normalized_basis,
                )
        else:
            new_row = self.repo.create_component(
                employee_id=employee_id,
                component_type=component_type,
                amount=amt,
                effective_start_date=effective_start_date,
                notes=notes or "",
                currency="USD",
                salary_basis=normalized_basis,
            )

        # Synchronize employee split fields on EmployeeDB
        if component_type == "external_usd":
            emp.external_salary_usd = round(amt, 2)
        elif component_type == "internal_usd_cash":
            emp.internal_salary_usd = round(amt, 2)

        emp.salary = round(
            (emp.external_salary_usd or 0.0) + (emp.internal_salary_usd or 0.0), 2
        )

        # Audit Logging for salary basis update
        try:
            audit = AuditLogDB(
                timestamp=datetime.utcnow().isoformat() + "Z",
                actor_email=user_email or "system@hrflow.internal",
                action="employee.salary_basis.updated" if component_type == "internal_usd_cash" else "employee.compensation_plan.updated",
                target_type="employee",
                target_id=str(employee_id),
                details=json.dumps({
                    "component_type": component_type,
                    "amount": amt,
                    "old_salary_basis": old_basis,
                    "salary_basis": normalized_basis,
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
