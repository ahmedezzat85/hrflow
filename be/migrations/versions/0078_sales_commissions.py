"""0078_sales_commissions

Sales commissions: `finance_salespeople` (a person who earns commission; optionally an employee), the customer's
`salesperson_id` and `commission_rate` (percent of the net invoice subtotal), and `finance_sales_commissions`, one accrued
row per fully paid invoice (voided, never deleted, when a receipt reversal un-pays the invoice). Existing customers get no
salesperson and a 0 rate, so nothing about existing invoices changes and no commission is back-filled.

Idempotent: a database built from scratch may already hold some of these objects.

Revision ID: 0078_sales_commissions
Revises: 0077_bill_withholding
Create Date: 2026-11-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0078_sales_commissions'
down_revision: Union[str, None] = '0077_bill_withholding'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Same expression as finance/date_checks.py (a required date, not empty)
_DATE_OK = (
    "(length({c}) = 10 AND substr({c}, 5, 1) = '-' AND substr({c}, 8, 1) = '-' "
    "AND substr({c}, 1, 4) BETWEEN '1900' AND '2999' AND substr({c}, 6, 2) BETWEEN '01' AND '12' "
    "AND substr({c}, 9, 2) BETWEEN '01' AND '31')"
)


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if 'finance_salespeople' not in tables:
        op.create_table(
            'finance_salespeople',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('email', sa.String(255), nullable=True),
            sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id', ondelete='SET NULL'), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_finance_salespeople_employee_id', 'finance_salespeople', ['employee_id'])

    insp = sa.inspect(bind)
    cols = {c['name']: c for c in insp.get_columns('finance_customers')}
    fks = {tuple(f['constrained_columns']) for f in insp.get_foreign_keys('finance_customers')}
    indexes = {i['name'] for i in insp.get_indexes('finance_customers')}
    rate = cols.get('commission_rate')
    if rate is not None and rate['nullable']:
        op.execute(sa.text("UPDATE finance_customers SET commission_rate = 0 WHERE commission_rate IS NULL"))
    with op.batch_alter_table('finance_customers') as b:
        if 'salesperson_id' not in cols:
            b.add_column(sa.Column('salesperson_id', sa.Integer(), nullable=True))
        if ('salesperson_id',) not in fks:
            b.create_foreign_key('fk_finance_customers_salesperson_id', 'finance_salespeople', ['salesperson_id'], ['id'], ondelete='SET NULL')
        if 'ix_finance_customers_salesperson_id' not in indexes:
            b.create_index('ix_finance_customers_salesperson_id', ['salesperson_id'])
        if rate is None:
            b.add_column(sa.Column('commission_rate', sa.Numeric(18, 8), nullable=False, server_default='0'))
        elif rate['nullable']:
            b.alter_column('commission_rate', existing_type=sa.Numeric(18, 8), nullable=False, server_default='0')

    if 'finance_sales_commissions' not in tables:
        op.create_table(
            'finance_sales_commissions',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('salesperson_id', sa.Integer(), sa.ForeignKey('finance_salespeople.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('customer_id', sa.Integer(), sa.ForeignKey('finance_customers.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('invoice_id', sa.Integer(), sa.ForeignKey('finance_sales_invoices.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('currency', sa.String(10), nullable=False),
            sa.Column('base_amount', sa.Numeric(18, 4), nullable=False),
            sa.Column('rate', sa.Numeric(18, 8), nullable=False),
            sa.Column('amount', sa.Numeric(18, 4), nullable=False),
            sa.Column('earned_date', sa.String(20), nullable=False),
            sa.Column('status', sa.String(20), nullable=False, server_default='accrued'),
            sa.Column('void_reason', sa.Text(), nullable=True),
            sa.Column('voided_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.CheckConstraint("status IN ('accrued', 'void')", name='ck_finance_sales_commissions_status'),
            sa.CheckConstraint(_DATE_OK.format(c='earned_date'), name='ck_dt_finance_sales_commissions_earned_date'),
        )
        op.create_index('ix_finance_sales_commissions_salesperson_id', 'finance_sales_commissions', ['salesperson_id'])
        op.create_index('ix_finance_sales_commissions_customer_id', 'finance_sales_commissions', ['customer_id'])
        op.create_index('ix_finance_sales_commissions_invoice_id', 'finance_sales_commissions', ['invoice_id'])
        op.create_index('ix_finance_sales_commissions_status', 'finance_sales_commissions', ['status'])


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if 'finance_sales_commissions' in tables:
        op.drop_table('finance_sales_commissions')
    insp = sa.inspect(bind)
    cols = {c['name'] for c in insp.get_columns('finance_customers')}
    fk_names = [f['name'] for f in insp.get_foreign_keys('finance_customers') if f['constrained_columns'] == ['salesperson_id']]
    indexes = {i['name'] for i in insp.get_indexes('finance_customers')}
    if 'salesperson_id' in cols or 'commission_rate' in cols:
        with op.batch_alter_table('finance_customers') as b:
            if 'ix_finance_customers_salesperson_id' in indexes:
                b.drop_index('ix_finance_customers_salesperson_id')
            for name in fk_names:
                if name:
                    b.drop_constraint(name, type_='foreignkey')
            if 'salesperson_id' in cols:
                b.drop_column('salesperson_id')
            if 'commission_rate' in cols:
                b.drop_column('commission_rate')
    if 'finance_salespeople' in tables:
        op.drop_table('finance_salespeople')
