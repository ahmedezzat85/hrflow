"""0025_payroll_split

Revision ID: 0025_payroll_split
Revises: 0024_rbac_schema_and_roles
Create Date: 2026-10-02 20:00:00.000000

"""
from typing import Sequence, Union
from datetime import datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = '0025_payroll_split'
down_revision: Union[str, None] = '0024_rbac_schema_and_roles'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


REPLACEMENT_KEYS = [
    ("finance.payroll.read", "View payroll runs, previews, lines, and payslips"),
    ("finance.payroll.prepare", "Prepare draft payroll runs, adjustments, lines, and submit for approval"),
    ("finance.payroll.approve", "Approve and finalize submitted payroll runs"),
    ("finance.payroll.pay", "Execute disbursements and post general ledger transactions for payroll runs"),
]


def upgrade() -> None:
    bind = op.get_bind()
    session = Session(bind=bind)

    try:
        # 1. Ensure the 4 replacement permissions exist
        existing_perms_rows = session.execute(text("SELECT id, key FROM permissions")).fetchall()
        perm_map = {row[1]: row[0] for row in existing_perms_rows}

        for key, desc in REPLACEMENT_KEYS:
            if key not in perm_map:
                session.execute(
                    text("INSERT INTO permissions (key, description, created_at) VALUES (:key, :desc, :now)"),
                    {"key": key, "desc": desc, "now": datetime.utcnow()},
                )
        session.flush()

        # Re-fetch perm_map
        all_perms_rows = session.execute(text("SELECT id, key FROM permissions")).fetchall()
        perm_map = {row[1]: row[0] for row in all_perms_rows}

        old_write_id = perm_map.get("finance.payroll.write")
        if old_write_id:
            # 2. Find every role that held finance.payroll.write
            rp_rows = session.execute(
                text("SELECT role_id FROM role_permissions WHERE permission_id = :perm_id"),
                {"perm_id": old_write_id},
            ).fetchall()
            role_ids = {row[0] for row in rp_rows}

            # 3. Grant read, prepare, approve, pay to each such role
            replacement_perm_ids = [perm_map[k] for k, _ in REPLACEMENT_KEYS if k in perm_map]
            for r_id in role_ids:
                existing_for_role = {
                    row[0]
                    for row in session.execute(
                        text("SELECT permission_id FROM role_permissions WHERE role_id = :role_id"),
                        {"role_id": r_id},
                    ).fetchall()
                }
                for new_pid in replacement_perm_ids:
                    if new_pid not in existing_for_role:
                        session.execute(
                            text("INSERT INTO role_permissions (role_id, permission_id, created_at) "
                                 "VALUES (:role_id, :permission_id, :now)"),
                            {"role_id": r_id, "permission_id": new_pid, "now": datetime.utcnow()},
                        )

            # 4. Remove role_permissions for finance.payroll.write
            session.execute(
                text("DELETE FROM role_permissions WHERE permission_id = :perm_id"),
                {"perm_id": old_write_id},
            )

            # 5. Delete finance.payroll.write from permissions table
            session.execute(
                text("DELETE FROM permissions WHERE id = :perm_id"),
                {"perm_id": old_write_id},
            )

        session.commit()
    except Exception:
        session.rollback()
        raise


def downgrade() -> None:
    bind = op.get_bind()
    session = Session(bind=bind)

    try:
        # Re-insert finance.payroll.write
        existing_write = session.execute(
            text("SELECT id FROM permissions WHERE key = 'finance.payroll.write'")
        ).fetchone()

        if not existing_write:
            session.execute(
                text("INSERT INTO permissions (key, description, created_at) "
                     "VALUES ('finance.payroll.write', 'Create and manage company payroll runs (deprecated, split into prepare/approve/pay)', :now)"),
                {"now": datetime.utcnow()},
            )
            session.flush()

        old_write_id = session.execute(
            text("SELECT id FROM permissions WHERE key = 'finance.payroll.write'")
        ).fetchone()[0]

        # For any role that holds prepare, approve, or pay, re-grant finance.payroll.write
        split_keys = ["finance.payroll.prepare", "finance.payroll.approve", "finance.payroll.pay"]
        split_pids = [
            row[0]
            for row in session.execute(
                text("SELECT id FROM permissions WHERE key IN :keys"),
                {"keys": tuple(split_keys)},
            ).fetchall()
        ]

        if split_pids:
            role_ids = {
                row[0]
                for row in session.execute(
                    text("SELECT role_id FROM role_permissions WHERE permission_id IN :pids"),
                    {"pids": tuple(split_pids)},
                ).fetchall()
            }
            for r_id in role_ids:
                existing = session.execute(
                    text("SELECT 1 FROM role_permissions WHERE role_id = :role_id AND permission_id = :perm_id"),
                    {"role_id": r_id, "perm_id": old_write_id},
                ).fetchone()
                if not existing:
                    session.execute(
                        text("INSERT INTO role_permissions (role_id, permission_id, created_at) "
                             "VALUES (:role_id, :permission_id, :now)"),
                        {"role_id": r_id, "permission_id": old_write_id, "now": datetime.utcnow()},
                    )

        session.commit()
    except Exception:
        session.rollback()
        raise
