"""
routers/vacations.py
Vacation/leave request endpoints. Moved from main.py during the
router-decomposition refactor - pure structural move, no behavior change.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends

import sheets_client
from auth import get_current_user
from deps import resolve_target_employee, resolve_employee_scope
from models import VacationRequestCreate

router = APIRouter(prefix="/api/vacations", tags=["Vacations"])


@router.get("/history")
def get_vacation_history(scoped_employee_id: Optional[int] = Depends(resolve_employee_scope)):
    """Employee ownership is resolved by resolve_employee_scope before
    this route executes."""
    client = sheets_client.get_client()
    history = client.get_all_records("VacationHistory")
    if scoped_employee_id is not None:
        history = [h for h in history if str(h["employee_id"]) == str(scoped_employee_id)]
    return history


@router.post("/request", status_code=201)
def request_vacation(payload: VacationRequestCreate, current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    emp_id, employee_name, submitted_by_admin = resolve_target_employee(
        client, current_user, payload.employee_id, payload.employee_name
    )

    end_date = payload.end_date or payload.start_date
    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    vac_id = client.next_id("VacationHistory")
    client.append_row("VacationHistory", {
        "id": vac_id, "employee_id": emp_id, "type": payload.leave_type,
        "start_date": payload.start_date, "end_date": end_date, "days": payload.days, "status": status,
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })

    req_id = client.next_id("Requests")
    client.append_row("Requests", {
        "id": req_id, "employee_id": emp_id, "employee_name": employee_name, "type": "Vacation",
        "details": f"{payload.leave_type}: {payload.start_date} to {end_date}",
        "date": record_date, "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })
    return {"message": "Vacation request submitted", "id": vac_id}
