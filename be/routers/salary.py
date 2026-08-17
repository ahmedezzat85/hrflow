"""
routers/salary.py
Salary history and raise application. Salary is modeled as two USD
components - internal (transferred inside Egypt) and external
(transferred directly from the USA) - see
docs/analysis/salary-advanced-plan.md (Phase 1) for the full design.
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


def _apply_mode(current: float, mode: str, value: float) -> float:
    """Applies a single raise mode to one salary component."""
    if mode == "pct":
        return round(current * (1 + value / 100), 2)
    if mode == "amount":
        return round(current + value, 2)
    return round(value, 2)  # mode == "new"


def _validate_raise_payload(payload: RaiseApply):
    """
    Enforces the field-usage rules documented on RaiseApply (see
    models.py docstring and docs/analysis/salary-advanced-plan.md):

      - target in ("internal", "external"): `value` required,
        internal_value/external_value forbidden.
      - target == "both", mode in ("pct", "amount"): `value` required,
        internal_value/external_value forbidden.
      - target == "both", mode == "new": internal_value AND
        external_value both required, `value` forbidden.

    These constraints are conditional on multiple fields at once, so they
    are enforced here rather than at the pydantic model level.
    """
    if payload.target in ("internal", "external"):
        if payload.value is None:
            raise HTTPException(status_code=400, detail="`value` is required when target is 'internal' or 'external'")
        if payload.internal_value is not None or payload.external_value is not None:
            raise HTTPException(status_code=400, detail="internal_value/external_value must not be set when target is 'internal' or 'external' - use `value`")
        return

    # target == "both"
    if payload.mode == "new":
        if payload.internal_value is None or payload.external_value is None:
            raise HTTPException(status_code=400, detail="Both internal_value and external_value are required when target='both' and mode='new' (0 is a valid value, but both must be supplied explicitly)")
        if payload.value is not None:
            raise HTTPException(status_code=400, detail="`value` must not be set when target='both' and mode='new' - use internal_value/external_value instead; the total is always derived")
    else:
        if payload.value is None:
            raise HTTPException(status_code=400, detail="`value` is required when target='both' and mode is 'pct' or 'amount'")
        if payload.internal_value is not None or payload.external_value is not None:
            raise HTTPException(status_code=400, detail="internal_value/external_value must not be set when mode is 'pct' or 'amount' - use `value`")


@router.post("/raise", status_code=201)
def apply_raise(payload: RaiseApply, current_user: dict = Depends(require_admin)):
    """
    Applies a raise to an employee's internal and/or external USD salary
    component(s). The reported/stored pct_change is always computed
    against the COMBINED total of both components, regardless of which
    component(s) were actually changed - see
    docs/analysis/salary-advanced-plan.md, "Raise computation rule".
    """
    _validate_raise_payload(payload)

    client = sheets_client.get_client()
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(payload.employee_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    current_internal = float(emp.get("internal_salary_usd") or 0)
    current_external = float(emp.get("external_salary_usd") or 0)
    current_total = current_internal + current_external

    if payload.target == "both" and payload.mode == "new":
        # Explicit per-component absolute values required (validated
        # above). Total is always derived, never a direct input.
        new_internal = round(payload.internal_value, 2)
        new_external = round(payload.external_value, 2)
    elif payload.target == "both":
        # mode in ("pct", "amount"): same `value` applied independently
        # to each component (e.g. pct=10 -> both components individually +10%).
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
        "previous_internal_usd": current_internal, "previous_external_usd": current_external,
        "new_internal_usd": new_internal, "new_external_usd": new_external,
        # Legacy combined-total columns, kept for any not-yet-migrated
        # frontend/report code - see docs/analysis/salary-advanced-plan.md.
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
        f"total: {current_total} -> {new_total} ({pct_change:+.2f}%), target={payload.target}, reason={payload.reason}"
    )

    return {
        "message": "Raise applied",
        "previous_internal_usd": current_internal, "previous_external_usd": current_external,
        "new_internal_usd": new_internal, "new_external_usd": new_external,
        "previous_salary": current_total, "new_salary": new_total,
        "pct_change": pct_change,
    }
