"""0037_products

Finance expansion X3 (D-030): product catalog and finance_sales_invoice_lines.product_id.

Revision ID: 0037_products
Revises: 0036_cheque_attachments
Create Date: 2026-10-18 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0037_products'
down_revision: Union[str, None] = '0036_cheque_attachments'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if 'finance_products' not in tables:
        op.create_table(
            'finance_products',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('code', sa.String(50), nullable=False),
            sa.Column('product_type', sa.String(40), nullable=False, server_default='other'),
            sa.Column('default_currency', sa.String(10), nullable=False, server_default='USD'),
            sa.Column('default_price', sa.Float(), nullable=True),
            sa.Column('default_receiving_account_id', sa.Integer(), sa.ForeignKey('finance_bank_accounts.id', ondelete='SET NULL'), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('created_by', sa.String(255), nullable=True),
        )
        op.create_index('ix_finance_products_code', 'finance_products', ['code'], unique=True)

    if 'finance_sales_invoice_lines' in tables:
        cols = {c['name'] for c in insp.get_columns('finance_sales_invoice_lines')}
        if 'product_id' not in cols:
            with op.batch_alter_table('finance_sales_invoice_lines') as batch_op:
                batch_op.add_column(sa.Column('product_id', sa.Integer(), nullable=True))
                batch_op.create_foreign_key('fk_invoice_lines_product_id', 'finance_products', ['product_id'], ['id'], ondelete='SET NULL')
                batch_op.create_index('ix_finance_sales_invoice_lines_product_id', ['product_id'])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if 'finance_sales_invoice_lines' in tables:
        cols = {c['name'] for c in insp.get_columns('finance_sales_invoice_lines')}
        if 'product_id' in cols:
            index_names = {i['name'] for i in insp.get_indexes('finance_sales_invoice_lines')}
            with op.batch_alter_table('finance_sales_invoice_lines') as batch_op:
                if 'ix_finance_sales_invoice_lines_product_id' in index_names:
                    batch_op.drop_index('ix_finance_sales_invoice_lines_product_id')
                batch_op.drop_column('product_id')
    if 'finance_products' in tables:
        op.drop_table('finance_products')
