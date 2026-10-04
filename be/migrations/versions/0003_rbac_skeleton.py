"""0003_rbac_skeleton

Revision ID: 0003_rbac_skeleton
Revises: 0002_rename_invoices_to_salary_payment_docs
Create Date: 2026-09-09 11:15:00.000000

"""
from typing import Sequence, Union
from datetime import datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session


# revision identifiers, used by Alembic.
revision: str = '0003_rbac_skeleton'
down_revision: Union[str, None] = '0002_rename_invoices_to_salary_payment_docs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. permissions table
    if 'permissions' not in tables:
        op.create_table(
            'permissions',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('key', sa.String(length=100), nullable=False),
            sa.Column('description', sa.String(length=255), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_permissions_key'), 'permissions', ['key'], unique=True)

    # 2. roles table
    if 'roles' not in tables:
        op.create_table(
            'roles',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('name', sa.String(length=100), nullable=False),
            sa.Column('description', sa.String(length=255), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_roles_name'), 'roles', ['name'], unique=True)

    # 3. role_permissions table
    if 'role_permissions' not in tables:
        op.create_table(
            'role_permissions',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('role_id', sa.Integer(), nullable=False),
            sa.Column('permission_id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('role_id', 'permission_id', name='uq_role_permission')
        )
        op.create_index(op.f('ix_role_permissions_role_id'), 'role_permissions', ['role_id'], unique=False)
        op.create_index(op.f('ix_role_permissions_permission_id'), 'role_permissions', ['permission_id'], unique=False)

    # 4. user_roles table
    if 'user_roles' not in tables:
        op.create_table(
            'user_roles',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('role_id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'role_id', name='uq_user_role')
        )
        op.create_index(op.f('ix_user_roles_user_id'), 'user_roles', ['user_id'], unique=False)
        op.create_index(op.f('ix_user_roles_role_id'), 'user_roles', ['role_id'], unique=False)

    # 5. Seed permissions, roles, role_permissions, and backfill existing users (frozen copy)
    _frozen_seed_0003(bind)


# Frozen seed copy for migration 0003 to ensure immutability
FROZEN_0003_PERMISSIONS = [
    {"key": "system.users.manage", "description": "Manage user accounts and identity"},
    {"key": "system.roles.manage", "description": "Manage RBAC roles and permissions"},
    {"key": "hr.employee.read", "description": "View company employee profiles"},
    {"key": "hr.employee.write", "description": "Create, edit, and delete employee records"},
    {"key": "hr.salary.read", "description": "View employee salaries and raise history"},
    {"key": "hr.salary.write", "description": "Update employee salaries and record compensation changes"},
    {"key": "hr.vacation.read", "description": "View company vacation requests and balances"},
    {"key": "hr.vacation.write", "description": "Manage and approve vacation requests"},
    {"key": "self.profile.read", "description": "View own employee profile"},
    {"key": "self.payslip.read", "description": "View own salary payment documents and payslips"},
    {"key": "self.requests.write", "description": "Submit vacation, medical, and general requests"},
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
    {"key": "finance.payroll.write", "description": "Create and manage company payroll runs"},
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


def _frozen_seed_0003(bind):
    session = Session(bind=bind)
    try:
        now = datetime.utcnow()
        # 1. permissions
        existing_perms_rows = session.execute(sa.text("SELECT id, key FROM permissions")).fetchall()
        existing_perms = {row[1]: row[0] for row in existing_perms_rows}
        for perm_def in FROZEN_0003_PERMISSIONS:
            key = perm_def["key"]
            if key not in existing_perms:
                session.execute(
                    sa.text("INSERT INTO permissions (key, description, created_at) VALUES (:key, :desc, :now)"),
                    {"key": key, "desc": perm_def.get("description", ""), "now": now},
                )
        session.flush()
        existing_perms_rows = session.execute(sa.text("SELECT id, key FROM permissions")).fetchall()
        existing_perms = {row[1]: row[0] for row in existing_perms_rows}

        # 2. roles
        existing_roles_rows = session.execute(sa.text("SELECT id, name FROM roles")).fetchall()
        existing_roles = {row[1]: row[0] for row in existing_roles_rows}
        for role_name, role_desc in [
            ("system_admin", "Full system and domain administrative access"),
            ("employee", "Standard self-service employee access"),
        ]:
            if role_name not in existing_roles:
                session.execute(
                    sa.text("INSERT INTO roles (name, description, created_at) VALUES (:name, :desc, :now)"),
                    {"name": role_name, "desc": role_desc, "now": now},
                )
        session.flush()
        existing_roles_rows = session.execute(sa.text("SELECT id, name FROM roles")).fetchall()
        existing_roles = {row[1]: row[0] for row in existing_roles_rows}

        admin_role_id = existing_roles["system_admin"]
        employee_role_id = existing_roles["employee"]

        # 3. role_permissions
        existing_rp_rows = session.execute(sa.text("SELECT role_id, permission_id FROM role_permissions")).fetchall()
        existing_rp = {(row[0], row[1]) for row in existing_rp_rows}

        for p_id in existing_perms.values():
            if (admin_role_id, p_id) not in existing_rp:
                session.execute(
                    sa.text("INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (:rid, :pid, :now)"),
                    {"rid": admin_role_id, "pid": p_id, "now": now},
                )
                existing_rp.add((admin_role_id, p_id))

        emp_keys = {"self.profile.read", "self.payslip.read", "self.requests.write"}
        for k in emp_keys:
            p_id = existing_perms.get(k)
            if p_id and (employee_role_id, p_id) not in existing_rp:
                session.execute(
                    sa.text("INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (:rid, :pid, :now)"),
                    {"rid": employee_role_id, "pid": p_id, "now": now},
                )
                existing_rp.add((employee_role_id, p_id))
        session.flush()

        # 4. user_roles
        existing_ur_rows = session.execute(sa.text("SELECT user_id, role_id FROM user_roles")).fetchall()
        existing_ur = {(row[0], row[1]) for row in existing_ur_rows}

        user_rows = session.execute(sa.text("SELECT id, role FROM users")).fetchall()
        for u_id, u_role in user_rows:
            target_role_id = admin_role_id if str(u_role).lower() == "admin" else employee_role_id
            if (u_id, target_role_id) not in existing_ur:
                session.execute(
                    sa.text("INSERT INTO user_roles (user_id, role_id, created_at) VALUES (:uid, :rid, :now)"),
                    {"uid": u_id, "rid": target_role_id, "now": now},
                )
                existing_ur.add((u_id, target_role_id))

        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'user_roles' in tables:
        op.drop_table('user_roles')
    if 'role_permissions' in tables:
        op.drop_table('role_permissions')
    if 'roles' in tables:
        op.drop_table('roles')
    if 'permissions' in tables:
        op.drop_table('permissions')
