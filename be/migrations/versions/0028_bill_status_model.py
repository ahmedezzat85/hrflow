"""0028_bill_status_model

Vendor Bill Workflow v2, slice B1 (D-016): eight-status model.

Old status          -> New status
inbox, needs_coding -> draft
needs_approval      -> pending_approval
exceptions          -> rejected
unpaid, ready_to_pay, overdue -> approved
scheduled, partially_paid, paid, void -> unchanged

Remapped rows that already carry unreversed payments are then set to
partially_paid / paid from their recorded amount_paid. Adds void_reason,
voided_by, voided_at and changes the status column default to 'draft'.
An unknown legacy status aborts the migration instead of being guessed.

Downgrade is lossy by necessity: needs_coding collapses into inbox and
unpaid / overdue collapse into ready_to_pay; the void_* columns are dropped.

Revision ID: 0028_bill_status_model
Revises: 0027_single_assigned_role
Create Date: 2026-10-09 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = '0028_bill_status_model'
down_revision: Union[str, None] = '0027_single_assigned_role'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UP_MAP = {
    'inbox': 'draft',
    'needs_coding': 'draft',
    'needs_approval': 'pending_approval',
    'exceptions': 'rejected',
    'unpaid': 'approved',
    'ready_to_pay': 'approved',
    'overdue': 'approved',
}
KEEP = {'scheduled', 'partially_paid', 'paid', 'void'}
NEW_STATUSES = {'draft', 'pending_approval', 'rejected', 'approved'} | KEEP

DOWN_MAP = {
    'draft': 'inbox',
    'pending_approval': 'needs_approval',
    'rejected': 'exceptions',
    'approved': 'ready_to_pay',
}


def _columns(bind) -> set:
    return {c['name'] for c in sa.inspect(bind).get_columns('finance_bills')}


def upgrade() -> None:
    bind = op.get_bind()
    if 'finance_bills' not in sa.inspect(bind).get_table_names():
        return

    existing = {r[0] for r in bind.execute(text("SELECT DISTINCT status FROM finance_bills")).fetchall()}
    unknown = sorted(s for s in existing if s not in UP_MAP and s not in NEW_STATUSES)
    if unknown:
        raise RuntimeError(f"finance_bills has unmapped statuses: {unknown}")

    cols = _columns(bind)
    with op.batch_alter_table('finance_bills') as batch_op:
        if 'void_reason' not in cols:
            batch_op.add_column(sa.Column('void_reason', sa.Text(), nullable=True))
        if 'voided_by' not in cols:
            batch_op.add_column(sa.Column('voided_by', sa.String(length=255), nullable=True))
        if 'voided_at' not in cols:
            batch_op.add_column(sa.Column('voided_at', sa.DateTime(), nullable=True))
        batch_op.alter_column(
            'status',
            existing_type=sa.String(length=30),
            existing_nullable=False,
            server_default='draft',
        )

    # Rows that were already payable and carry unreversed payments: derive from amount_paid.
    # Done before the plain remap so only legacy payable keys are touched.
    payable = tuple(k for k, v in UP_MAP.items() if v == 'approved')
    for old in payable:
        bind.execute(
            text(
                "UPDATE finance_bills SET status = 'paid' "
                "WHERE status = :old AND COALESCE(amount_paid, 0) > 0.001 "
                "AND COALESCE(amount_paid, 0) >= COALESCE(total, 0) - 0.01"
            ),
            {"old": old},
        )
        bind.execute(
            text(
                "UPDATE finance_bills SET status = 'partially_paid' "
                "WHERE status = :old AND COALESCE(amount_paid, 0) > 0.001"
            ),
            {"old": old},
        )

    for old, new in UP_MAP.items():
        bind.execute(text("UPDATE finance_bills SET status = :new WHERE status = :old"), {"old": old, "new": new})


def downgrade() -> None:
    bind = op.get_bind()
    if 'finance_bills' not in sa.inspect(bind).get_table_names():
        return

    for new, old in DOWN_MAP.items():
        bind.execute(text("UPDATE finance_bills SET status = :old WHERE status = :new"), {"old": old, "new": new})

    cols = _columns(bind)
    with op.batch_alter_table('finance_bills') as batch_op:
        batch_op.alter_column(
            'status',
            existing_type=sa.String(length=30),
            existing_nullable=False,
            server_default='unpaid',
        )
        for name in ('voided_at', 'voided_by', 'void_reason'):
            if name in cols:
                batch_op.drop_column(name)
