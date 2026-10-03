"""0024_rbac_schema_and_roles

Revision ID: 0024_rbac_schema_and_roles
Revises: 0023_payroll_income_tax_settings
Create Date: 2026-10-02 12:00:00.000000

"""
from typing import Sequence, Union
from datetime import datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = '0024_rbac_schema_and_roles'
down_revision: Union[str, None] = '0023_payroll_income_tax_settings'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen catalog definitions for migration 0024
FROZEN_PERMISSIONS = [
    # System / Access
    ("system.users.manage", "Manage user accounts and identity"),
    ("system.roles.manage", "Manage RBAC roles and permissions"),
    # System / Audit
    ("system.audit.read", "View audit log entries"),
    # HR / Employees
    ("hr.employee.read", "View company employee profiles"),
    ("hr.employee.write", "Create, edit, and delete employee records"),
    # HR / Compensation
    ("hr.salary.read", "View employee salaries and raise history"),
    ("hr.salary.write", "Update employee salaries and record compensation changes"),
    # HR / Employee bank details
    ("hr.employee_bank_account.read", "View employee bank account details"),
    ("hr.employee_bank_account.write", "Create and update employee bank account details"),
    ("hr.employee_bank_account.reveal", "Reveal unmasked employee bank account and IBAN identifiers"),
    # HR / Documents
    ("hr.employee_document.read", "View employee documents"),
    ("hr.employee_document.write", "Upload and delete employee documents"),
    ("hr.company_document.read", "View company documents"),
    ("hr.company_document.write", "Upload and manage company documents"),
    # HR / Salary payment documents
    ("hr.salary_payment_doc.read", "View salary payment documents and receipts"),
    ("hr.salary_payment_doc.write", "Upload and manage salary payment documents"),
    # HR / Leave and requests
    ("hr.vacation.read", "View company vacation requests and balances"),
    ("hr.vacation.write", "Manage and approve vacation requests"),
    ("hr.request.read", "View company employee requests"),
    ("hr.request.write", "Manage and approve company employee requests"),
    # HR / Medical insurance
    ("hr.insurance.read", "View medical insurance categories and claims"),
    ("hr.insurance.write", "Manage medical insurance categories and process claims"),
    # HR / Data export
    ("hr.export.run", "Run HR and company data exports"),
    # Self-service
    ("self.profile.read", "View own employee profile"),
    ("self.payslip.read", "View own salary payment documents and payslips"),
    ("self.requests.read", "View own submitted requests"),
    ("self.requests.write", "Submit and manage own requests"),
    ("self.salary.read", "View own salary and compensation details"),
    ("self.vacation.read", "View own vacation balance and history"),
    ("self.vacation.write", "Submit and cancel own vacation requests"),
    ("self.claim.read", "View own medical insurance claims and consumption"),
    ("self.claim.write", "Submit own medical insurance claims"),
    ("self.bank_account.read", "View own masked bank account details"),
    ("self.document.read", "View own employee documents"),
    ("self.document.write", "Upload and manage own employee documents"),
    # Finance / Sales
    ("finance.customer.read", "View customers"),
    ("finance.customer.write", "Create, update, and manage customers"),
    ("finance.invoice.read", "View sales invoices"),
    ("finance.invoice.write", "Create, update, and void sales invoices"),
    # Finance / Spend
    ("finance.vendor.read", "View vendors"),
    ("finance.vendor.write", "Create, update, and manage vendors"),
    ("finance.vendor_payment.manage", "Add and update sensitive vendor payment details"),
    ("finance.vendor_payment.verify", "Verify and approve vendor payment instructions"),
    ("finance.vendor_payment.reveal", "Reveal sensitive vendor payment and bank instructions"),
    ("finance.bill.read", "View vendor bills"),
    ("finance.bill.write", "Create, update, and void vendor bills"),
    ("finance.subscription.read", "View vendor subscriptions"),
    ("finance.subscription.write", "Create and manage vendor subscriptions"),
    ("finance.statutory.read", "View statutory obligations and payments"),
    ("finance.statutory.write", "Create and manage statutory obligations and payments"),
    # Finance / Banking
    ("finance.account.read", "View company bank accounts"),
    ("finance.account.write", "Manage company bank accounts and balances"),
    ("finance.bank_account.reveal", "Reveal unmasked company bank account identifiers"),
    ("finance.adjustment.manage", "Authorize and record manual balance adjustments and journal corrections"),
    # Finance / Reports
    ("finance.report.read", "View finance summary reports and metrics"),
    # Finance / Settings
    ("finance.settings.read", "View finance settings, feature flags, and rollout controls"),
    ("finance.settings.write", "Manage finance settings, feature flags, and rollout controls"),
    # Payroll / Runs
    ("finance.payroll.read", "View company payroll runs and history"),
    ("finance.payroll.prepare", "Prepare, adjust, and submit payroll runs and compensation plans"),
    ("finance.payroll.approve", "Approve and finalize company payroll runs"),
    ("finance.payroll.pay", "Disburse payments and post journal entries for payroll runs"),
    # Payroll / Tax settings
    ("finance.payroll_tax.read", "View payroll income tax settings"),
    ("finance.payroll_tax.write", "Create and update payroll income tax settings"),
    # Transitional deprecated key
    ("finance.payroll.write", "Create and manage company payroll runs (deprecated, split into prepare/approve/pay)"),
]

