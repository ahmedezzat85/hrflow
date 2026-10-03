"""
be/core/access_service.py
Access service enforcing RBAC lifecycle rules R1-R13 (Spec §9-§10, §14).
All operations are executed within one database transaction per action.
Errors raise HTTPException with specified status codes and clear details.
"""
import re
from datetime import datetime
from typing import Dict, List, Optional, Set, Any, Tuple
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from core.permission_catalog import (
    CATALOG,
    CATALOG_BY_KEY,
    closure,
    all_keys,
)
from core.rbac_models import RoleDB, PermissionDB, RolePermissionDB, UserRoleDB
from models_db import UserDB, EmployeeDB
from deps import audit_log


RESERVED_ROLE_NAMES = {
    "super-admin",
    "hr-admin",
    "financial-admin",
    "payroll-maker",
    "employee",
    "system_admin",
}

def _assigned_role(user: UserDB) -> Optional[RoleDB]:
    """
    Returns the user's single assigned role (D-011 amendment: one assigned role per user).
    The derived Employee baseline is never an assigned role. If legacy data still holds
    more than one row, Super-Admin wins, then the lowest role id.
    """
    roles = [ur.role for ur in (user.user_roles or []) if ur.role is not None and ur.role.system_key != "employee"]
    if not roles:
        return None
    roles.sort(key=lambda r: (0 if r.system_key == "super_admin" else 1, r.id))
    return roles[0]


def _role_summary(role: Optional[RoleDB]) -> Optional[Dict[str, Any]]:
    if role is None:
        return None
    return {"id": role.id, "name": role.name, "system_key": role.system_key}


