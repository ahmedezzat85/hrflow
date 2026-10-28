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
from finance.pay_history import history_view
from sqlalchemy import func
from sqlalchemy.orm import Session

from models_db import EmployeeDB, AuditLogDB, SalaryHistoryDB
from finance.models import EmployeeCompensationPlanDB, PayrollRunDB
from finance.repositories.compensation_plan_repository import CompensationPlanRepository

VALID_COMPONENT_TYPES = {"external_usd", "internal_usd_cash"}
_FINALIZED_STATUSES = ["finalized", "paid", "partially_paid"]


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
            "earliest_effective_date": self.get_earliest_effective_date(),
        }

    def get_history(self, employee_id: int) -> List[EmployeeCompensationPlanDB]:
        """Fetch all effective-dated compensation plan rows for an employee in reverse chronological order."""
        self._ensure_employee(employee_id)
        return self.repo.get_history(employee_id)

    def get_pay_history(self, employee_id: int) -> List[Dict[str, Any]]:
        """One row per pay change (both components as columns), newest first (D-036)."""
        self._ensure_employee(employee_id)
        rows = (
            self.db.query(SalaryHistoryDB)
            .filter(SalaryHistoryDB.employee_id == employee_id)
            .order_by(SalaryHistoryDB.date.desc(), SalaryHistoryDB.id.desc())
            .all()
        )
        # Amounts are derived from the plan rows, never stored on the history row (D-048).
        return [
            {k: v for k, v in item.items() if k not in ("previous_salary", "new_salary")}
            for item in history_view(self.db, rows)
        ]

    # ------------------------------------------------------------------ guards

    def _latest_finalized_period_end(self) -> Optional[str]:
        return (
            self.db.query(func.max(PayrollRunDB.period_end))
            .filter(PayrollRunDB.status.in_(_FINALIZED_STATUSES))
            .scalar()
        )

    def _check_finalized_guard(self, effective_start_date: str) -> None:
        """Reject dates in or before an already finalized/paid payroll period."""
        max_period_end = self._latest_finalized_period_end()
        if max_period_end and effective_start_date <= max_period_end:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"effective_start_date ({effective_start_date}) cannot be in or before an "
                    f"already finalized payroll period (latest finalized period ends {max_period_end})"
                ),
            )

    def get_earliest_effective_date(self) -> Optional[str]:
        """Day after the latest finalized/paid payroll period end, or None."""
        max_period_end = self._latest_finalized_period_end()
        if not max_period_end:
            return None
        return (datetime.strptime(max_period_end, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")

    @staticmethod
    def _parse_date(value: str) -> datetime:
        try:
            return datetime.strptime(value, "%Y-%m-%d")
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="effective_start_date must be in YYYY-MM-DD format",
            )

    def _check_not_overlapping_closed(
        self, employee_id: int, component_type: str, effective_start_date: str
    ) -> None:
        """A new row must start after the latest closed row of the same component."""
        latest_end = (
            self.db.query(func.max(EmployeeCompensationPlanDB.effective_end_date))
            .filter(
                EmployeeCompensationPlanDB.employee_id == employee_id,
                EmployeeCompensationPlanDB.component_type == component_type,
                EmployeeCompensationPlanDB.effective_end_date.isnot(None),
            )
            .scalar()
        )
        if latest_end and effective_start_date <= latest_end:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"effective_start_date ({effective_start_date}) overlaps an earlier closed "
                    f"{component_type} row (ended {latest_end}); choose a later date"
                ),
            )

    @staticmethod
    def _earlier_than_active_error(effective_start_date: str, active_start: str) -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"New effective_start_date ({effective_start_date}) must be strictly after the "
                f"current component's start date ({active_start})"
            ),
        )

    # ------------------------------------------------------------------ writes (flush only)

    def _write_component(
        self,
        emp: EmployeeDB,
        component_type: str,
        amt: float,
        basis: str,
        effective_start_date: str,
        notes: str,
    ) -> EmployeeCompensationPlanDB:
        """Write an amount > 0 with set_component semantics. Flushes; never commits."""
        employee_id = emp.id
        start_dt = self._parse_date(effective_start_date)
        active_row = self.repo.get_active_component(employee_id, component_type)
        if active_row:
            if effective_start_date == active_row.effective_start_date:
                active_row.amount = amt
                if component_type == "internal_usd_cash":
                    active_row.salary_basis = basis
                if notes:
                    active_row.notes = notes
                new_row = active_row
            elif effective_start_date < active_row.effective_start_date:
                raise self._earlier_than_active_error(effective_start_date, active_row.effective_start_date)
            else:
                end_date_str = (start_dt - timedelta(days=1)).strftime("%Y-%m-%d")
                self.repo.close_component(active_row, end_date_str)
                new_row = self.repo.create_component(
                    employee_id=employee_id,
                    component_type=component_type,
                    amount=amt,
                    effective_start_date=effective_start_date,
                    notes=notes or "",
                    currency="USD",
                    salary_basis=basis,
                )
        else:
            self._check_not_overlapping_closed(employee_id, component_type, effective_start_date)
            new_row = self.repo.create_component(
                employee_id=employee_id,
                component_type=component_type,
                amount=amt,
                effective_start_date=effective_start_date,
                notes=notes or "",
                currency="USD",
                salary_basis=basis,
            )
        self.db.flush()
        return new_row

    def _close_by_zero(
        self, emp: EmployeeDB, component_type: str, effective_start_date: str
    ) -> None:
        active_row = self.repo.get_active_component(emp.id, component_type)
        end_dt = self._parse_date(effective_start_date) - timedelta(days=1)
        self.repo.close_component(active_row, end_dt.strftime("%Y-%m-%d"))

    # ------------------------------------------------------------------ public

    def apply_pay_change(
        self,
        employee_id: int,
        internal_amount: float,
        external_amount: float,
        effective_start_date: str,
        internal_basis: Optional[str] = None,
        notes: str = "",
        actor_email: Optional[str] = None,
        commit: bool = True,
        reason: Optional[str] = None,
        force_history: bool = False,
    ) -> Dict[str, Any]:
        """
        Apply a pay change to both components in ONE transaction with ONE audit entry
        and, when anything changed, ONE salary_history row (D-036). Both amounts are
        required and >= 0; 0 closes the active row of that component
        (end = effective date - 1 day). Both at 0 is rejected before any write.
        internal_basis None keeps the active row's basis (NET when there is none).
        reason is the history reason (defaults to notes). force_history writes the history
        row even when no component changed (a raise is an event of its own).
        Returns {"changes": [{component_type, action, previous_amount, new_amount}]}.
        """
        emp = self._ensure_employee(employee_id)

        amounts: Dict[str, float] = {}
        for ctype, raw in (("internal_usd_cash", internal_amount), ("external_usd", external_amount)):
            try:
                amt = round(float(raw), 2)
            except (ValueError, TypeError):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Component amount must be a valid number",
                )
            if amt < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Component amount cannot be negative",
                )
            amounts[ctype] = amt
        if amounts["internal_usd_cash"] <= 0 and amounts["external_usd"] <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one component must be above 0",
            )

        req_basis = None
        if internal_basis is not None:
            req_basis = str(internal_basis).upper()
            if req_basis not in ("NET", "GROSS"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="salary_basis must be either 'NET' or 'GROSS'",
                )

        self._parse_date(effective_start_date)

        # Plan phase: decide an action per component and validate everything before any write.
        plan = []
        for ctype in ("internal_usd_cash", "external_usd"):
            amt = amounts[ctype]
            active = self.repo.get_active_component(employee_id, ctype)
            prev_amount = round(float(active.amount), 2) if active else 0.0
            if ctype == "internal_usd_cash":
                basis = req_basis or ((active.salary_basis or "NET").upper() if active else "NET")
            else:
                basis = "NET"
            if active is None and amt == 0:
                action = "unchanged"
            elif (
                active is not None
                and amt > 0
                and prev_amount == amt
                and (ctype != "internal_usd_cash" or (active.salary_basis or "NET").upper() == basis)
            ):
                action = "unchanged"
            elif amt == 0:
                if effective_start_date <= active.effective_start_date:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"Cannot end {ctype} on {effective_start_date}: the effective date must be "
                            f"after the current row's start date ({active.effective_start_date}); pick a later date"
                        ),
                    )
                action = "closed"
            elif active is None:
                action = "created"
            else:
                action = "updated"
            plan.append((ctype, amt, basis, action, prev_amount, active))

        changed = [p for p in plan if p[3] != "unchanged"]
        if changed:
            self._check_finalized_guard(effective_start_date)
            for ctype, _amt, _basis, action, _prev, active in changed:
                if action == "created":
                    self._check_not_overlapping_closed(employee_id, ctype, effective_start_date)
                elif action == "updated" and effective_start_date < active.effective_start_date:
                    raise self._earlier_than_active_error(effective_start_date, active.effective_start_date)

        changes = []
        for ctype, amt, basis, action, prev_amount, _active in plan:
            if action == "closed":
                self._close_by_zero(emp, ctype, effective_start_date)
            elif action in ("created", "updated"):
                self._write_component(emp, ctype, amt, basis, effective_start_date, notes)
            changes.append({
                "component_type": ctype,
                "action": action,
                "previous_amount": prev_amount,
                "new_amount": amt,
            })

        if changed or force_history:
            # Only the event is stored; the amounts come from the plan rows (D-048).
            self.db.add(SalaryHistoryDB(
                employee_id=employee_id,
                date=effective_start_date,
                reason=(reason if reason is not None else notes) or "",
                applied_by=actor_email or "",
            ))
        if changed:
            try:
                self.db.add(AuditLogDB(
                    timestamp=datetime.utcnow().isoformat() + "Z",
                    actor_email=actor_email or "system@hrflow.internal",
                    action="employee.compensation_plan.updated",
                    target_type="employee",
                    target_id=str(employee_id),
                    details=json.dumps({
                        "effective_start_date": effective_start_date,
                        "internal_salary_basis": next(p[2] for p in plan if p[0] == "internal_usd_cash"),
                        "before": {p[0]: p[4] for p in plan},
                        "after": {p[0]: p[1] for p in plan},
                        "changes": changes,
                        "notes": notes,
                    }),
                ))
            except Exception:
                pass

        self.db.flush()
        if commit:
            self.db.commit()
        return {"changes": changes}

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

        self._parse_date(effective_start_date)
        # Validation: effective_start_date cannot be in the past beyond the current open payroll run's period
        self._check_finalized_guard(effective_start_date)

        active_row = self.repo.get_active_component(employee_id, component_type)
        old_basis = getattr(active_row, "salary_basis", "NET") if active_row else None
        new_row = self._write_component(
            emp, component_type, amt, normalized_basis, effective_start_date, notes
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
