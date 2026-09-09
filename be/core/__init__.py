"""
be/core
Core system abstractions, RBAC models, and cross-cutting permissions.
"""
from core.rbac_models import PermissionDB, RoleDB, RolePermissionDB, UserRoleDB
from core.permissions import (
    require_permission,
    get_user_permissions,
    get_current_user_permissions,
)

__all__ = [
    "PermissionDB",
    "RoleDB",
    "RolePermissionDB",
    "UserRoleDB",
    "require_permission",
    "get_user_permissions",
    "get_current_user_permissions",
]
