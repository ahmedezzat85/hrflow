"""
routers/requests.py
General request endpoints (currently used for Work From Home). Moved
from main.py during the router-decomposition refactor - pure structural
move, no behavior change.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import sheets_client
from auth import get_current_user, require_admin
from deps import resolve_target_employee, audit_log, current_user_employee_scope
from models import RequestCreate, RequestAction

router = APIRouter(prefix="/api/requests", tags=["Requests"])


@router.get("")
def get_requests(
    type: Optional[str] = Query(None),
    scoped_employee_id: Optional[int] = Depends(current_user_employee_scope),
):
    client = sheets_client.get_client()
    reqs = client.get_all_records("Requests")
    if scoped_employee_id is not None:
        reqs = [r for r in reqs if str(r["employee_id"]) == str(scoped_employee_id)]
    if type and type != "all":
        reqs = [r for r in reqs if r["type"] == type]
    return reqs


@router.post("", status_code=201)
def create_request(payload: RequestCreate, current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    emp_id, employee_name, submitted_by_admin = resolve_target_employee(
        client, current_user, payload.employee_id, payload.employee_name
    )

    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    new_id = client.next_id("Requests")
    row = {
        "id": new_id, "employee_id": emp_id, "employee_name": employee_name,
        "type": payload.type, "details": payload.details, "date": record_date,
        "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    }
    client.append_row("Requests", row)
    return {"message": "Request submitted", "id": new_id}


@router.post("/{req_id}/action")
def action_request(req_id: int, payload: RequestAction, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    ok = client.update_row_by_match("Requests", "id", req_id, {
        "status": payload.status, "reviewed_by": current_user["email"],
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
    })
    if not ok:
        raise HTTPException(status_code=404, detail="Request not found")
    audit_log(client, "request.action", current_user.get("email"), "request", req_id, f"status={payload.status}")
    return {"message": f"Request {payload.status.lower()}"}
