"""
be/routers/social_insurance.py
API endpoints for managing employee social insurance coverage and insured base (effective-dated).
"""
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from models import EmployeeSocialInsuranceUpsert, EmployeeSocialInsuranceResponse
from services.social_insurance_service import SocialInsuranceService
from core.permissions import require_permission

router = APIRouter(prefix="/api/employees/{emp_id}/social-insurance", tags=["Social Insurance"])


@router.get("", response_model=Optional[EmployeeSocialInsuranceResponse])
def get_employee_social_insurance(
    emp_id: int,
    current_user: dict = Depends(require_permission("hr.employee.read")),
    db: Session = Depends(get_db),
):
    """Fetch active social insurance configuration for an employee."""
    service = SocialInsuranceService(db)
    active = service.get_active_insurance(emp_id)
    return active


@router.get("/history", response_model=List[EmployeeSocialInsuranceResponse])
def get_employee_social_insurance_history(
    emp_id: int,
    current_user: dict = Depends(require_permission("hr.employee.read")),
    db: Session = Depends(get_db),
):
    """Fetch effective-dated history of social insurance records for an employee."""
    service = SocialInsuranceService(db)
    return service.get_history(emp_id)


@router.put("", response_model=EmployeeSocialInsuranceResponse)
def set_employee_social_insurance(
    emp_id: int,
    payload: EmployeeSocialInsuranceUpsert,
    current_user: dict = Depends(require_permission("hr.salary.write")),
    db: Session = Depends(get_db),
):
    """Create or update an employee's social insurance coverage and insured base."""
    service = SocialInsuranceService(db)
    actor_email = current_user.get("email") or current_user.get("sub") or "system"
    row = service.set_insurance(
        employee_id=emp_id,
        insured_flag=payload.insured_flag,
        insured_base=payload.insured_base,
        effective_start_date=payload.effective_start_date,
        notes=payload.notes or "",
        user_email=actor_email,
    )
    return row
