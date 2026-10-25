"""
be/routers/tax_method.py
API endpoints for managing an employee's tax method (progressive or flat rate, effective-dated).
"""
from typing import List, Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db import get_db
from models import EmployeeTaxMethodUpsert, EmployeeTaxMethodResponse
from services.tax_method_service import TaxMethodService
from core.permissions import require_permission

router = APIRouter(prefix="/api/employees/{emp_id}/tax-method", tags=["Tax Method"])


@router.get("", response_model=Optional[EmployeeTaxMethodResponse])
def get_employee_tax_method(
    emp_id: int,
    current_user: dict = Depends(require_permission("hr.employee.read")),
    db: Session = Depends(get_db),
):
    """Fetch the active tax method configuration for an employee."""
    return TaxMethodService(db).get_active(emp_id)


@router.get("/history", response_model=List[EmployeeTaxMethodResponse])
def get_employee_tax_method_history(
    emp_id: int,
    current_user: dict = Depends(require_permission("hr.employee.read")),
    db: Session = Depends(get_db),
):
    """Fetch the effective-dated history of tax method records for an employee."""
    return TaxMethodService(db).get_history(emp_id)


@router.put("", response_model=EmployeeTaxMethodResponse)
def set_employee_tax_method(
    emp_id: int,
    payload: EmployeeTaxMethodUpsert,
    current_user: dict = Depends(require_permission("hr.salary.write")),
    db: Session = Depends(get_db),
):
    """Create or update an employee's tax method (progressive or flat rate)."""
    actor_email = current_user.get("email") or current_user.get("sub") or "system"
    return TaxMethodService(db).set_tax_method(
        employee_id=emp_id,
        method=payload.method,
        flat_rate=payload.flat_rate,
        effective_start_date=payload.effective_start_date,
        notes=payload.notes or "",
        user_email=actor_email,
    )
