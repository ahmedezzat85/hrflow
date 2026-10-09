"""0030_bill_draft_fields

Vendor Bill Workflow v2, slice B4 (D-019): drafts and PDF upload.

- finance_bills.vendor_id, bill_number, issue_date and due_date become nullable so a Draft can be
  saved with only a vendor or only an attachment (Alembic batch mode on SQLite).
- Adds vendor_to_confirm and suggested_vendor_name for uploads whose vendor could not be matched.

Downgrade restores NOT NULL. Drafts without a vendor cannot exist in the old schema, so they are
deleted first (with their lines); other empty fields get placeholders (bill number DRAFT-<id>, today's date).

Revision ID: 0030_bill_draft_fields
Revises: 0029_bill_approve_pay_permissions
Create Date: 2026-10-09 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = '0030_bill_draft_fields'
down_revision: Union[str, None] = '0029_bill_approve_pay_permissions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(bind) -> set:
    return {c['name'] for c in sa.inspect(bind).get_columns('finance_bills')}


def upgrade() -> None:
    bind = op.get_bind()
    if 'finance_bills' not in sa.inspect(bind).get_table_names():
        return
    cols = _cols(bind)
    with op.batch_alter_table('finance_bills') as batch_op:
        if 'vendor_to_confirm' not in cols:
            batch_op.add_column(sa.Column('vendor_to_confirm', sa.Boolean(), nullable=False, server_default=sa.false()))
        if 'suggested_vendor_name' not in cols:
            batch_op.add_column(sa.Column('suggested_vendor_name', sa.String(length=255), nullable=True))
        batch_op.alter_column('vendor_id', existing_type=sa.Integer(), nullable=True)
        batch_op.alter_column('bill_number', existing_type=sa.String(length=50), nullable=True)
        batch_op.alter_column('issue_date', existing_type=sa.String(length=20), nullable=True)
        batch_op.alter_column('due_date', existing_type=sa.String(length=20), nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    if 'finance_bills' not in sa.inspect(bind).get_table_names():
        return

    # Drafts with no vendor cannot exist in the old schema
    orphan_ids = [r[0] for r in bind.execute(text("SELECT id FROM finance_bills WHERE vendor_id IS NULL")).fetchall()]
    for bill_id in orphan_ids:
        bind.execute(text("DELETE FROM finance_bill_lines WHERE bill_id = :id"), {"id": bill_id})
        bind.execute(text("DELETE FROM finance_bills WHERE id = :id"), {"id": bill_id})
    bind.execute(text("UPDATE finance_bills SET bill_number = 'DRAFT-' || id WHERE bill_number IS NULL"))
    bind.execute(text("UPDATE finance_bills SET issue_date = '1970-01-01' WHERE issue_date IS NULL"))
    bind.execute(text("UPDATE finance_bills SET due_date = '1970-01-01' WHERE due_date IS NULL"))

    cols = _cols(bind)
    with op.batch_alter_table('finance_bills') as batch_op:
        batch_op.alter_column('vendor_id', existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column('bill_number', existing_type=sa.String(length=50), nullable=False)
        batch_op.alter_column('issue_date', existing_type=sa.String(length=20), nullable=False)
        batch_op.alter_column('due_date', existing_type=sa.String(length=20), nullable=False)
        if 'suggested_vendor_name' in cols:
            batch_op.drop_column('suggested_vendor_name')
        if 'vendor_to_confirm' in cols:
            batch_op.drop_column('vendor_to_confirm')
