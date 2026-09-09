"""
be/core/rbac_seed.py
Idempotent seeding helper for RBAC roles, permissions, and initial user assignments.
Can be invoked by Alembic migrations, test setup, or startup scripts.
"""
from typing import Dict, List
from sqlalchemy.orm import Session
from sqlalchemy import select

from core.rbac_models import PermissionDB, RoleDB, RolePermissionDB, UserRoleDB
from models_db import UserDB

# Starter permissions as specified in docs/finance-module/01-implementation-plan.md
SEED_PERMISSIONS: List[Dict[str, str]] = [
    # System
    {"key": "system.users.manage", "description": "Manage user accounts and identity"},
    {"key": "system.roles.manage", "description": "Manage RBAC roles and permissions"},
    # HR Domain
    {"key": "hr.employee.read", "description": "View company employee profiles"},
    {"key": "hr.employee.write", "description": "Create, edit, and delete employee records"},
    {"key": "hr.salary.read", "description": "View employee salaries and raise history"},
    {"key": "hr.salary.write", "description": "Update employee salaries and record compensation changes"},
    {"key": "hr.vacation.read", "description": "View company vacation requests and balances"},
    {"key": "hr.vacation.write", "description": "Manage and approve vacation requests"},
    # Self-Service
    {"key": "self.profile.read", "description": "View own employee profile"},
    {"key": "self.payslip.read", "description": "View own salary payment documents and payslips"},
    {"key": "self.requests.write", "description": "Submit vacation, medical, and general requests"},
    # Finance Domain (Pre-seeded for Phase 2/3/4)
    {"key": "finance.customer.read", "description": "View customers"},
    {"key": "finance.customer.write", "description": "Create, update, and manage customers"},
    {"key": "finance.vendor.read", "description": "View vendors"},
    {"key": "finance.vendor.write", "description": "Create, update, and manage vendors"},
    {"key": "finance.invoice.read", "description": "View sales invoices"},
    {"key": "finance.invoice.write", "description": "Create, update, and void sales invoices"},
    {"key": "finance.bill.read", "description": "View vendor bills"},
    {"key": "finance.bill.write", "description": "Create, update, and void vendor bills"},
    {"key": "finance.payroll.read", "description": "View company payroll runs and history"},
    {"key": "finance.payroll.write", "description": "Create and manage company payroll runs"},
    {"key": "finance.account.read", "description": "View company bank accounts"},
    {"key": "finance.account.write", "description": "Manage company bank accounts and balances"},
    {"key": "finance.subscription.read", "description": "View vendor subscriptions"},
    {"key": "finance.subscription.write", "description": "Create and manage vendor subscriptions"},
    {"key": "finance.report.read", "description": "View finance summary reports and metrics"},
]

SEED_ROLES: List[Dict[str, str]] = [
    {
        "name": "system_admin",
        "description": "Full system and domain administrative access",
    },
    {
        "name": "employee",
        "description": "Standard self-service employee access",
    },
]

EMPLOYEE_PERMISSIONS = {
    "self.profile.read",
    "self.payslip.read",
    "self.requests.write",
}


def seed_rbac(db: Session) -> Dict[str, int]:
    """
    Idempotently seeds permissions, roles, role-permission links, and
    backfills user-role links for existing users.
    Returns counts of created entities.
    """
    stats = {
        "permissions_created": 0,
        "roles_created": 0,
        "role_permissions_created": 0,
        "user_roles_created": 0,
    }

    # 1. Seed Permissions
    existing_perms = {p.key: p for p in db.query(PermissionDB).all()}
    for perm_def in SEED_PERMISSIONS:
        key = perm_def["key"]
        if key not in existing_perms:
            p = PermissionDB(key=key, description=perm_def.get("description", ""))
            db.add(p)
            db.flush()
            existing_perms[key] = p
            stats["permissions_created"] += 1

    # 2. Seed Roles
    existing_roles = {r.name: r for r in db.query(RoleDB).all()}
    for role_def in SEED_ROLES:
        name = role_def["name"]
        if name not in existing_roles:
            r = RoleDB(name=name, description=role_def.get("description", ""))
            db.add(r)
            db.flush()
            existing_roles[name] = r
            stats["roles_created"] += 1

    admin_role = existing_roles["system_admin"]
    employee_role = existing_roles["employee"]

    # 3. Seed Role-Permissions
    existing_rp = {
        (rp.role_id, rp.permission_id) for rp in db.query(RolePermissionDB).all()
    }

    # system_admin receives ALL seeded permissions
    for p in existing_perms.values():
        pair = (admin_role.id, p.id)
        if pair not in existing_rp:
            db.add(RolePermissionDB(role_id=admin_role.id, permission_id=p.id))
            existing_rp.add(pair)
            stats["role_permissions_created"] += 1

    # employee receives self.* permissions
    for key in EMPLOYEE_PERMISSIONS:
        p = existing_perms.get(key)
        if p:
            pair = (employee_role.id, p.id)
            if pair not in existing_rp:
                db.add(RolePermissionDB(role_id=employee_role.id, permission_id=p.id))
                existing_rp.add(pair)
                stats["role_permissions_created"] += 1

    db.flush()

    # 4. Backfill existing Users
    existing_ur = {
        (ur.user_id, ur.role_id) for ur in db.query(UserRoleDB).all()
    }
    users = db.query(UserDB).all()
    for u in users:
        target_role = admin_role if str(u.role).lower() == "admin" else employee_role
        pair = (u.id, target_role.id)
        if pair not in existing_ur:
            db.add(UserRoleDB(user_id=u.id, role_id=target_role.id))
            existing_ur.add(pair)
            stats["user_roles_created"] += 1

    db.commit()
    return stats
