"""
be/core/permissions.py
Role-Based Access Control (RBAC) permission resolution and FastAPI route guards.
Enforces permissions formatted as <module>.<resource>.<action>.
"""
from dataclasses import dataclass
from typing import Set, List, Optional, Union
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from config import Config
from db import get_db
from auth import get_current_user
from models_db import UserDB
from core.rbac_models import PermissionDB, RolePermissionDB, UserRoleDB, RoleDB
from core.permission_catalog import all_keys, closure
from core.role_seed import DEFAULT_ROLES


@dataclass
class AccessContext:
    user_id: int
    email: str
    employee_id: Optional[int]
    permissions: Set[str]
    role_names: List[str]
    portal: str
    is_super_admin: bool = False


def has_admin_surface(permissions: Set[str]) -> bool:
    """
    Returns True if user holds any permission outside self.* and hr.company_document.read.
    """
    for p in permissions:
        if not p.startswith("self.") and p != "hr.company_document.read":
            return True
    return False


def resolve_access(db: Session, session_payload: dict) -> AccessContext:
    """
    Resolves the AccessContext for a given session payload:
    - User lookup by uid claim, else email (case-insensitive).
    - Raises 401 for unknown users, 403 for archived users.
    - Assigned roles resolved from user_roles.
    - Baseline Employee role automatically derived when employee_id is set.
    - Super-Admin gets all_keys() directly (even if role_permissions rows are deleted).
    - Others get closure(union of role permissions).
    - portal = 'admin' if has_admin_surface(perms) else 'employee'.
    """
    uid: Optional[int] = session_payload.get("uid") or session_payload.get("user_id") or session_payload.get("id")
    email: Optional[str] = session_payload.get("email")

    user = None
    if uid is not None:
        try:
            user = db.query(UserDB).filter(UserDB.id == int(uid)).first()
        except (ValueError, TypeError):
            user = None

    if user is None and email:
        user = db.query(UserDB).filter(UserDB.email.ilike(email.strip())).first()

    if user is None:
        # In development/test mode, auto-provision unseeded test users
        if Config.ENVIRONMENT in ("development", "test") and email:
            from models_db import EmployeeDB
            emp = db.query(EmployeeDB).filter(EmployeeDB.email.ilike(email.strip())).first()
            emp_id = session_payload.get("employee_id") or (emp.id if emp else None)
            role_claim = session_payload.get("role", "employee")

            user = UserDB(
                email=email.strip().lower(),
                name=session_payload.get("name") or (emp.name if emp else email.split("@")[0]),
                employee_id=emp_id,
            )
            db.add(user)
            db.flush()
            if role_claim == "admin":
                sa_role = db.query(RoleDB).filter(RoleDB.system_key == "super_admin").first()
                if not sa_role:
                    from core.role_seed import sync_catalog
                    sync_catalog(db)
                    sa_role = db.query(RoleDB).filter(RoleDB.system_key == "super_admin").first()
                if sa_role:
                    db.add(UserRoleDB(user_id=user.id, role_id=sa_role.id))
            db.commit()
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

    if user.archived_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is archived",
        )

    assigned_roles = (
        db.query(RoleDB)
        .join(UserRoleDB, UserRoleDB.role_id == RoleDB.id)
        .filter(UserRoleDB.user_id == user.id)
        .all()
    )
    roles_set = set(assigned_roles)

    # In dev/test, if admin email but no Super-Admin role in user_roles, auto-link
    if getattr(user, "email", "") and getattr(user, "email", "").lower().startswith("admin@") and not any(r.system_key == "super_admin" for r in roles_set):
        if Config.ENVIRONMENT in ("development", "test"):
            sa_role = db.query(RoleDB).filter(RoleDB.system_key == "super_admin").first()
            if not sa_role:
                from core.role_seed import sync_catalog
                sync_catalog(db)
                sa_role = db.query(RoleDB).filter(RoleDB.system_key == "super_admin").first()
            if sa_role:
                db.add(UserRoleDB(user_id=user.id, role_id=sa_role.id))
                db.commit()
                roles_set.add(sa_role)

    if user.employee_id is not None:
        emp_role = db.query(RoleDB).filter(RoleDB.system_key == "employee").first()
        if emp_role:
            roles_set.add(emp_role)

    is_super_admin = any(
        getattr(r, "system_key", None) == "super_admin" or r.name == "Super-Admin"
        for r in roles_set
    )

    if is_super_admin:
        perms = set(all_keys())
    else:
        role_ids = [r.id for r in roles_set]
        raw_perms: Set[str] = set()
        if role_ids:
            rp_keys = (
                db.query(PermissionDB.key)
                .join(RolePermissionDB, RolePermissionDB.permission_id == PermissionDB.id)
                .filter(RolePermissionDB.role_id.in_(role_ids))
                .all()
            )
            raw_perms = {k[0] for k in rp_keys}
        if user.employee_id is not None:
            emp_base = DEFAULT_ROLES.get("employee")
            if emp_base:
                raw_perms.update(emp_base.permissions)
        perms = closure(raw_perms)

    role_names = sorted(list({
        r.name for r in assigned_roles
        if getattr(r, "system_key", None) != "employee" and r.name not in ("Employee", "employee")
    }))

    portal = "admin" if has_admin_surface(perms) else "employee"

    return AccessContext(
        user_id=user.id,
        email=user.email,
        employee_id=user.employee_id,
        permissions=perms,
        role_names=role_names,
        portal=portal,
        is_super_admin=is_super_admin,
    )


