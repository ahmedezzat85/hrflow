"""
be/core/role_seed.py
Seeded RBAC role definitions and catalog synchronization logic.
Provides:
- DEFAULT_ROLES: Role definitions mapped by system_key
- sync_catalog(db): Idempotent synchronization of catalog permissions and Super-Admin grants
"""
import logging
from dataclasses import dataclass
from typing import Dict, Set, Tuple
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from core.permission_catalog import CATALOG, all_keys, closure
from core.rbac_models import PermissionDB, RoleDB, RolePermissionDB

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RoleSeedDef:
    system_key: str
    name: str
    description: str
    is_locked: bool
    base_keys: Tuple[str, ...]

    @property
    def permissions(self) -> Set[str]:
        return closure(self.base_keys)


DEFAULT_ROLES: Dict[str, RoleSeedDef] = {
    "super_admin": RoleSeedDef(
        system_key="super_admin",
        name="Super-Admin",
        description="Full system and domain administrative access",
        is_locked=True,
        base_keys=tuple(sorted(all_keys())),
    ),
    "hr_admin": RoleSeedDef(
        system_key="hr_admin",
        name="HR-Admin",
        description="Full HR administrative access",
        is_locked=False,
        base_keys=(
            "hr.employee.write",
            "hr.salary.write",
            "hr.employee_bank_account.write",
            "hr.employee_bank_account.reveal",
            "hr.employee_document.write",
            "hr.company_document.write",
            "hr.salary_payment_doc.write",
            "hr.vacation.write",
            "hr.request.write",
            "hr.insurance.write",
            "hr.export.run",
        ),
    ),
    "financial_admin": RoleSeedDef(
        system_key="financial_admin",
        name="Financial-Admin",
        description="Full finance administration, approval, and disbursement",
        is_locked=False,
        base_keys=(
            "finance.customer.write",
            "finance.invoice.write",
            "finance.vendor.write",
            "finance.vendor_payment.manage",
            "finance.vendor_payment.verify",
            "finance.vendor_payment.reveal",
            "finance.bill.write",
            "finance.subscription.write",
            "finance.statutory.write",
            "finance.account.write",
            "finance.bank_account.reveal",
            "finance.adjustment.manage",
            "finance.report.read",
            "finance.settings.write",
            "finance.payroll.approve",
            "finance.payroll.pay",
            "finance.payroll_tax.write",
        ),
    ),
    "payroll_maker": RoleSeedDef(
        system_key="payroll_maker",
        name="Payroll-Maker",
        description="Payroll preparation and adjustment",
        is_locked=False,
        base_keys=(
            "finance.payroll.prepare",
        ),
    ),
    "employee": RoleSeedDef(
        system_key="employee",
        name="Employee",
        description="Standard self-service employee access",
        is_locked=False,
        base_keys=(
            "self.profile.read",
            "self.payslip.read",
            "self.requests.write",
            "self.salary.read",
            "self.vacation.write",
            "self.claim.write",
            "self.bank_account.read",
            "self.document.write",
            "hr.company_document.read",
        ),
    ),
}


def sync_catalog(db: Session) -> Dict[str, int]:
    """
    Idempotent catalog synchronization:
    1. Inserts missing permission rows and updates descriptions.
    2. Synchronizes Super-Admin's role_permissions rows to the full catalog.
    3. Never deletes permissions or modifies grants on editable roles.
    4. Safe for multi-worker startups (catches concurrent unique constraint conflicts).
    """
    stats = {
        "permissions_created": 0,
        "permissions_updated": 0,
        "super_admin_grants_created": 0,
    }

    try:
        # 1. Sync permissions table with CATALOG
        existing_perms = {p.key: p for p in db.query(PermissionDB).all()}

        for p_def in CATALOG:
            if p_def.key not in existing_perms:
                try:
                    p = PermissionDB(key=p_def.key, description=p_def.description)
                    db.add(p)
                    db.flush()
                    existing_perms[p_def.key] = p
                    stats["permissions_created"] += 1
                except IntegrityError:
                    db.rollback()
                    # Re-query if concurrent worker inserted it
                    p = db.query(PermissionDB).filter(PermissionDB.key == p_def.key).first()
                    if p:
                        existing_perms[p_def.key] = p
            else:
                p = existing_perms[p_def.key]
                if p.description != p_def.description:
                    p.description = p_def.description
                    db.flush()
                    stats["permissions_updated"] += 1

        # 2. Locate Super-Admin role
        super_admin_role = (
            db.query(RoleDB)
            .filter(RoleDB.system_key == "super_admin")
            .first()
        )
        if not super_admin_role:
            super_admin_role = (
                db.query(RoleDB)
                .filter(RoleDB.name.in_(["Super-Admin", "system_admin"]))
                .first()
            )

        # If Super-Admin role does not exist (e.g. pre-migration / raw test harness), create it
        if not super_admin_role:
            try:
                super_admin_role = RoleDB(
                    name="Super-Admin",
                    system_key="super_admin",
                    description="Full system and domain administrative access",
                    is_locked=True,
                )
                db.add(super_admin_role)
                db.flush()
            except IntegrityError:
                db.rollback()
                super_admin_role = (
                    db.query(RoleDB)
                    .filter(RoleDB.system_key == "super_admin")
                    .first()
                ) or db.query(RoleDB).filter(RoleDB.name.in_(["Super-Admin", "system_admin"])).first()

        if not super_admin_role:
            raise RuntimeError("Unable to locate or initialize Super-Admin role during sync_catalog")

        # Ensure Super-Admin has system_key set
        if not super_admin_role.system_key:
            super_admin_role.system_key = "super_admin"
            super_admin_role.is_locked = True
            db.flush()

        # 3. Sync Super-Admin's role_permissions rows to include all catalog keys
        existing_rp_ids = {
            rp.permission_id
            for rp in db.query(RolePermissionDB).filter(RolePermissionDB.role_id == super_admin_role.id).all()
        }

        for perm in existing_perms.values():
            if perm.id not in existing_rp_ids:
                try:
                    rp = RolePermissionDB(role_id=super_admin_role.id, permission_id=perm.id)
                    db.add(rp)
                    db.flush()
                    existing_rp_ids.add(perm.id)
                    stats["super_admin_grants_created"] += 1
                except IntegrityError:
                    db.rollback()
                    # Concurrent worker inserted it

        db.commit()
        return stats

    except Exception as e:
        db.rollback()
        logger.error(f"Catalog sync failed with error: {e}", exc_info=True)
        raise
