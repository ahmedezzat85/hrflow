"""0042_invoice_scans

Bulk / historical import (D-033, slice I4): sales invoice scans. Adds a nullable `sales_invoice_id` (FK to
finance_sales_invoices, CASCADE) to finance_attachments, following the cheque scan pattern (0036). Existing rows
keep NULL. Idempotent; the downgrade drops the column (invoice scans leave the table, not the disk).

Revision ID: 0042_invoice_scans
Revises: 0041_import_batches
Create Date: 2026-10-20 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0042_invoice_scans'
down_revision: Union[str, None] = '0041_import_batches'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'finance_attachments' not in insp.get_table_names():
        return
    cols = {c['name'] for c in insp.get_columns('finance_attachments')}
    if 'sales_invoice_id' in cols:
        return
    with op.batch_alter_table('finance_attachments') as batch_op:
        batch_op.add_column(sa.Column('sales_invoice_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_finance_attachments_sales_invoice_id', 'finance_sales_invoices', ['sales_invoice_id'], ['id'], ondelete='CASCADE'
        )
        batch_op.create_index('ix_finance_attachments_sales_invoice_id', ['sales_invoice_id'])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'finance_attachments' not in insp.get_table_names():
        return
    cols = {c['name'] for c in insp.get_columns('finance_attachments')}
    if 'sales_invoice_id' not in cols:
        return
    idx = {i['name'] for i in insp.get_indexes('finance_attachments')}
    fks = {fk['name'] for fk in insp.get_foreign_keys('finance_attachments')}
    with op.batch_alter_table('finance_attachments') as batch_op:
        if 'ix_finance_attachments_sales_invoice_id' in idx:
            batch_op.drop_index('ix_finance_attachments_sales_invoice_id')
        if 'fk_finance_attachments_sales_invoice_id' in fks:
            batch_op.drop_constraint('fk_finance_attachments_sales_invoice_id', type_='foreignkey')
        batch_op.drop_column('sales_invoice_id')
