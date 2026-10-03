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
    {"key": "finance.vendor_payment.reveal", "description": "Reveal sensitive vendor payment and bank instructions"},
    {"key": "finance.vendor_payment.manage", "description": "Add and update sensitive vendor payment details"},
    {"key": "finance.vendor_payment.verify", "description": "Verify and approve vendor payment instructions"},
    {"key": "finance.invoice.read", "description": "View sales invoices"},
    {"key": "finance.invoice.write", "description": "Create, update, and void sales invoices"},
    {"key": "finance.bill.read", "description": "View vendor bills"},
    {"key": "finance.bill.write", "description": "Create, update, and void vendor bills"},
    {"key": "finance.payroll.read", "description": "View company payroll runs and history"},
    {"key": "finance.payroll.prepare", "description": "Prepare draft payroll runs, adjustments, lines, and submit for approval"},
    {"key": "finance.payroll.approve", "description": "Approve and finalize submitted payroll runs"},
    {"key": "finance.payroll.pay", "description": "Execute disbursements and post general ledger transactions for payroll runs"},
    {"key": "finance.account.read", "description": "View company bank accounts"},
    {"key": "finance.account.write", "description": "Manage company bank accounts and balances"},
    {"key": "finance.bank_account.reveal", "description": "Reveal unmasked company bank account identifiers"},
    {"key": "finance.adjustment.manage", "description": "Authorize and record manual balance adjustments and journal corrections"},
    {"key": "finance.subscription.read", "description": "View vendor subscriptions"},
    {"key": "finance.subscription.write", "description": "Create and manage vendor subscriptions"},
    {"key": "finance.report.read", "description": "View finance summary reports and metrics"},
    {"key": "finance.statutory.read", "description": "View statutory obligations and payments"},
    {"key": "finance.statutory.write", "description": "Create and manage statutory obligations and payments"},
    {"key": "finance.payroll_tax.read", "description": "View payroll income tax settings"},
    {"key": "finance.payroll_tax.write", "description": "Create and update payroll income tax settings"},
    {"key": "finance.settings.write", "description": "Manage finance settings, feature flags, and rollout controls"},
]

SEED_ROLES: List[Dict[str, str]] = [
    {
        "name": "Super-Admin",
        "description": "Full system and domain administrative access",
    },
    {
        "name": "Employee",
        "description": "Standard self-service employee access",
    },
]

EMPLOYEE_PERMISSIONS = {
    "self.profile.read",
    "self.payslip.read",
    "self.requests.write",
}


def seed_rbac(db: Session) -> Dict[str, int]:
    """Delegates to canonical sync_catalog."""
    from core.role_seed import sync_catalog
    return sync_catalog(db)

