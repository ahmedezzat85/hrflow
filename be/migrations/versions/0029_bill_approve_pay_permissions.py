"""0029_bill_approve_pay_permissions

Vendor Bill Workflow v2, slice B2 (D-017): adds finance.bill.approve and
finance.bill.pay. They are granted to no seeded role, so Financial-Admin keeps
create/edit but can no longer approve or pay bills until granted. Super admin
holds every key automatically.

Revision ID: 0029_bill_approve_pay_permissions
Revises: 0028_bill_status_model
Create Date: 2026-10-09 14:00:00.000000

"""
from datetime import datetime
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = '0029_bill_approve_pay_permissions'
down_revision: Union[str, None] = '0028_bill_status_model'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_KEYS = [
    ("finance.bill.approve", "Approve or reject vendor bills; bills saved by an approver are auto-approved"),
    ("finance.bill.pay", "Record payments against vendor bills (including already-paid bills, linked cheques and transactions)"),
]


def upgrade() -> None:
    bind = op.get_bind()
    existing = {row[0] for row in bind.execute(text("SELECT key FROM permissions")).fetchall()}
    for key, desc in NEW_KEYS:
        if key not in existing:
            bind.execute(
                text("INSERT INTO permissions (key, description, created_at) VALUES (:key, :desc, :now)"),
                {"key": key, "desc": desc, "now": datetime.utcnow()},
            )


def downgrade() -> None:
    bind = op.get_bind()
    for key, _desc in NEW_KEYS:
        row = bind.execute(text("SELECT id FROM permissions WHERE key = :key"), {"key": key}).fetchone()
        if row:
            bind.execute(text("DELETE FROM role_permissions WHERE permission_id = :pid"), {"pid": row[0]})
            bind.execute(text("DELETE FROM permissions WHERE id = :pid"), {"pid": row[0]})
