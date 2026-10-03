"""
be/routers/access.py
FastAPI router for RBAC management: catalog, roles, and user access (Spec §10).
Guards:
- Catalog and Roles endpoints: system.roles.manage
- Users endpoints: system.users.manage
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Path, status, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from db import get_db
from core.permissions import require_permission
from core.access_service import AccessService
from repositories.deps import get_audit_repo
from repositories.interfaces import AuditRepository


router = APIRouter(prefix="/api/access", tags=["Access Control & RBAC"])


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------

class CatalogPermissionItem(BaseModel):
    key: str
    description: Optional[str] = None
    implies: List[str] = []
    assignable: bool = True


class CatalogGroupResponse(BaseModel):
    group: str
    permissions: List[CatalogPermissionItem]


class RoleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    system_key: Optional[str] = None
    is_locked: bool
    permissions: List[str]
    user_count: int
    implied_added: Optional[List[str]] = None


class RoleCreateRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    permissions: List[str] = []


class RoleUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[List[str]] = None


class RoleSummary(BaseModel):
    id: int
    name: str
    system_key: Optional[str] = None


class UserAccessRowResponse(BaseModel):
    id: int
    email: str
    name: Optional[str] = None
    employee_id: Optional[int] = None
    employee_name: Optional[str] = None
    is_external: bool
    role: Optional[RoleSummary] = None
    archived_at: Optional[str] = None
    is_self: bool = False


class UserCreateExternalRequest(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    role_id: int


class UserRoleUpdateRequest(BaseModel):
    # None clears the assigned role; allowed only for a user with a linked employee.
    role_id: Optional[int] = None


# -----------------------------------------------------------------------------
# Dependencies
# -----------------------------------------------------------------------------

def get_access_service(
    db: Session = Depends(get_db),
    audit_repo: AuditRepository = Depends(get_audit_repo),
) -> AccessService:
    return AccessService(db, audit_repo=audit_repo)


# -----------------------------------------------------------------------------
# Catalog Endpoints
# -----------------------------------------------------------------------------

@router.get("/catalog", response_model=List[CatalogGroupResponse])
def get_catalog(
    service: AccessService = Depends(get_access_service),
    current_user: dict = Depends(require_permission("system.roles.manage")),
):
    """Catalog grouped by group: key, description, implies, assignable."""
    return service.get_catalog_grouped()


# -----------------------------------------------------------------------------
# Roles Endpoints
# -----------------------------------------------------------------------------

@router.get("/roles", response_model=List[RoleResponse])
def list_roles(
    service: AccessService = Depends(get_access_service),
    current_user: dict = Depends(require_permission("system.roles.manage")),
):
    """Roles with id, name, description, system_key, is_locked, permission keys, user_count."""
    return service.list_roles()


@router.post("/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
def create_role(
    payload: RoleCreateRequest,
    service: AccessService = Depends(get_access_service),
    current_user: dict = Depends(require_permission("system.roles.manage")),
):
    """Creates a custom role. Implication closure is applied; implied_added keys are returned."""
    actor_email = current_user.get("email") or "system"
    return service.create_role(
        name=payload.name,
        description=payload.description,
        permissions=payload.permissions,
        actor_email=actor_email,
    )


@router.put("/roles/{role_id}", response_model=RoleResponse)
def update_role(
    role_id: int = Path(..., description="Role ID to update"),
    payload: RoleUpdateRequest = ...,
    service: AccessService = Depends(get_access_service),
    current_user: dict = Depends(require_permission("system.roles.manage")),
):
    """Updates a custom role. Rejected for locked roles (R6)."""
    actor_email = current_user.get("email") or "system"
    return service.update_role(
        role_id=role_id,
        name=payload.name,
        description=payload.description,
        permissions=payload.permissions,
        actor_email=actor_email,
    )


@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int = Path(..., description="Role ID to delete"),
    service: AccessService = Depends(get_access_service),
    current_user: dict = Depends(require_permission("system.roles.manage")),
):
    """Deletes a custom role. Rejected for locked roles (R6) or assigned roles (R7)."""
    actor_email = current_user.get("email") or "system"
    service.delete_role(role_id=role_id, actor_email=actor_email)
    return {"message": "Role deleted"}


# -----------------------------------------------------------------------------
# Users Endpoints
# -----------------------------------------------------------------------------

@router.get("/users", response_model=List[UserAccessRowResponse])
def list_users(
    search: Optional[str] = Query(None, description="Search by email, name, or employee name"),
    filter: Optional[str] = Query("all", description="Filter by: all, employees, external, archived"),
    service: AccessService = Depends(get_access_service),
    current_user: dict = Depends(require_permission("system.users.manage")),
):
    """Lists users with search and filter: all, employees, external, archived."""
    return service.list_users(search=search, filter_type=filter or "all", actor_user=current_user)


@router.post("/users", response_model=UserAccessRowResponse, status_code=status.HTTP_201_CREATED)
def create_external_user(
    payload: UserCreateExternalRequest,
    service: AccessService = Depends(get_access_service),
    current_user: dict = Depends(require_permission("system.users.manage")),
):
    """Creates an external user without linked employee. Requires exactly one role (R3)."""
    actor_email = current_user.get("email") or "system"
    return service.create_external_user(
        email=payload.email,
        name=payload.name or "",
        role_id=payload.role_id,
        actor_email=actor_email,
    )


@router.put("/users/{user_id}/role", response_model=UserAccessRowResponse)
def set_user_role(
    user_id: int = Path(..., description="User ID"),
    payload: UserRoleUpdateRequest = ...,
    service: AccessService = Depends(get_access_service),
    current_user: dict = Depends(require_permission("system.users.manage")),
):
    """Sets the user's single assigned role (rules R1, R2, R3, R9, R11). The Employee baseline is derived, never assigned."""
    return service.set_user_role(
        user_id=user_id,
        role_id=payload.role_id,
        actor_user=current_user,
    )


@router.post("/users/{user_id}/archive")
def archive_user(
    user_id: int = Path(..., description="User ID to archive"),
    service: AccessService = Depends(get_access_service),
    current_user: dict = Depends(require_permission("system.users.manage")),
):
    """Archives a user (rules R1, R2, R10). Roles remain on record; access refused."""
    return service.archive_user(user_id=user_id, actor_user=current_user)


get_catalog.hrflow_permission_all = "system.roles.manage"
list_roles.hrflow_permission_all = "system.roles.manage"
create_role.hrflow_permission_all = "system.roles.manage"
update_role.hrflow_permission_all = "system.roles.manage"
delete_role.hrflow_permission_all = "system.roles.manage"
list_users.hrflow_permission_all = "system.users.manage"
create_external_user.hrflow_permission_all = "system.users.manage"
set_user_role.hrflow_permission_all = "system.users.manage"
archive_user.hrflow_permission_all = "system.users.manage"
