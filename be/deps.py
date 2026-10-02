"""
deps.py
Shared FastAPI dependencies and small cross-router helpers, pulled out of
main.py during the router-decomposition refactor (docs/analysis/
architecture-review-plan.md).
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request

from logging_config import get_logger
from auth import get_current_user

logger = get_logger("main")


@dataclass
class Scope:
    is_all: bool
    employee_id: Optional[int] = None

    @classmethod
    def all(cls) -> "Scope":
        return cls(is_all=True, employee_id=None)

    @classmethod
    def own(cls, emp_id: int) -> "Scope":
        return cls(is_all=False, employee_id=emp_id)


def permission_scope(all_key: str, self_key: str):
    """
    FastAPI dependency factory for own-or-all scope resolution.
    Asserts at import time that all_key and self_key exist in the permission catalog.
    Returns Scope.all() if caller holds all_key, Scope.own(emp_id) if caller holds self_key,
    or raises 403 Forbidden.
    """
    from core.permission_catalog import all_keys
    catalog_keys = all_keys()
    assert all_key in catalog_keys, f"Unknown permission key in permission_scope: '{all_key}'"
    assert self_key in catalog_keys, f"Unknown permission key in permission_scope: '{self_key}'"

    def dep(
        request: Request,
        current_user: dict = Depends(get_current_user),
    ) -> Scope:
        ctx = getattr(request.state, "access_context", None)
        if ctx is not None:
            perms = ctx.permissions
            emp_id = ctx.employee_id
        else:
            perms = set(current_user.get("permissions", []))
            if not perms and current_user.get("role") == "admin":
                perms = set(catalog_keys)
            emp_id = current_user.get("employee_id")

        if all_key in perms:
            return Scope.all()
        if self_key in perms and emp_id is not None:
            return Scope.own(emp_id)
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: requires '{all_key}' or '{self_key}'",
        )

    dep.hrflow_permission_all = all_key
    dep.hrflow_permission_self = self_key
    return dep



def current_user_employee_scope(
    request: Request,
    current_user: dict = Depends(get_current_user),
) -> Optional[int]:
    """
    Resolves an employee-data list scope for endpoints without an
    employee_id query parameter. Admins or users with elevated HR read permissions
    receive None, meaning unrestricted access; employees receive their own employee_id.
    """
    ctx = getattr(request.state, "access_context", None)
    if ctx is not None:
        perms = ctx.permissions
        emp_id = ctx.employee_id
    else:
        perms = set(current_user.get("permissions", []))
        emp_id = current_user.get("employee_id")

    if current_user.get("role") == "admin" or "hr.employee.read" in perms:
        return None
    return emp_id


def resolve_employee_scope(
    request: Request,
    employee_id: Optional[int] = Query(None),
    current_user: dict = Depends(get_current_user),
) -> Optional[int]:
    """
    Resolves the employee-data scope for history/aggregation endpoints
    with an optional employee_id query parameter. Admins or users with elevated HR read
    permissions may request all records (None) or a specific employee. Non-admins without
    elevated read are always forced to their own employee_id, ignoring any supplied query parameter.
    """
    ctx = getattr(request.state, "access_context", None)
    if ctx is not None:
        perms = ctx.permissions
        emp_id = ctx.employee_id
    else:
        perms = set(current_user.get("permissions", []))
        emp_id = current_user.get("employee_id")

    hr_reads = {"hr.salary.read", "hr.vacation.read", "hr.insurance.read", "hr.employee.read", "hr.request.read"}
    if current_user.get("role") == "admin" or bool(perms & hr_reads):
        return employee_id
    return emp_id


def resolve_target_employee(
    repo_or_client,
    current_user: dict,
    employee_id: Optional[int],
    fallback_name: str,
    required_permission: Optional[str] = None,
):
    """
    Shared helper for admin-on-behalf-of-employee creation across
    requests/vacations/claims. Returns (emp_id, employee_name, submitted_by_admin).
    Submitting on behalf of another employee requires the corresponding hr.*.write
    permission (or legacy admin). Non-admins attempting to submit on behalf of
    another employee without permission receive 403.
    """
    if employee_id is not None:
        is_self = str(employee_id) == str(current_user.get("employee_id"))
        if not is_self:
            perms = set(current_user.get("permissions", []))
            has_permission = False
            if required_permission:
                has_permission = required_permission in perms
            else:
                has_permission = any(p in perms for p in ("hr.request.write", "hr.vacation.write", "hr.insurance.write"))

            if not has_permission and current_user.get("role") != "admin":
                logger.warning(
                    "User %s attempted to submit on behalf of employee_id=%s without required permission (%s)",
                    current_user.get("email"),
                    employee_id,
                    required_permission,
                )
                raise HTTPException(
                    status_code=403,
                    detail="Only HR admins can submit this on behalf of another employee",
                )

        if hasattr(repo_or_client, "get_by_id"):
            target = repo_or_client.get_by_id(employee_id)
        elif hasattr(repo_or_client, "get_all_records"):
            employees = repo_or_client.get_all_records("Employees")
            target = next((e for e in employees if str(e["id"]) == str(employee_id)), None)
        else:
            target = None

        if not target:
            logger.warning("Tried to act on behalf of unknown employee_id=%s", employee_id)
            raise HTTPException(status_code=404, detail="Employee not found")
        return target["id"], target["name"], (not is_self)
    return current_user.get("employee_id"), fallback_name, False


def audit_log(repo_or_client, action: str, actor_email: str, target_type: str, target_id, details: str = ""):
    """
    Appends an immutable record for sensitive mutations.
    Best-effort: a failure here is logged but never blocks the actual operation.
    """
    if hasattr(repo_or_client, "log"):
        repo_or_client.log(action, actor_email, target_type, target_id, details)
        return

    try:
        entry_id = repo_or_client.next_id("AuditLog")
        repo_or_client.append_row("AuditLog", {
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
