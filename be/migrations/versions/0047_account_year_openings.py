"""0047_account_year_openings

Fiscal-year opening balances (BI-1, D-043): new table `finance_account_year_openings`, one row per
(account, fiscal year) holding an owner-entered opening balance (may be negative) and an optional note.
No backfill and no change to `finance_bank_accounts`: accounts without rows behave exactly as before.
Idempotent; the downgrade drops the table.

Revision ID: 0047_account_year_openings
Revises: 0046_payroll_rate_settings
Create Date: 2026-10-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0047_account_year_openings'
down_revision: Union[str, None] = '0046_payroll_rate_settings'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'finance_account_year_openings' in insp.get_table_names():
        return
    op.create_table(
        'finance_account_year_openings',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('account_id', sa.Integer(), sa.ForeignKey('finance_bank_accounts.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('opening_balance', sa.Float(), nullable=False),
        sa.Column('note', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('updated_by', sa.String(length=255), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.UniqueConstraint('account_id', 'fiscal_year', name='uq_finance_account_year_opening'),
    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'finance_account_year_openings' in insp.get_table_names():
        op.drop_table('finance_account_year_openings')
