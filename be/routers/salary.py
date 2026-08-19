"""
salary.py
Salary & Raises router: salary history + applying raises, with support
for the Internal/External USD component split (see docs/analysis/
salary-advanced-plan.md and docs/analysis/salary-raise-redesign-plan.md).
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import sheets_client
from auth import get_current_user, require_admin
from deps import audit_log
from models import RaiseApply

router = APIRouter(prefix="/api/salary", tags=["Salary"])


@router.get("/history")
def get_salary_history(employee_id: Optional[int] = Query(None), current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    history = client.get_all_records("SalaryHistory")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        history = [h for h in history if str(h["employee_id"]) == my_id]
    elif employee_id is not None:
        history = [h for h in history if str(h["employee_id"]) == str(employee_id)]
    return history


@router.post("/raise", status_code=201)
def apply_raise(payload: RaiseApply, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(payload.employee_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    current_internal = float(emp.get("internal_salary_usd") or 0)
    current_external = float(emp.get("external_salary_usd") or 0)
    current_total = current_internal + current_external

    new_internal = round(payload.new_internal_salary_usd, 2)
    new_external = round(payload.new_external_salary_usd, 2)
    new_total = round(new_internal + new_external, 2)

    if new_internal < 0 or new_external < 0 or new_total <= 0:
        raise HTTPException(status_code=400, detail="Resulting salary must be non-negative and total must be positive")

    internal_delta_amount = round(new_internal - current_internal, 2)
    internal_delta_pct = round(internal_delta_amount / current_internal * 100, 2) if current_internal > 0 else 0.0
    external_delta_amount = round(new_external - current_external, 2)
    external_delta_pct = round(external_delta_amount / current_external * 100, 2) if current_external > 0 else 0.0
    total_delta_amount = round(new_total - current_total, 2)
    total_delta_pct = round(total_delta_amount / current_total * 100, 2) if current_total > 0 else 0.0

    effective_date = payload.effective_date or datetime.utcnow().strftime("%Y-%m-%d")

    history_id = client.next_id("SalaryHistory")
    client.append_row("SalaryHistory", {
        "id": history_id, "employee_id": emp["id"], "date": effective_date,
        "previous_salary": current_total, "new_salary": new_total,
        "pct_change": f"{'+' if total_delta_pct >= 0 else ''}{total_delta_pct}%",
        "reason": payload.reason, "applied_by": current_user["email"],
        "previous_internal_usd": current_internal, "previous_external_usd": current_external,
        "new_internal_usd": new_internal, "new_external_usd": new_external,
    })

    is_backdated = payload.effective_date is not None and effective_date < datetime.utcnow().strftime("%Y-%m-%d")
    if not is_backdated:
        next_raise_date = (datetime.strptime(effective_date, "%Y-%m-%d") + timedelta(days=365)).strftime("%Y-%m-%d")
        client.update_row_by_match("Employees", "id", emp["id"], {
            "internal_salary_usd": new_internal,
            "external_salary_usd": new_external,
            "salary": new_total,
            "next_raise": next_raise_date,
        })

    audit_log(
        client, "salary.raise", current_user.get("email"), "employee", emp["id"],
        f"internal: {current_internal} -> {new_internal} ({internal_delta_pct:+.2f}%), "
        f"external: {current_external} -> {new_external} ({external_delta_pct:+.2f}%), "
        f"total: {current_total} -> {new_total} ({total_delta_pct:+.2f}%), reason={payload.reason}",
    )

    return {
        "message": "Raise applied",
        "previous_salary": current_total,
        "new_salary": new_total,
        "pct_change": total_delta_pct,
        "previous_internal_salary_usd": current_internal,
        "new_internal_salary_usd": new_internal,
        "previous_external_salary_usd": current_external,
        "new_external_salary_usd": new_external,
        "internal_delta_amount": internal_delta_amount,
        "internal_delta_pct": internal_delta_pct,
        "external_delta_amount": external_delta_amount,
        "external_delta_pct": external_delta_pct,
        "total_delta_amount": total_delta_amount,
        "total_delta_pct": total_delta_pct,
    }
