"""
be/core/permissions.py
Role-Based Access Control (RBAC) permission resolution and FastAPI route guards.
Enforces permissions formatted as <module>.<resource>.<action>.
"""
from typing import Set, Optional
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from db import get_db
from auth import get_current_user
from models_db import UserDB
from core.rbac_models import PermissionDB, RolePermissionDB, UserRoleDB


def get_user_permissions(user_id: int, db: Session) -> Set[str]:
    """
    Resolves the set of permission keys held by a user through all their assigned roles:
    UserRole -> Role -> RolePermission -> Permission.
    """
    results = (
        db.query(PermissionDB.key)
        .join(RolePermissionDB, RolePermissionDB.permission_id == PermissionDB.id)
        .join(UserRoleDB, UserRoleDB.role_id == RolePermissionDB.role_id)
        .filter(UserRoleDB.user_id == user_id)
        .all()
    )
    return {r[0] for r in results}


def get_current_user_permissions(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Set[str]:
    """
    Resolves permissions for the authenticated request user.
    Cached on request.state to ensure at most one DB resolution per HTTP request.
    """
    if hasattr(request.state, "user_permissions"):
        return request.state.user_permissions

    user_id: Optional[int] = current_user.get("user_id") or current_user.get("id")
    email: Optional[str] = current_user.get("email")

    if user_id is None and email:
        user_record = (
            db.query(UserDB)
            .filter(UserDB.email.ilike(email.strip()))
            .first()
        )
        if user_record:
            user_id = user_record.id

    perms: Set[str] = set()
    if user_id is not None:
        perms = get_user_permissions(user_id, db)

    # Backward compatibility / fallback:
    # If the user has legacy 'admin' role and user_roles hasn't been populated (e.g. mock test),
    # grant administrative wildcard.
    if not perms and current_user.get("role") == "admin":
        perms = {"*"}

    request.state.user_permissions = perms
    return perms


def require_permission(permission_key: str):
    """
    FastAPI dependency factory to gate routes by RBAC permission key.
    Raises 403 Forbidden if the authenticated user lacks the required permission.
    Returns the current_user dict on success.
    """
    def _dependency(
        request: Request,
        current_user: dict = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> dict:
        perms = get_current_user_permissions(request, current_user=current_user, db=db)
        if "*" not in perms and permission_key not in perms:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: '{permission_key}' required",
            )
        return current_user

    return _dependency
