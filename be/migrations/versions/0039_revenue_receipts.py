"""0039_revenue_receipts

Finance expansion X4 (D-029, D-030): revenue sources and revenue tagging on ledger rows.
Existing invoice receipts are tagged with the Invoice source and their customer. The revenue_channel column on
invoices is kept; invoice receipts are always source Invoice, and the book of an invoice comes from its expected
receiving account (D-028), so the channel needs no further mapping.

Revision ID: 0039_revenue_receipts
Revises: 0038_books
Create Date: 2026-10-18 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = '0039_revenue_receipts'
down_revision: Union[str, None] = '0038_books'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SEED = (
    ('invoice', 'Invoice', 1, True),
    ('stripe_payout', 'Stripe payout', 2, False),
    ('direct_transfer', 'Direct transfer', 3, False),
    ('cash', 'Cash', 4, False),
    ('other', 'Other', 5, False),
)
LEDGER_COLUMNS = ('product_id', 'customer_id', 'revenue_source_id', 'period_start', 'period_end', 'memo_gross_amount', 'memo_fee_amount')


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if 'finance_revenue_sources' not in tables:
        op.create_table(
            'finance_revenue_sources',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('code', sa.String(50), nullable=False),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index('ix_finance_revenue_sources_code', 'finance_revenue_sources', ['code'], unique=True)
    for code, name, order, system in SEED:
        if not bind.execute(text("SELECT 1 FROM finance_revenue_sources WHERE code = :c"), {"c": code}).first():
            bind.execute(
                text("INSERT INTO finance_revenue_sources (code, name, sort_order, is_active, is_system) VALUES (:c, :n, :o, :a, :s)"),
                {"c": code, "n": name, "o": order, "a": True, "s": system},
            )

    if 'finance_ledger_transactions' in tables:
        cols = {c['name'] for c in insp.get_columns('finance_ledger_transactions')}
        missing = [c for c in LEDGER_COLUMNS if c not in cols]
        if missing:
            with op.batch_alter_table('finance_ledger_transactions') as batch_op:
                if 'product_id' in missing:
                    batch_op.add_column(sa.Column('product_id', sa.Integer(), nullable=True))
                    batch_op.create_foreign_key('fk_ledger_product_id', 'finance_products', ['product_id'], ['id'], ondelete='SET NULL')
                    batch_op.create_index('ix_finance_ledger_transactions_product_id', ['product_id'])
                if 'customer_id' in missing:
                    batch_op.add_column(sa.Column('customer_id', sa.Integer(), nullable=True))
                    batch_op.create_foreign_key('fk_ledger_customer_id', 'finance_customers', ['customer_id'], ['id'], ondelete='SET NULL')
                    batch_op.create_index('ix_finance_ledger_transactions_customer_id', ['customer_id'])
                if 'revenue_source_id' in missing:
                    batch_op.add_column(sa.Column('revenue_source_id', sa.Integer(), nullable=True))
                    batch_op.create_foreign_key('fk_ledger_revenue_source_id', 'finance_revenue_sources', ['revenue_source_id'], ['id'], ondelete='SET NULL')
                    batch_op.create_index('ix_finance_ledger_transactions_revenue_source_id', ['revenue_source_id'])
                for name in ('period_start', 'period_end'):
                    if name in missing:
                        batch_op.add_column(sa.Column(name, sa.String(20), nullable=True))
                for name in ('memo_gross_amount', 'memo_fee_amount'):
                    if name in missing:
                        batch_op.add_column(sa.Column(name, sa.Float(), nullable=True))

        invoice_src = bind.execute(text("SELECT id FROM finance_revenue_sources WHERE code = 'invoice'")).scalar()
        if 'finance_sales_invoices' in tables:
            # Tag existing invoice receipts (and their reversals) with the Invoice source and the invoice's customer
            bind.execute(
                text(
                    "UPDATE finance_ledger_transactions SET revenue_source_id = :s, "
                    "customer_id = (SELECT customer_id FROM finance_sales_invoices WHERE finance_sales_invoices.id = finance_ledger_transactions.linked_invoice_id) "
                    "WHERE linked_invoice_id IS NOT NULL AND source IN ('invoice_payment', 'payment_reversal') AND revenue_source_id IS NULL"
                ),
                {"s": invoice_src},
            )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if 'finance_ledger_transactions' in tables:
        cols = {c['name'] for c in insp.get_columns('finance_ledger_transactions')}
        idx = {i['name'] for i in insp.get_indexes('finance_ledger_transactions')}
        with op.batch_alter_table('finance_ledger_transactions') as batch_op:
            for name in ('product_id', 'customer_id', 'revenue_source_id'):
                ix = f'ix_finance_ledger_transactions_{name}'
                if ix in idx:
                    batch_op.drop_index(ix)
            for name in reversed(LEDGER_COLUMNS):
                if name in cols:
                    batch_op.drop_column(name)
    if 'finance_revenue_sources' in tables:
        op.drop_table('finance_revenue_sources')
