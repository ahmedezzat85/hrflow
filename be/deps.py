"""
deps.py
Shared FastAPI dependencies and small cross-router helpers, pulled out of
main.py during the router-decomposition refactor (docs/analysis/
architecture-review-plan.md).
"""
from datetime import datetime
from typing import Optional

from fastapi import Depends, HTTPException, Query

from logging_config import get_logger
from auth import get_current_user

logger = get_logger("main")


def current_user_employee_scope(current_user: dict = Depends(get_current_user)) -> Optional[int]:
    """
    Resolves an employee-data list scope for endpoints without an
    employee_id query parameter. Admins receive None, meaning unrestricted
    access; employees receive their own employee_id.
    """
    if current_user["role"] == "admin":
        return None
    return current_user["employee_id"]


def resolve_employee_scope(
    employee_id: Optional[int] = Query(None),
    current_user: dict = Depends(get_current_user),
) -> Optional[int]:
    """
    Resolves the employee-data scope for history/aggregation endpoints
    with an optional employee_id query parameter. Admins may request all
    records (None) or a specific employee. Non-admins are always forced
    to their own employee_id, ignoring any supplied query parameter.
    """
    if current_user["role"] != "admin":
        return current_user["employee_id"]
    return employee_id


def resolve_target_employee(client, current_user, employee_id, fallback_name):
    """
    Shared helper for admin-on-behalf-of-employee creation across
    requests/vacations/claims. Returns (emp_id, employee_name, submitted_by_admin).
    Non-admins may never pass employee_id; if they try, this raises 403.
    Admin-provided employee_id is resolved against the real Employees sheet
    so the employee's name is never trusted from client input.
    """
    if employee_id is not None:
        if current_user["role"] != "admin":
            logger.warning("User %s (role=%s) attempted to submit on behalf of employee_id=%s without admin rights", current_user.get("email"), current_user.get("role"), employee_id)
            raise HTTPException(status_code=403, detail="Only HR admins can submit this on behalf of another employee")
        employees = client.get_all_records("Employees")
        target = next((e for e in employees if str(e["id"]) == str(employee_id)), None)
        if not target:
            logger.warning("Admin %s tried to act on behalf of unknown employee_id=%s", current_user.get("email"), employee_id)
            raise HTTPException(status_code=404, detail="Employee not found")
        return target["id"], target["name"], True
    return current_user["employee_id"], fallback_name, False


def audit_log(client, action: str, actor_email: str, target_type: str, target_id, details: str = ""):
    """
    Appends an immutable record to the AuditLog sheet for sensitive
    mutations. Best-effort: a failure here is logged but never blocks the
    actual operation. See docs/analysis/security-analysis-plan.md, Phase 5.
    """
    try:
        entry_id = client.next_id("AuditLog")
        client.append_row("AuditLog", {
            "id": entry_id,
            "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            "actor_email": actor_email,
            "action": action,
            "target_type": target_type,
            "target_id": str(target_id),
            "details": details,
        })
    except Exception:
        logger.exception("Audit log write failed for action=%s, target_type=%s, target_id=%s - operation proceeds regardless", action, target_type, target_id)