class AccessService:
    def __init__(self, db: Session, audit_repo=None):
        self.db = db
        self.audit_repo = audit_repo

    # -------------------------------------------------------------------------
    # Catalog
    # -------------------------------------------------------------------------
    def get_catalog_grouped(self) -> List[Dict[str, Any]]:
        """Returns catalog definitions grouped by category."""
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for p in CATALOG:
            if p.group not in grouped:
                grouped[p.group] = []
            grouped[p.group].append({
                "key": p.key,
                "description": p.description,
                "implies": list(p.implies),
                "assignable": p.assignable,
            })
        return [{"group": group, "permissions": perms} for group, perms in grouped.items()]

    # -------------------------------------------------------------------------
    # Roles
    # -------------------------------------------------------------------------
    def list_roles(self) -> List[Dict[str, Any]]:
        """Returns all roles with user counts and permission key closures."""
        roles = self.db.query(RoleDB).order_by(RoleDB.id).all()
        result = []
        for r in roles:
            # User count
            user_count = (
                self.db.query(func.count(UserRoleDB.user_id))
                .filter(UserRoleDB.role_id == r.id)
                .scalar() or 0
            )
            perm_keys = [p.key for p in r.permissions]
            result.append({
                "id": r.id,
                "name": r.name,
                "description": r.description or "",
                "system_key": r.system_key,
                "is_locked": r.is_locked,
                "permissions": sorted(perm_keys),
                "user_count": user_count,
            })
        return result

    def get_role_by_id(self, role_id: int) -> RoleDB:
        role = self.db.query(RoleDB).filter(RoleDB.id == role_id).first()
        if not role:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Role #{role_id} not found")
        return role

    def create_role(self, name: str, description: Optional[str], permissions: List[str], actor_email: str) -> Dict[str, Any]:
        """
        Creates a custom role enforcing R8 and R13.
        R13: Name unique, 1-100 chars, not reserved.
        R8: Normalize to closure, reject unknown/non-assignable keys, return implied_added.
        """
        clean_name = (name or "").strip()
        if not (1 <= len(clean_name) <= 100):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Role name must be between 1 and 100 characters.")

        if clean_name.lower() in RESERVED_ROLE_NAMES:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Role name '{clean_name}' is reserved.")

        existing = self.db.query(RoleDB).filter(func.lower(RoleDB.name) == clean_name.lower()).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"A role with name '{clean_name}' already exists.")

        # R8: Validate keys
        requested_set = set(permissions or [])
        unknown_keys = [k for k in requested_set if k not in CATALOG_BY_KEY]
        if unknown_keys:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid permission keys: unknown {unknown_keys}")

        non_assignable = [k for k in requested_set if not CATALOG_BY_KEY[k].assignable]
        if non_assignable:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid permission keys: non-assignable {non_assignable}")

        full_closure = closure(requested_set)
        implied_added = sorted(list(full_closure - requested_set))

        # Insert Role
        role = RoleDB(
            name=clean_name,
            description=description or "",
            system_key=None,
            is_locked=False,
            created_at=datetime.utcnow(),
        )
        self.db.add(role)
        self.db.flush()

        # Link permissions
        all_perms = {p.key: p for p in self.db.query(PermissionDB).all()}
        for k in full_closure:
            p_obj = all_perms.get(k)
            if not p_obj:
                p_obj = PermissionDB(key=k, description=CATALOG_BY_KEY[k].description)
                self.db.add(p_obj)
                self.db.flush()
                all_perms[k] = p_obj
            self.db.add(RolePermissionDB(role_id=role.id, permission_id=p_obj.id))

        self.db.commit()
        self.db.refresh(role)

        if self.audit_repo:
            audit_log(
                self.audit_repo,
                "role.create",
                actor_email,
                "role",
                role.id,
                f"name={role.name}, perms_count={len(full_closure)}, implied_added={len(implied_added)}",
            )

        return {
            "id": role.id,
            "name": role.name,
            "description": role.description,
            "system_key": role.system_key,
            "is_locked": role.is_locked,
            "permissions": sorted(list(full_closure)),
            "user_count": 0,
            "implied_added": implied_added,
        }

    def update_role(self, role_id: int, name: Optional[str], description: Optional[str], permissions: Optional[List[str]], actor_email: str) -> Dict[str, Any]:
        """
        Updates a custom role enforcing R6, R8, R13.
        """
        role = self.get_role_by_id(role_id)

        # R6: Locked roles cannot be edited or renamed
        if role.is_locked:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot edit or delete locked role '{role.name}'.")

        # R13: Name check
        if name is not None:
            clean_name = name.strip()
            if not (1 <= len(clean_name) <= 100):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Role name must be between 1 and 100 characters.")
            if clean_name.lower() in RESERVED_ROLE_NAMES and clean_name.lower() != (role.name or "").lower():
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Role name '{clean_name}' is reserved.")
            conflict = (
                self.db.query(RoleDB)
                .filter(func.lower(RoleDB.name) == clean_name.lower(), RoleDB.id != role.id)
                .first()
            )
            if conflict:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"A role with name '{clean_name}' already exists.")
            role.name = clean_name

        if description is not None:
            role.description = description

        implied_added = []
        if permissions is not None:
            # R8: Validate keys
            requested_set = set(permissions)
            unknown_keys = [k for k in requested_set if k not in CATALOG_BY_KEY]
            if unknown_keys:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid permission keys: unknown {unknown_keys}")

            non_assignable = [k for k in requested_set if not CATALOG_BY_KEY[k].assignable]
            if non_assignable:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid permission keys: non-assignable {non_assignable}")

            full_closure = closure(requested_set)
            implied_added = sorted(list(full_closure - requested_set))

            # Delete existing role permissions
            self.db.query(RolePermissionDB).filter(RolePermissionDB.role_id == role.id).delete()
            self.db.flush()

            # Insert updated role permissions
            all_perms = {p.key: p for p in self.db.query(PermissionDB).all()}
            for k in full_closure:
                p_obj = all_perms.get(k)
                if not p_obj:
                    p_obj = PermissionDB(key=k, description=CATALOG_BY_KEY[k].description)
                    self.db.add(p_obj)
                    self.db.flush()
                    all_perms[k] = p_obj
                self.db.add(RolePermissionDB(role_id=role.id, permission_id=p_obj.id))

        self.db.commit()
        self.db.refresh(role)

        user_count = self.db.query(func.count(UserRoleDB.user_id)).filter(UserRoleDB.role_id == role.id).scalar() or 0
        final_perms = [p.key for p in role.permissions]

        if self.audit_repo:
            audit_log(
                self.audit_repo,
                "role.update",
                actor_email,
                "role",
                role.id,
                f"name={role.name}, perms_count={len(final_perms)}, implied_added={len(implied_added)}",
            )

        return {
            "id": role.id,
            "name": role.name,
            "description": role.description,
            "system_key": role.system_key,
            "is_locked": role.is_locked,
            "permissions": sorted(final_perms),
            "user_count": user_count,
            "implied_added": implied_added,
        }

    def delete_role(self, role_id: int, actor_email: str) -> bool:
        """
        Deletes a role enforcing R6 and R7.
        R6: Locked role cannot be deleted.
        R7: Role assigned to any user cannot be deleted.
        """
        role = self.get_role_by_id(role_id)

        # R6: Locked check
        if role.is_locked:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot edit or delete locked role '{role.name}'.")

        # R7: Assigned check
        assigned_count = self.db.query(UserRoleDB).filter(UserRoleDB.role_id == role.id).count()
        if assigned_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot delete role '{role.name}' while it is assigned to {assigned_count} user(s).",
            )

        role_name = role.name
        self.db.query(RolePermissionDB).filter(RolePermissionDB.role_id == role.id).delete()
        self.db.delete(role)
        self.db.commit()

        if self.audit_repo:
            audit_log(
                self.audit_repo,
                "role.delete",
                actor_email,
                "role",
                role_id,
                f"name={role_name}",
            )
        return True

    # -------------------------------------------------------------------------
    # Users
    # -------------------------------------------------------------------------
    def list_users(self, search: Optional[str] = None, filter_type: str = "all") -> List[Dict[str, Any]]:
        """
        Lists users with search and filter.
        Filters: all | employees | external | archived
        Row: id, email, name, employee_id, employee_name, is_external, role (single assigned role or null; Employee baseline never listed), archived_at.
        """
        query = self.db.query(UserDB)

        clean_filter = (filter_type or "all").lower().strip()
        if clean_filter == "employees":
            query = query.filter(UserDB.employee_id.isnot(None), UserDB.archived_at.is_(None))
        elif clean_filter == "external":
            query = query.filter(UserDB.employee_id.is_(None), UserDB.archived_at.is_(None))
        elif clean_filter == "archived":
            query = query.filter(UserDB.archived_at.isnot(None))

        if search:
            s = f"%{search.strip().lower()}%"
            query = query.outerjoin(EmployeeDB, UserDB.employee_id == EmployeeDB.id).filter(
                or_(
                    func.lower(UserDB.email).like(s),
                    func.lower(UserDB.name).like(s),
                    func.lower(EmployeeDB.name).like(s),
                )
            )

        users = query.order_by(UserDB.id).all()
        result = []
        for u in users:
            emp_name = u.employee.name if u.employee else None
            is_external = (u.employee_id is None)

            # One assigned role per user; the Employee baseline is derived and never listed
            result.append({
                "id": u.id,
                "email": u.email,
                "name": emp_name or u.name or (u.email.split("@")[0].title() if u.email else ""),
                "employee_id": u.employee_id,
                "employee_name": emp_name,
                "is_external": is_external,
                "role": _role_summary(_assigned_role(u)),
                "archived_at": u.archived_at.isoformat() if u.archived_at else None,
            })
        return result

    def get_user_by_id(self, user_id: int) -> UserDB:
        user = self.db.query(UserDB).filter(UserDB.id == user_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User #{user_id} not found")
        return user

    def _get_assignable_role(self, role_id: int) -> RoleDB:
        """Loads a role that may be assigned to a user. The Employee role is derived, never assigned."""
        role = self.db.query(RoleDB).filter(RoleDB.id == role_id).first()
        if not role:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The specified role ID is invalid.")
        if role.system_key == "employee":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The Employee role is derived from the linked employee record and cannot be assigned.",
            )
        return role

    def create_external_user(self, email: str, name: str, role_id: Optional[int], actor_email: str) -> Dict[str, Any]:
        """
        Creates an external user without linked employee.
        Requires exactly one role (R3). Rejects duplicate email.
        """
        clean_email = (email or "").strip().lower()
        if not clean_email or "@" not in clean_email:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Valid email address is required.")

        clean_name = (name or "").strip()
        if not clean_name:
            clean_name = clean_email.split("@")[0].title()

        if role_id is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="External users must be given a role.")

        existing = self.db.query(UserDB).filter(func.lower(UserDB.email) == clean_email).first()
        if existing:
            if existing.archived_at:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists and is archived.")
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists.")

        role = self._get_assignable_role(role_id)

        user = UserDB(
            email=clean_email,
            name=clean_name,
            employee_id=None,
            created_at=datetime.utcnow(),
        )
        self.db.add(user)
        self.db.flush()

        self.db.add(UserRoleDB(user_id=user.id, role_id=role.id))

        self.db.commit()
        self.db.refresh(user)

        if self.audit_repo:
            audit_log(
                self.audit_repo,
                "user.create_external",
                actor_email,
                "user",
                user.id,
                f"email={user.email}, role={role.name}",
            )

        return {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "employee_id": None,
            "employee_name": None,
            "is_external": True,
            "role": _role_summary(role),
            "archived_at": None,
        }

    def _get_active_super_admin_user_ids(self) -> Set[int]:
        rows = (
            self.db.query(UserRoleDB.user_id)
            .join(RoleDB, UserRoleDB.role_id == RoleDB.id)
            .join(UserDB, UserRoleDB.user_id == UserDB.id)
            .filter(RoleDB.system_key == "super_admin")
            .filter(UserDB.archived_at.is_(None))
            .all()
        )
        return {r[0] for r in rows}

    def set_user_role(self, user_id: int, role_id: Optional[int], actor_user: dict) -> Dict[str, Any]:
        """
        Sets the user's single assigned role, enforcing R1, R2, R3, R9, R11.
        role_id=None clears the assigned role and is allowed only for a user with a linked
        employee (who keeps the derived Employee baseline).
        """
        user = self.get_user_by_id(user_id)
        actor_email = (actor_user.get("email") or "").strip().lower()
        actor_uid = actor_user.get("uid") or actor_user.get("id")

        # R1: Actor cannot revoke or modify their own user's access
        if (actor_uid is not None and user.id == actor_uid) or (user.email.strip().lower() == actor_email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An actor cannot delete, archive, or revoke the access of their own user.",
            )

        # R11: Archived user cannot have roles changed
        if user.archived_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot modify roles for an archived user.",
            )

        # R3: External user without employee must always have a role
        if user.employee_id is None and role_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user without a linked employee must always have a role. Archive the user instead.",
            )

        new_role = self._get_assignable_role(role_id) if role_id is not None else None

        # R2: Last active Super-Admin cannot be revoked
        active_sa_ids = self._get_active_super_admin_user_ids()
        if user.id in active_sa_ids:
            will_have_sa = new_role is not None and new_role.system_key == "super_admin"
            if not will_have_sa and len(active_sa_ids) <= 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot revoke the last active Super-Admin.",
                )

        # Replace every existing row (including any legacy Employee row) with the single role
        self.db.query(UserRoleDB).filter(UserRoleDB.user_id == user.id).delete()
        self.db.flush()

        if new_role is not None:
            self.db.add(UserRoleDB(user_id=user.id, role_id=new_role.id))

        self.db.commit()
        self.db.refresh(user)

        if self.audit_repo:
            audit_log(
                self.audit_repo,
                "user.roles_update",
                actor_email,
                "user",
                user.id,
                f"role={new_role.name if new_role else None}",
            )

        emp_name = user.employee.name if user.employee else None
        return {
            "id": user.id,
            "email": user.email,
            "name": emp_name or user.name,
            "employee_id": user.employee_id,
            "employee_name": emp_name,
            "is_external": user.employee_id is None,
            "role": _role_summary(new_role),
            "archived_at": None,
        }

    def archive_user(self, user_id: int, actor_user: dict) -> Dict[str, Any]:
        """
        Archives a user enforcing R1, R2, R10.
        R1: Cannot archive own user.
        R2: Cannot archive the last active Super-Admin.
        R10: Sets archived_at and archived_by, preserves roles.
        """
        user = self.get_user_by_id(user_id)
        actor_email = (actor_user.get("email") or "").strip().lower()
        actor_uid = actor_user.get("uid") or actor_user.get("id")

        # R1: Cannot archive self
        if (actor_uid is not None and user.id == actor_uid) or (user.email.strip().lower() == actor_email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An actor cannot delete, archive, or revoke the access of their own user.",
            )

        # R2: Cannot archive last active Super-Admin
        active_sa_ids = self._get_active_super_admin_user_ids()
        if user.id in active_sa_ids and len(active_sa_ids) <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot archive the last active Super-Admin.",
            )

        user.archived_at = datetime.utcnow()
        user.archived_by = actor_email
        self.db.commit()

        if self.audit_repo:
            audit_log(
                self.audit_repo,
                "user.archive",
                actor_email,
                "user",
                user.id,
                f"archived_by={actor_email}",
            )

        return {"message": "User archived", "id": user.id}

    def unarchive_user(self, user_id: int, actor_user: dict) -> Dict[str, Any]:
        """
        Restores an archived user account.
        """
        user = self.get_user_by_id(user_id)
        actor_email = (actor_user.get("email") or "").strip().lower()

        user.archived_at = None
        user.archived_by = None
        self.db.commit()

        if self.audit_repo:
            audit_log(
                self.audit_repo,
                "user.unarchive",
                actor_email,
                "user",
                user.id,
                f"unarchived_by={actor_email}",
            )

        return {"message": "User restored", "id": user.id}

    # -------------------------------------------------------------------------
    # Employee Lifecycle Hooks (R4, R5, R12, R14)
    # -------------------------------------------------------------------------
    def validate_employee_provisioning(self, email: str) -> None:
        """Enforces R12 check before employee creation."""
        clean_email = (email or "").strip().lower()
        existing = self.db.query(UserDB).filter(func.lower(UserDB.email) == clean_email).first()
        if existing and existing.archived_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An archived user already exists with this email.",
            )

    def on_employee_create(self, employee_id: int, email: str, name: str, role: str = "employee") -> UserDB:
        """
        R12: Provisions linked user for new employee.
        If existing non-archived external user exists with email, links it.
        If existing archived user exists, raises 409.
        """
        clean_email = (email or "").strip().lower()
        existing = self.db.query(UserDB).filter(func.lower(UserDB.email) == clean_email).first()
        if existing:
            if existing.archived_at is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An archived user already exists with this email.",
                )
            existing.employee_id = employee_id
            if name and not existing.name:
                existing.name = name
            self.db.commit()
            return existing

        user = UserDB(
            email=clean_email,
            name=name,
            employee_id=employee_id,
            created_at=datetime.utcnow(),
        )
        self.db.add(user)
        self.db.commit()
        return user

    def on_employee_delete(self, employee_id: int, actor_user: dict) -> None:
        """
        Enforces R1, R2, R4, R5 when deleting an employee.
        R1: Actor cannot delete own user.
        R2: Cannot delete last active Super-Admin.
        R4: Deleting employee is rejected if linked user holds any assigned role other than baseline.
        R5: Deleting baseline-only employee deletes linked user in the same transaction.
        """
        user = self.db.query(UserDB).filter(UserDB.employee_id == employee_id).first()
        if not user:
            return

        actor_email = (actor_user.get("email") or "").strip().lower()
        actor_uid = actor_user.get("uid") or actor_user.get("id")

        # R1: Cannot delete self
        if (actor_uid is not None and user.id == actor_uid) or (user.email.strip().lower() == actor_email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An actor cannot delete, archive, or revoke the access of their own user.",
            )

        # R2: Cannot delete last active Super-Admin
        active_sa_ids = self._get_active_super_admin_user_ids()
        if user.id in active_sa_ids and len(active_sa_ids) <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete the last active Super-Admin.",
            )

        # R4: Reject if linked user holds any assigned role other than the baseline.
        # Filtered in Python: custom roles have system_key NULL, and SQL "!= 'employee'" drops NULL rows.
        elevated_roles = [
            r for r in (
                self.db.query(RoleDB)
                .join(UserRoleDB, UserRoleDB.role_id == RoleDB.id)
                .filter(UserRoleDB.user_id == user.id)
                .all()
            )
            if r.system_key != "employee"
        ]
        if elevated_roles:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete employee with assigned roles. Revoke roles on the Users page first.",
            )

        # R5: Baseline-only employee: delete linked user in same transaction
        self.db.delete(user)
        self.db.commit()

    def on_employee_email_update(self, employee_id: int, new_email: str) -> None:
        """
        R14 check/fix: Keeps users.email in sync when employee email changes.
        """
        clean_email = (new_email or "").strip().lower()
        user = self.db.query(UserDB).filter(UserDB.employee_id == employee_id).first()
        if user and user.email != clean_email:
            user.email = clean_email
            self.db.commit()
