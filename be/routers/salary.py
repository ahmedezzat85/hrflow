"""
routers/salary.py
Salary history and raise application. Salary is modeled as two USD
components - internal (transferred inside Egypt) and external
(transferred directly from the USA). Raises set both components to
their new absolute values directly; the increase amount and percentage
(over the combined total) are always derived automatically. See
docs/analysis/salary-advanced-plan.md (Phase 1, revised) for the full
design.
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
    """
    Sets an employee's internal and external USD salary components to
    their new absolute values. The increase amount and pct_change are
    always computed automatically from the difference against the
    combined current total - never supplied directly by the caller.
    """
    client = sheets_client.get_client()
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(payload.employee_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    current_internal = float(emp.get("internal_salary_usd") or 0)
    current_external = float(emp.get("external_salary_usd") or 0)
    current_total = current_internal + current_external

    new_internal = round(payload.new_internal_usd, 2)
    new_external = round(payload.new_external_usd, 2)
    new_total = new_internal + new_external

    if new_total <= 0 or new_internal < 0 or new_external < 0:
        raise HTTPException(status_code=400, detail="Resulting salary must be positive")

    pct_change = round((new_total - current_total) / current_total * 100, 2) if current_total > 0 else 0.0
    effective_date = payload.effective_date or datetime.utcnow().strftime("%Y-%m-%d")

    history_id = client.next_id("SalaryHistory")
    client.append_row("SalaryHistory", {
        "id": history_id, "employee_id": emp["id"], "date": effective_date,
        "previous_internal_usd": current_internal, "previous_external_usd": current_external,
        "new_internal_usd": new_internal, "new_external_usd": new_external,
        "previous_salary": current_total, "new_salary": new_total,
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
            "internal_salary_usd": new_internal,
            "external_salary_usd": new_external,
            "next_raise": next_raise_date,
        })

    audit_log(
        client, "salary.raise", current_user.get("email"), "employee", emp["id"],
        f"internal: {current_internal} -> {new_internal}, external: {current_external} -> {new_external}, "
        f"total: {current_total} -> {new_total} ({pct_change:+.2f}%), reason={payload.reason}"
    )

    return {
        "message": "Raise applied",
        "previous_internal_usd": current_internal, "previous_external_usd": current_external,
        "new_internal_usd": new_internal, "new_external_usd": new_external,
        "previous_salary": current_total, "new_salary": new_total,
        "pct_change": pct_change,
    }
