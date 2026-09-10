"""0009_invoice_expected_bank_and_channel

Revision ID: 0009_invoice_expected_bank_and_channel
Revises: 0008_create_account_transfers
Create Date: 2026-09-10 11:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009_invoice_expected_bank_and_channel'
down_revision: Union[str, None] = '0008_create_account_transfers'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_sales_invoices' in tables:
        cols = [c['name'] for c in inspector.get_columns('finance_sales_invoices')]
        if 'expected_bank_account_id' not in cols:
            op.add_column(
                'finance_sales_invoices',
                sa.Column('expected_bank_account_id', sa.Integer(), nullable=True)
            )
            op.create_index(
                op.f('ix_finance_sales_invoices_expected_bank_account_id'),
                'finance_sales_invoices',
                ['expected_bank_account_id'],
                unique=False
            )
        if 'revenue_channel' not in cols:
            op.add_column(
                'finance_sales_invoices',
                sa.Column('revenue_channel', sa.String(length=50), nullable=True)
            )
            op.create_index(
                op.f('ix_finance_sales_invoices_revenue_channel'),
                'finance_sales_invoices',
                ['revenue_channel'],
                unique=False
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_sales_invoices' in tables:
        cols = [c['name'] for c in inspector.get_columns('finance_sales_invoices')]
        if 'revenue_channel' in cols:
            op.drop_index(op.f('ix_finance_sales_invoices_revenue_channel'), table_name='finance_sales_invoices')
            op.drop_column('finance_sales_invoices', 'revenue_channel')
        if 'expected_bank_account_id' in cols:
            op.drop_index(op.f('ix_finance_sales_invoices_expected_bank_account_id'), table_name='finance_sales_invoices')
            op.drop_column('finance_sales_invoices', 'expected_bank_account_id')
