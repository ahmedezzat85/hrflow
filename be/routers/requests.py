"""
routers/requests.py
General request endpoints (currently used for Work From Home). Moved
from main.py during the router-decomposition refactor - pure structural
move, no behavior change.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user, require_admin
from deps import resolve_target_employee, audit_log, current_user_employee_scope
from models import RequestCreate, RequestAction
from repositories.interfaces import RequestRepository, EmployeeRepository, AuditRepository
from repositories.deps import get_request_repo, get_employee_repo, get_audit_repo

router = APIRouter(prefix="/api/requests", tags=["Requests"])


@router.get("")
def get_requests(
    type: Optional[str] = Query(None),
    scoped_employee_id: Optional[int] = Depends(current_user_employee_scope),
    request_repo: RequestRepository = Depends(get_request_repo),
):
    return request_repo.list_requests(type_filter=type, scoped_employee_id=scoped_employee_id)


@router.post("", status_code=201)
def create_request(
    payload: RequestCreate,
    current_user: dict = Depends(get_current_user),
    request_repo: RequestRepository = Depends(get_request_repo),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    emp_id, employee_name, submitted_by_admin = resolve_target_employee(
        employee_repo, current_user, payload.employee_id, payload.employee_name
    )

    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    row = {
        "employee_id": emp_id,
        "employee_name": employee_name,
        "type": payload.type,
        "details": payload.details,
        "date": record_date,
        "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    }
    new_id = request_repo.create(row)
    return {"message": "Request submitted", "id": new_id}


@router.post("/{req_id}/action")
def action_request(
    req_id: int,
    payload: RequestAction,
    current_user: dict = Depends(require_admin),
    request_repo: RequestRepository = Depends(get_request_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    ok = request_repo.action_request(
        req_id=req_id,
        status=payload.status,
        reviewer_email=current_user["email"],
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Request not found")

    audit_log(audit_repo, "request.action", current_user.get("email"), "request", req_id, f"status={payload.status}")
    return {"message": f"Request {payload.status.lower()}"}