def get_user_permissions(user_id: int, db: Session) -> Set[str]:
    """
    Resolves the set of permission keys held by a user through all their assigned roles
    and baseline Employee role.
    """
    user = db.query(UserDB).filter(UserDB.id == user_id).first()
    if not user:
        return set()
    ctx = resolve_access(db, {"uid": user.id, "email": user.email})
    return ctx.permissions


def get_access_context(
    request: Request,
    db: Session = Depends(get_db),
) -> AccessContext:
    """
    Resolves or retrieves the AccessContext for the current request.
    Caches on request.state.access_context.
    """
    if hasattr(request.state, "access_context") and request.state.access_context:
        return request.state.access_context

    from auth import get_current_user
    current_user = get_current_user(request, db=db)
    if hasattr(request.state, "access_context") and request.state.access_context:
        return request.state.access_context

    ctx = resolve_access(db, current_user)
    request.state.access_context = ctx
    return ctx


def get_current_user_permissions(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Set[str]:
    """
    Resolves permissions for the authenticated request user.
    Cached on request.state to ensure at most one resolution per HTTP request.
    """
    if hasattr(request.state, "access_context") and request.state.access_context:
        return request.state.access_context.permissions
    ctx: Optional[AccessContext] = None
    if current_user and ("permissions" in current_user or "email" in current_user):
        try:
            ctx = resolve_access(db, current_user)
            request.state.access_context = ctx
        except Exception:
            pass
    if ctx:
        return ctx.permissions
    return set(current_user.get("permissions", []))


def require_permission(permission_key: str):
    """
    FastAPI dependency factory to gate routes by RBAC permission key.
    Asserts at import time that permission_key is in the catalog.
    Raises 403 Forbidden if the authenticated user lacks the required permission.
    Returns the current_user dict on success.
    """
    catalog_keys = all_keys()
    assert permission_key in catalog_keys, f"Unknown permission key in require_permission: '{permission_key}'"

    def _dependency(
        request: Request,
        current_user: dict = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> dict:
        perms = get_current_user_permissions(request, current_user=current_user, db=db)
        if permission_key not in perms:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: '{permission_key}' required",
            )
        return current_user

    _dependency.hrflow_permission = permission_key
    return _dependency
