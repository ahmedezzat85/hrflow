"""0033_customer_withholding_tax

Finance Review Round 2, slice F3 (D-024): customer withholding tax.

- finance_customers.withholding_tax_rate  (percent, default 0)
- finance_sales_invoices.withholding_tax_rate (percent of the net subtotal, default 0)
- finance_payments.withheld_amount (tax the customer withheld on a receipt; no bank movement, default 0)

Existing rows get 0, so nothing changes until a rate is set.

Revision ID: 0033_customer_withholding_tax
Revises: 0032_invoice_vat_rate
Create Date: 2026-10-10 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0033_customer_withholding_tax'
down_revision: Union[str, None] = '0032_invoice_vat_rate'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = (
    ('finance_customers', 'withholding_tax_rate'),
    ('finance_sales_invoices', 'withholding_tax_rate'),
    ('finance_payments', 'withheld_amount'),
)


def _columns(bind, table) -> set:
    return {c['name'] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table, column in COLUMNS:
        if table in tables and column not in _columns(bind, table):
            with op.batch_alter_table(table) as batch_op:
                batch_op.add_column(sa.Column(column, sa.Float(), nullable=False, server_default='0'))


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table, column in reversed(COLUMNS):
        if table in tables and column in _columns(bind, table):
            with op.batch_alter_table(table) as batch_op:
                batch_op.drop_column(column)
