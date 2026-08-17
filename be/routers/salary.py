"""
routers/salary.py
Salary history and raise application. Moved from main.py during the
router-decomposition refactor - pure structural move, no behavior change.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

import sheets_client
from auth import require_admin
from deps import audit_log, resolve_employee_scope
from models import RaiseApply

router = APIRouter(prefix="/api/salary", tags=["Salary"])


@router.get("/history")
def get_salary_history(scoped_employee_id: Optional[int] = Depends(resolve_employee_scope)):
    """
    Employee ownership is resolved by resolve_employee_scope before this
    route executes. Admins can access all history or filter by employee_id;
    non-admins are structurally forced to their own employee_id.
    """
    client = sheets_client.get_client()
    history = client.get_all_records("SalaryHistory")
    if scoped_employee_id is not None:
        history = [h for h in history if str(h["employee_id"]) == str(scoped_employee_id)]
    return history


@router.post("/raise", status_code=201)
def apply_raise(payload: RaiseApply, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(payload.employee_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    current_salary = float(emp["salary"])
    if payload.mode == "pct":
        new_salary = round(current_salary * (1 + payload.value / 100), 2)
    elif payload.mode == "amount":
        new_salary = round(current_salary + payload.value, 2)
    else:
        new_salary = round(payload.value, 2)

    if new_salary <= 0:
        raise HTTPException(status_code=400, detail="Resulting salary must be positive")

    pct_change = round((new_salary - current_salary) / current_salary * 100, 2)
    effective_date = payload.effective_date or datetime.utcnow().strftime("%Y-%m-%d")

    history_id = client.next_id("SalaryHistory")
    client.append_row("SalaryHistory", {
        "id": history_id, "employee_id": emp["id"], "date": effective_date,
        "previous_salary": current_salary, "new_salary": new_salary,
        "pct_change": f"{'+' if pct_change >= 0 else ''}{pct_change}%",
        "reason": payload.reason, "applied_by": current_user["email"],
    })

    is_backdated = False
    try:
        is_backdated = datetime.strptime(effective_date, "%Y-%m-%d") < (datetime.utcnow() - timedelta(days=1))
    except ValueError:
        pass

    if not is_backdated:
        next_raise_date = (datetime.strptime(effective_date, "%Y-%m-%d") + timedelta(days=365)).strftime("%Y-%m-%d")
        client.update_row_by_match("Employees", "id", emp["id"], {
            "salary": new_salary,
            "next_raise": next_raise_date,
        })

    audit_log(client, "salary.raise", current_user.get("email"), "employee", emp["id"], f"{current_salary} -> {new_salary} ({pct_change:+.2f}%), reason={payload.reason}")

    return {"message": "Raise applied", "previous_salary": current_salary, "new_salary": new_salary, "pct_change": pct_change}
