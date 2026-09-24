"""
be/finance/routers/compensation_plans.py
API router for Employee Compensation Plans (FUX-416).
Provides endpoints to view the current active plan, full effective-dated history,
and set/update individual plan components with automatic history preservation.
"""
from typing import List
from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from db import get_db
from core.permissions import require_permission
from finance.schemas import (
    EmployeeCompensationPlanResponse,
    CompensationComponentResponse,
    CompensationComponentSetRequest,
)
from finance.services.compensation_plan_service import CompensationPlanService

router = APIRouter(
    prefix="/api/finance/employees/{employee_id}/compensation-plan",
    tags=["Finance - Compensation Plans"],
)


def get_compensation_plan_service(
    db: Session = Depends(get_db),
) -> CompensationPlanService:
    return CompensationPlanService(db)


@router.get("", response_model=EmployeeCompensationPlanResponse)
def get_active_compensation_plan(
    employee_id: int = Path(..., description="Employee ID"),
    service: CompensationPlanService = Depends(get_compensation_plan_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Retrieve the current active compensation plan components and total monthly USD for an employee."""
    return service.get_active_plan(employee_id)


@router.get("/history", response_model=List[CompensationComponentResponse])
def get_compensation_plan_history(
    employee_id: int = Path(..., description="Employee ID"),
    service: CompensationPlanService = Depends(get_compensation_plan_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Retrieve full effective-dated history of all compensation plan rows for an employee."""
    return service.get_history(employee_id)


@router.put("/{component_type}", response_model=CompensationComponentResponse)
def set_compensation_component(
    payload: CompensationComponentSetRequest,
    employee_id: int = Path(..., description="Employee ID"),
    component_type: str = Path(
        ..., description="Component type: external_usd or internal_usd_cash"
    ),
    service: CompensationPlanService = Depends(get_compensation_plan_service),
    current_user: dict = Depends(require_permission("finance.payroll.write")),
):
    """
    Set or update an employee's compensation component.
    Closes the existing active row (effective_end_date = effective_start_date - 1 day)
    and records the new active row.
    """
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.set_component(
        employee_id=employee_id,
        component_type=component_type,
        amount=payload.amount,
        effective_start_date=payload.effective_start_date,
        notes=payload.notes or "",
        salary_basis=payload.salary_basis,
        user_email=user_email,
    )
