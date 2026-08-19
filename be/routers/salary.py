"""
routers/salary.py
Salary history and raise application. Moved from main.py during the
router-decomposition refactor - pure structural move, no behavior change.
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
    """
    Non-admins are always restricted to their own salary history - see
    docs/analysis/security-analysis-plan.md, Phase 1 (finding #9).
    """
    client = sheets_client.get_client()
    history = client.get_all_records("SalaryHistory")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        history = [h for h in history if str(h["employee_id"]) == my_id]
    elif employee_id is not None:
        history = [h for h in history if str(h["employee_id"]) == str(employee_id)]
    return history


def _apply_mode(current: float, mode: str, value: float) -> float:
    if mode == "pct":
        return round(current * (1 + value / 100), 2)
    if mode == "amount":
        return round(current + value, 2)
    return round(value, 2)  # mode == "new"


@router.post("/raise", status_code=201)
def apply_raise(payload: RaiseApply, current_user: dict = Depends(require_admin)):
    """
    Applies a raise to one or both of an employee's salary components
    (internal_salary_usd / external_salary_usd) - see docs/analysis/
    salary-advanced-plan.md, "RaiseApply model changes" and "Raise
    computation rule". Key behavioral rules:

    - `target` selects which component(s) are affected: "internal",
      "external", or "both" (default).
    - For target in ("internal", "external"), or target=="both" with
      mode in ("pct", "amount"), `value` is required and
      internal_value/external_value must be omitted.
    - For target=="both" with mode=="new", internal_value AND
      external_value are both required explicitly (0 is valid); `value`
      must be omitted. The new total is always derived as
      internal_value + external_value - never supplied directly.
    - The reported pct_change is always computed against the combined
      total (current_internal + current_external), never a single
      component in isolation, even when only one component changed.
    - `effective_date` may be backdated to create a historical salary
      record for a previous year; in that case the employee's current
      salary/next_raise on the Employees sheet are left untouched (only a
      SalaryHistory row is added), so a backdated entry never clobbers a
      more recent real salary.
    """
    client = sheets_client.get_client()
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(payload.employee_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    current_internal = float(emp.get("internal_salary_usd") or 0)
    current_external = float(emp.get("external_salary_usd") or 0)
    current_total = current_internal + current_external

    if payload.target in ("internal", "external"):
        if payload.value is None:
            raise HTTPException(status_code=400, detail="`value` is required when target is 'internal' or 'external'")
        if payload.internal_value is not None or payload.external_value is not None:
            raise HTTPException(status_code=400, detail="internal_value/external_value must be omitted when target is 'internal' or 'external'")
    elif payload.mode in ("pct", "amount"):
        if payload.value is None:
            raise HTTPException(status_code=400, detail="`value` is required when target is 'both' and mode is 'pct' or 'amount'")
        if payload.internal_value is not None or payload.external_value is not None:
            raise HTTPException(status_code=400, detail="internal_value/external_value must be omitted when target is 'both' and mode is 'pct' or 'amount'")
    else:  # target == "both" and mode == "new"
        if payload.internal_value is None or payload.external_value is None:
            raise HTTPException(status_code=400, detail="internal_value and external_value are both required when target is 'both' and mode is 'new'")
        if payload.value is not None:
            raise HTTPException(status_code=400, detail="`value` must be omitted when target is 'both' and mode is 'new'")

    if payload.target == "both" and payload.mode == "new":
        new_internal = round(payload.internal_value, 2)
        new_external = round(payload.external_value, 2)
    elif payload.target == "both":
        new_internal = _apply_mode(current_internal, payload.mode, payload.value)
        new_external = _apply_mode(current_external, payload.mode, payload.value)
    elif payload.target == "internal":
        new_internal = _apply_mode(current_internal, payload.mode, payload.value)
        new_external = current_external
    else:  # target == "external"
        new_internal = current_internal
        new_external = _apply_mode(current_external, payload.mode, payload.value)

    new_total = new_internal + new_external

    if new_total <= 0 or new_internal < 0 or new_external < 0:
        raise HTTPException(status_code=400, detail="Resulting salary must be positive")

    pct_change = round((new_total - current_total) / current_total * 100, 2) if current_total > 0 else 0.0
    effective_date = payload.effective_date or datetime.utcnow().strftime("%Y-%m-%d")

    history_id = client.next_id("SalaryHistory")
    client.append_row("SalaryHistory", {
        "id": history_id, "employee_id": emp["id"], "date": effective_date,
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
            "salary": new_total,
            "next_raise": next_raise_date,
        })

    audit_log(
        client, "salary.raise", current_user.get("email"), "employee", emp["id"],
        f"target={payload.target}, internal: {current_internal} -> {new_internal}, "
        f"external: {current_external} -> {new_external}, total: {current_total} -> {new_total} "
        f"({pct_change:+.2f}%), reason={payload.reason}",
    )

    return {
        "message": "Raise applied",
        "previous_salary": current_total,
        "new_salary": new_total,
        "pct_change": pct_change,
        "previous_internal_salary_usd": current_internal,
        "new_internal_salary_usd": new_internal,
        "previous_external_salary_usd": current_external,
        "new_external_salary_usd": new_external,
    }
