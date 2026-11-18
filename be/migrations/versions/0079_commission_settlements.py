"""0079_commission_settlements

Commission settlement confirmations: `finance_commission_settlements` (a salesperson's month or quarter confirmed as
paid out elsewhere; HRFlow only records the confirmation), `finance_sales_commissions.settlement_id` (set while a
commission is settled) and `finance_salespeople.settlement_frequency` (monthly for employees, quarterly otherwise).
Existing salespeople with an employee link become monthly, the rest quarterly.

Revision ID: 0079_commission_settlements
Revises: 0078_sales_commissions
Create Date: 2026-11-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0079_commission_settlements'
down_revision: Union[str, None] = '0078_sales_commissions'
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

    if 'finance_commission_settlements' not in tables:
        op.create_table(
            'finance_commission_settlements',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('salesperson_id', sa.Integer(), sa.ForeignKey('finance_salespeople.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('period_start', sa.String(20), nullable=False),
            sa.Column('period_end', sa.String(20), nullable=False),
            sa.Column('settled_date', sa.String(20), nullable=False),
            sa.Column('reference', sa.String(255), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('settled_by', sa.String(255), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='settled'),
            sa.Column('undone_at', sa.DateTime(), nullable=True),
            sa.Column('undone_by', sa.String(255), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.CheckConstraint("status IN ('settled', 'undone')", name='ck_finance_commission_settlements_status'),
            sa.CheckConstraint(_DATE_OK.format(c='period_start'), name='ck_dt_finance_commission_settlements_period_start'),
            sa.CheckConstraint(_DATE_OK.format(c='period_end'), name='ck_dt_finance_commission_settlements_period_end'),
            sa.CheckConstraint(_DATE_OK.format(c='settled_date'), name='ck_dt_finance_commission_settlements_settled_date'),
        )
        op.create_index('ix_finance_commission_settlements_salesperson_id', 'finance_commission_settlements', ['salesperson_id'])
        op.create_index('ix_finance_commission_settlements_status', 'finance_commission_settlements', ['status'])

    insp = sa.inspect(bind)
    comm_cols = {c['name'] for c in insp.get_columns('finance_sales_commissions')}
    if 'settlement_id' not in comm_cols:
        with op.batch_alter_table('finance_sales_commissions') as b:
            b.add_column(sa.Column('settlement_id', sa.Integer(), nullable=True))
            b.create_foreign_key('fk_finance_sales_commissions_settlement_id', 'finance_commission_settlements', ['settlement_id'], ['id'], ondelete='RESTRICT')
            b.create_index('ix_finance_sales_commissions_settlement_id', ['settlement_id'])

    sp_cols = {c['name'] for c in insp.get_columns('finance_salespeople')}
    if 'settlement_frequency' not in sp_cols:
        with op.batch_alter_table('finance_salespeople') as b:
            b.add_column(sa.Column('settlement_frequency', sa.String(10), nullable=False, server_default='quarterly'))
            b.create_check_constraint('ck_finance_salespeople_settlement_frequency', "settlement_frequency IN ('monthly', 'quarterly')")
        op.execute(sa.text("UPDATE finance_salespeople SET settlement_frequency = 'monthly' WHERE employee_id IS NOT NULL"))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'settlement_frequency' in {c['name'] for c in insp.get_columns('finance_salespeople')}:
        checks = [c['name'] for c in insp.get_check_constraints('finance_salespeople') if c.get('name') == 'ck_finance_salespeople_settlement_frequency']
        with op.batch_alter_table('finance_salespeople') as b:
            for name in checks:
                b.drop_constraint(name, type_='check')
            b.drop_column('settlement_frequency')
    if 'settlement_id' in {c['name'] for c in insp.get_columns('finance_sales_commissions')}:
        fks = [f['name'] for f in insp.get_foreign_keys('finance_sales_commissions') if f['constrained_columns'] == ['settlement_id'] and f['name']]
        indexes = {i['name'] for i in insp.get_indexes('finance_sales_commissions')}
        with op.batch_alter_table('finance_sales_commissions') as b:
            if 'ix_finance_sales_commissions_settlement_id' in indexes:
                b.drop_index('ix_finance_sales_commissions_settlement_id')
            for name in fks:
                b.drop_constraint(name, type_='foreignkey')
            b.drop_column('settlement_id')
    if 'finance_commission_settlements' in set(insp.get_table_names()):
        op.drop_table('finance_commission_settlements')