FROZEN_ROLE_PERMISSIONS = {
    "super_admin": [k for k, _ in FROZEN_PERMISSIONS],
    "hr_admin": [
        "hr.employee.read", "hr.employee.write",
        "hr.salary.read", "hr.salary.write",
        "hr.employee_bank_account.read", "hr.employee_bank_account.write", "hr.employee_bank_account.reveal",
        "hr.employee_document.read", "hr.employee_document.write",
        "hr.company_document.read", "hr.company_document.write",
        "hr.salary_payment_doc.read", "hr.salary_payment_doc.write",
        "hr.vacation.read", "hr.vacation.write",
        "hr.request.read", "hr.request.write",
        "hr.insurance.read", "hr.insurance.write",
        "hr.export.run",
    ],
    "financial_admin": [
        "finance.customer.read", "finance.customer.write",
        "finance.invoice.read", "finance.invoice.write",
        "finance.vendor.read", "finance.vendor.write",
        "finance.vendor_payment.manage", "finance.vendor_payment.verify", "finance.vendor_payment.reveal",
        "finance.bill.read", "finance.bill.write",
        "finance.subscription.read", "finance.subscription.write",
        "finance.statutory.read", "finance.statutory.write",
        "finance.account.read", "finance.account.write",
        "finance.bank_account.reveal", "finance.adjustment.manage",
        "finance.report.read",
        "finance.settings.read", "finance.settings.write",
        "finance.payroll.read", "finance.payroll.approve", "finance.payroll.pay",
        "finance.payroll_tax.read", "finance.payroll_tax.write",
    ],
    "payroll_maker": [
        "finance.payroll.read", "finance.payroll.prepare",
    ],
    "employee": [
        "self.profile.read",
        "self.payslip.read",
        "self.requests.read", "self.requests.write",
        "self.salary.read",
        "self.vacation.read", "self.vacation.write",
        "self.claim.read", "self.claim.write",
        "self.bank_account.read",
        "self.document.read", "self.document.write",
        "hr.company_document.read",
    ],
}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Column additions to roles table
    if 'roles' in tables:
        roles_cols = [col['name'] for col in inspector.get_columns('roles')]
        with op.batch_alter_table('roles') as batch_op:
            if 'system_key' not in roles_cols:
                batch_op.add_column(sa.Column('system_key', sa.String(length=50), nullable=True))
            if 'is_locked' not in roles_cols:
                batch_op.add_column(sa.Column('is_locked', sa.Boolean(), nullable=False, server_default=sa.false()))

    # The unique index is created outside the batch block: inside it, SQLite batch mode
    # silently skipped the index when the table was altered in place.
    if 'roles' in tables:
        role_indexes = [ix['name'] for ix in sa.inspect(bind).get_indexes('roles')]
        if 'ix_roles_system_key' not in role_indexes:
            op.create_index('ix_roles_system_key', 'roles', ['system_key'], unique=True)

    # 2. Column additions to users table
    if 'users' in tables:
        users_cols = [col['name'] for col in inspector.get_columns('users')]
        with op.batch_alter_table('users') as batch_op:
            if 'name' not in users_cols:
                batch_op.add_column(sa.Column('name', sa.String(length=255), nullable=True))
            if 'archived_at' not in users_cols:
                batch_op.add_column(sa.Column('archived_at', sa.DateTime(), nullable=True))
            if 'archived_by' not in users_cols:
                batch_op.add_column(sa.Column('archived_by', sa.String(length=255), nullable=True))

    # 3. Data steps using direct SQL execution
    session = Session(bind=bind)
    try:
        # A. Insert missing permissions
        existing_perms_rows = session.execute(text("SELECT id, key FROM permissions")).fetchall()
        existing_perms = {row[1]: row[0] for row in existing_perms_rows}

        for key, desc in FROZEN_PERMISSIONS:
            if key not in existing_perms:
                session.execute(
                    text("INSERT INTO permissions (key, description, created_at) VALUES (:key, :desc, :now)"),
                    {"key": key, "desc": desc, "now": datetime.utcnow()},
                )
        session.flush()

        # Re-query all permissions
        all_perms_rows = session.execute(text("SELECT id, key FROM permissions")).fetchall()
        perm_map = {row[1]: row[0] for row in all_perms_rows}

        # B. Rename system_admin -> Super-Admin and employee -> Employee, or insert if not present
        existing_roles_rows = session.execute(text("SELECT id, name, system_key FROM roles")).fetchall()
        role_by_name = {row[1]: row[0] for row in existing_roles_rows}
        role_by_key = {row[2]: row[0] for row in existing_roles_rows if row[2]}

        # Rows added by an application start before this migration have is_locked NULL
        session.execute(text("UPDATE roles SET is_locked = :unlocked WHERE is_locked IS NULL"), {"unlocked": False})

        # Rename or setup Super-Admin
        if "super_admin" not in role_by_key:
            if "system_admin" in role_by_name:
                session.execute(
                    text("UPDATE roles SET name = 'Super-Admin', system_key = 'super_admin', is_locked = :locked WHERE name = 'system_admin'"),
                    {"locked": True},
                )
            elif "Super-Admin" in role_by_name:
                session.execute(
                    text("UPDATE roles SET system_key = 'super_admin', is_locked = :locked WHERE name = 'Super-Admin'"),
                    {"locked": True},
                )
            else:
                session.execute(
                    text("INSERT INTO roles (name, system_key, is_locked, description, created_at) "
                         "VALUES ('Super-Admin', 'super_admin', :locked, 'Full system and domain administrative access', :now)"),
                    {"locked": True, "now": datetime.utcnow()},
                )
        else:
            session.execute(
                text("UPDATE roles SET is_locked = :locked WHERE system_key = 'super_admin'"),
                {"locked": True},
            )

        # Rename or setup Employee
        if "employee" not in role_by_key:
            if "employee" in role_by_name:
                session.execute(
                    text("UPDATE roles SET name = 'Employee', system_key = 'employee', is_locked = :locked WHERE name = 'employee'"),
                    {"locked": False},
                )
            elif "Employee" in role_by_name:
                session.execute(
                    text("UPDATE roles SET system_key = 'employee', is_locked = :locked WHERE name = 'Employee'"),
                    {"locked": False},
                )
            else:
                session.execute(
                    text("INSERT INTO roles (name, system_key, is_locked, description, created_at) "
                         "VALUES ('Employee', 'employee', :locked, 'Standard self-service employee access', :now)"),
                    {"locked": False, "now": datetime.utcnow()},
                )

        # Create HR-Admin, Financial-Admin, Payroll-Maker
        roles_to_create = [
            ("HR-Admin", "hr_admin", "Full HR administrative access"),
            ("Financial-Admin", "financial_admin", "Full finance administration, approval, and disbursement"),
            ("Payroll-Maker", "payroll_maker", "Payroll preparation and adjustment"),
        ]
        for r_name, r_key, r_desc in roles_to_create:
            role_exists = session.execute(
                text("SELECT id FROM roles WHERE system_key = :r_key OR name = :r_name"),
                {"r_key": r_key, "r_name": r_name},
            ).fetchone()
            if not role_exists:
                session.execute(
                    text("INSERT INTO roles (name, system_key, is_locked, description, created_at) "
                         "VALUES (:name, :key, :locked, :desc, :now)"),
                    {"name": r_name, "key": r_key, "locked": False, "desc": r_desc, "now": datetime.utcnow()},
                )
            else:
                session.execute(
                    text("UPDATE roles SET system_key = :r_key, name = :r_name WHERE id = :rid"),
                    {"r_key": r_key, "r_name": r_name, "rid": role_exists[0]},
                )
        session.flush()

        # Re-query roles by system_key
        roles_updated = session.execute(text("SELECT id, system_key FROM roles")).fetchall()
        role_id_map = {row[1]: row[0] for row in roles_updated if row[1]}

        # C. Seed role permissions
        existing_rp_rows = session.execute(text("SELECT role_id, permission_id FROM role_permissions")).fetchall()
        existing_rps = {(row[0], row[1]) for row in existing_rp_rows}

        for sys_key, perm_keys in FROZEN_ROLE_PERMISSIONS.items():
            r_id = role_id_map.get(sys_key)
            if not r_id:
                continue
            for p_key in perm_keys:
                p_id = perm_map.get(p_key)
                if p_id and (r_id, p_id) not in existing_rps:
                    session.execute(
                        text("INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (:r_id, :p_id, :now)"),
                        {"r_id": r_id, "p_id": p_id, "now": datetime.utcnow()},
                    )
                    existing_rps.add((r_id, p_id))
        session.flush()

        # D. Backfill users.role = 'admin' to hold Super-Admin in user_roles
        super_admin_id = role_id_map.get("super_admin")
        if super_admin_id:
            existing_ur_rows = session.execute(text("SELECT user_id, role_id FROM user_roles")).fetchall()
            existing_urs = {(row[0], row[1]) for row in existing_ur_rows}

            admin_users = session.execute(
                text("SELECT id FROM users WHERE LOWER(role) = 'admin'")
            ).fetchall()

            for u_row in admin_users:
                u_id = u_row[0]
                if (u_id, super_admin_id) not in existing_urs:
                    session.execute(
                        text("INSERT INTO user_roles (user_id, role_id, created_at) VALUES (:u_id, :r_id, :now)"),
                        {"u_id": u_id, "r_id": super_admin_id, "now": datetime.utcnow()},
                    )
                    existing_urs.add((u_id, super_admin_id))

        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'users' in tables:
        users_cols = [col['name'] for col in inspector.get_columns('users')]
        with op.batch_alter_table('users') as batch_op:
            if 'archived_by' in users_cols:
                batch_op.drop_column('archived_by')
            if 'archived_at' in users_cols:
                batch_op.drop_column('archived_at')
            if 'name' in users_cols:
                batch_op.drop_column('name')

    if 'roles' in tables:
        roles_cols = [col['name'] for col in inspector.get_columns('roles')]
        role_indexes = [ix['name'] for ix in inspector.get_indexes('roles')]
        if 'ix_roles_system_key' in role_indexes:
            op.drop_index('ix_roles_system_key', table_name='roles')
        with op.batch_alter_table('roles') as batch_op:
            if 'is_locked' in roles_cols:
                batch_op.drop_column('is_locked')
            if 'system_key' in roles_cols:
                batch_op.drop_column('system_key')
