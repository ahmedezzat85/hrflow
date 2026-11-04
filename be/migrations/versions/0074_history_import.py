"""0074_history_import

MCP slice M2 (D-051): the staging tables for historical leave items (`history_import_batches`, `history_import_items`) and the
permissions hr.history_import.read / .write / .review. The permissions are granted to no seeded role; Super-Admin
holds every key automatically and the owner grants them to others on the Roles page. The downgrade drops the tables
and the permissions (with their role grants).

Revision ID: 0074_history_import
Revises: 0073_api_tokens
Create Date: 2026-11-03
"""
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0074_history_import'
down_revision: Union[str, None] = '0073_api_tokens'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_KEYS = [
    ("hr.history_import.read", "View staged historical leave and work-from-home items"),
    ("hr.history_import.write", "Validate and stage historical leave items (used by the MCP token); cannot accept them"),
    ("hr.history_import.review", "Edit, accept or reject staged historical items, which creates the leave records"),
]


def _date_check(column: str) -> sa.CheckConstraint:
    expression = (
        f"(length({column}) = 10 AND substr({column}, 5, 1) = '-' AND substr({column}, 8, 1) = '-' "
        f"AND substr({column}, 1, 4) BETWEEN '1900' AND '2999' AND substr({column}, 6, 2) BETWEEN '01' AND '12' "
        f"AND substr({column}, 9, 2) BETWEEN '01' AND '31')"
    )
    return sa.CheckConstraint(expression, name=f"ck_dt_history_import_items_{column}")


def upgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()

    existing = {row[0] for row in bind.execute(sa.text("SELECT key FROM permissions")).fetchall()}
    for key, desc in NEW_KEYS:
        if key not in existing:
            bind.execute(
                sa.text("INSERT INTO permissions (key, description, created_at) VALUES (:key, :desc, :now)"),
                {"key": key, "desc": desc, "now": datetime.utcnow()},
            )

    if "history_import_batches" not in tables:
        op.create_table(
            "history_import_batches",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("label", sa.String(200), nullable=False),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("token_id", sa.Integer(), nullable=True),
            sa.Column("idempotency_key", sa.String(100), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_history_import_batches_created_by_user_id", "history_import_batches", ["created_by_user_id"])
        op.create_index("uq_history_import_batches_user_key", "history_import_batches", ["created_by_user_id", "idempotency_key"], unique=True)

    if "history_import_items" not in tables:
        op.create_table(
            "history_import_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("batch_id", sa.Integer(), sa.ForeignKey("history_import_batches.id", ondelete="CASCADE"), nullable=False),
            sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("leave_type", sa.String(100), nullable=False),
            sa.Column("start_date", sa.String(10), nullable=False),
            sa.Column("end_date", sa.String(10), nullable=False),
            sa.Column("days", sa.Integer(), nullable=False),
            sa.Column("decision", sa.String(20), nullable=False),
            sa.Column("decided_by", sa.String(255), nullable=True),
            sa.Column("decided_on", sa.String(10), nullable=True),
            sa.Column("source_kind", sa.String(20), nullable=False),
            sa.Column("source_ref", sa.String(255), nullable=False),
            sa.Column("source_sha256", sa.String(64), nullable=True),
            sa.Column("evidence_excerpt", sa.Text(), nullable=True),
            sa.Column("confidence", sa.String(10), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("reviewed_by", sa.String(255), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("reject_reason", sa.String(255), nullable=True),
            sa.Column("result_vacation_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            _date_check("start_date"),
            _date_check("end_date"),
        )
        op.create_index("ix_history_import_items_batch_id", "history_import_items", ["batch_id"])
        op.create_index("ix_history_import_items_employee_id", "history_import_items", ["employee_id"])
        op.create_index("ix_history_import_items_status", "history_import_items", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "history_import_items" in tables:
        op.drop_table("history_import_items")
    if "history_import_batches" in tables:
        op.drop_table("history_import_batches")
    for key, _desc in NEW_KEYS:
        row = bind.execute(sa.text("SELECT id FROM permissions WHERE key = :key"), {"key": key}).fetchone()
        if row:
            bind.execute(sa.text("DELETE FROM role_permissions WHERE permission_id = :pid"), {"pid": row[0]})
            bind.execute(sa.text("DELETE FROM permissions WHERE id = :pid"), {"pid": row[0]})
