"""
routers/vacations.py
Vacation/leave request endpoints. Moved from main.py during the
router-decomposition refactor - pure structural move, no behavior change.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from core.permissions import require_permission
from deps import resolve_target_employee, permission_scope, Scope
from models import VacationRequestCreate
from repositories.interfaces import VacationRepository, EmployeeRepository
from repositories.deps import get_vacation_repo, get_employee_repo

router = APIRouter(prefix="/api/vacations", tags=["Vacations"])


@router.get("/history")
def get_vacation_history(
    employee_id: Optional[int] = Query(None),
    scope: Scope = Depends(permission_scope("hr.vacation.read", "self.vacation.read")),
    vacation_repo: VacationRepository = Depends(get_vacation_repo),
):
    """Employee ownership is resolved by permission_scope before
    this route executes."""
    scoped_employee_id = employee_id if scope.is_all else scope.employee_id
    return vacation_repo.get_history(scoped_employee_id=scoped_employee_id)

get_vacation_history.hrflow_permission_all = "hr.vacation.read"
get_vacation_history.hrflow_permission_self = "self.vacation.read"


@router.post("/request", status_code=201)
def request_vacation(
    payload: VacationRequestCreate,
    current_user: dict = Depends(get_current_user),
    vacation_repo: VacationRepository = Depends(get_vacation_repo),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    perms = set(current_user.get("permissions", []))
    has_write_all = "hr.vacation.write" in perms or current_user.get("role") == "admin"
    has_write_own = "self.vacation.write" in perms

    if not has_write_all and not has_write_own:
        raise HTTPException(
            status_code=403,
            detail="Permission denied: 'hr.vacation.write' or 'self.vacation.write' required",
        )

    emp_id, employee_name, submitted_by_admin = resolve_target_employee(
        employee_repo, current_user, payload.employee_id, payload.employee_name,
        required_permission="hr.vacation.write"
    )

    end_date = payload.end_date or payload.start_date
    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    vacation_data = {
        "employee_id": emp_id,
        "type": payload.leave_type,
        "start_date": payload.start_date,
        "end_date": end_date,
        "days": payload.days,
        "status": status,
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    }

    request_data = {
        "employee_id": emp_id,
        "employee_name": employee_name,
        "type": "Vacation",
        "details": f"{payload.leave_type}: {payload.start_date} to {end_date}",
        "date": record_date,
        "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    }

    vac_id = vacation_repo.create_vacation_request(vacation_data, request_data)
    return {"message": "Vacation request submitted", "id": vac_id}

request_vacation.hrflow_permission_all = "hr.vacation.write"
request_vacation.hrflow_permission_self = "self.vacation.write"
