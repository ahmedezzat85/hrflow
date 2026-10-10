"""0031_invoice_status_model

Finance Review Round 2, slice F1 (D-022): sales-invoice status model.

Statuses are draft, sent, partially_paid, paid, void. Overdue becomes a flag.

Old status                            -> New status
overdue, open, awaiting_payment       -> sent
draft, sent, partially_paid, paid, void -> unchanged

Rows that end up sent / partially_paid are then re-derived from their unreversed incoming
payments (paid when received covers the total, partially_paid when anything was received).
A row stored as paid keeps its status. An unknown legacy status (including 'all') aborts the
migration instead of being guessed. Adds void_reason, voided_by and voided_at.

Downgrade drops the three void columns. Every new status value was already valid in the old
code, so no status is rewritten; 'overdue' is not restored (lossy by design).

Revision ID: 0031_invoice_status_model
Revises: 0030_bill_draft_fields
Create Date: 2026-10-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = '0031_invoice_status_model'
down_revision: Union[str, None] = '0030_bill_draft_fields'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UP_MAP = {
    'overdue': 'sent',
    'open': 'sent',
    'awaiting_payment': 'sent',
}
KEEP = {'draft', 'sent', 'partially_paid', 'paid', 'void'}

RECEIVED_SQL = (
    "COALESCE((SELECT SUM(p.amount) FROM finance_payments p "
    "WHERE p.related_invoice_id = finance_sales_invoices.id "
    "AND p.is_reversed = :not_reversed AND p.direction = 'incoming'), 0)"
)


def _columns(bind) -> set:
    return {c['name'] for c in sa.inspect(bind).get_columns('finance_sales_invoices')}


def upgrade() -> None:
    bind = op.get_bind()
    if 'finance_sales_invoices' not in sa.inspect(bind).get_table_names():
        return

    existing = {r[0] for r in bind.execute(text("SELECT DISTINCT status FROM finance_sales_invoices")).fetchall()}
    unknown = sorted(s for s in existing if s not in UP_MAP and s not in KEEP)
    if unknown:
        raise RuntimeError(f"finance_sales_invoices has unmapped statuses: {unknown}")

    cols = _columns(bind)
    with op.batch_alter_table('finance_sales_invoices') as batch_op:
        if 'void_reason' not in cols:
            batch_op.add_column(sa.Column('void_reason', sa.Text(), nullable=True))
        if 'voided_by' not in cols:
            batch_op.add_column(sa.Column('voided_by', sa.String(length=255), nullable=True))
        if 'voided_at' not in cols:
            batch_op.add_column(sa.Column('voided_at', sa.DateTime(), nullable=True))

    for old, new in UP_MAP.items():
        bind.execute(text("UPDATE finance_sales_invoices SET status = :new WHERE status = :old"), {"old": old, "new": new})

    if 'finance_payments' in sa.inspect(bind).get_table_names():
        params = {"not_reversed": False}
        bind.execute(
            text(
                "UPDATE finance_sales_invoices SET status = 'paid' "
                "WHERE status IN ('sent', 'partially_paid') AND COALESCE(total, 0) > 0 "
                f"AND {RECEIVED_SQL} >= COALESCE(total, 0) - 0.01"
            ),
            params,
        )
        bind.execute(
            text(
                "UPDATE finance_sales_invoices SET status = 'partially_paid' "
                f"WHERE status = 'sent' AND {RECEIVED_SQL} > 0.001"
            ),
            params,
        )
        bind.execute(
            text(
                "UPDATE finance_sales_invoices SET status = 'sent' "
                f"WHERE status = 'partially_paid' AND {RECEIVED_SQL} <= 0.001"
            ),
            params,
        )


def downgrade() -> None:
    bind = op.get_bind()
    if 'finance_sales_invoices' not in sa.inspect(bind).get_table_names():
        return

    cols = _columns(bind)
    with op.batch_alter_table('finance_sales_invoices') as batch_op:
        for name in ('voided_at', 'voided_by', 'void_reason'):
            if name in cols:
                batch_op.drop_column(name)
