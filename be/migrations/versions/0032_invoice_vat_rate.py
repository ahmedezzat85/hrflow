"""0032_invoice_vat_rate

Finance Review Round 2, slice F2 (D-023): VAT rate (percent) on sales invoices.

Existing invoices get 0 so their stored totals do not change.

Revision ID: 0032_invoice_vat_rate
Revises: 0031_invoice_status_model
Create Date: 2026-10-10 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0032_invoice_vat_rate'
down_revision: Union[str, None] = '0031_invoice_status_model'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(bind) -> set:
    return {c['name'] for c in sa.inspect(bind).get_columns('finance_sales_invoices')}


def upgrade() -> None:
    bind = op.get_bind()
    if 'finance_sales_invoices' not in sa.inspect(bind).get_table_names():
        return
    if 'vat_rate' not in _columns(bind):
        with op.batch_alter_table('finance_sales_invoices') as batch_op:
            batch_op.add_column(sa.Column('vat_rate', sa.Float(), nullable=False, server_default='0'))


def downgrade() -> None:
    bind = op.get_bind()
    if 'finance_sales_invoices' not in sa.inspect(bind).get_table_names():
        return
    if 'vat_rate' in _columns(bind):
        with op.batch_alter_table('finance_sales_invoices') as batch_op:
            batch_op.drop_column('vat_rate')
