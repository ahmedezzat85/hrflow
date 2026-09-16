"""0015_fux_410_statutory_obligations

Revision ID: 0015_fux_410_statutory_obligations
Revises: 0014_fux_409_standard_payment_method_naming
Create Date: 2026-09-16 11:30:00.000000

"""
from typing import Sequence, Union
from datetime import datetime
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0015_fux_410_statutory_obligations'
down_revision: Union[str, None] = '0014_fux_409_standard_payment_method_naming'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_statutory_obligations' not in tables:
        op.create_table(
            'finance_statutory_obligations',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('obligation_type', sa.String(length=50), nullable=False, index=True),
            sa.Column('period', sa.String(length=20), nullable=False, index=True),
            sa.Column('amount_estimated', sa.Float(), nullable=True),
            sa.Column('amount_accrued', sa.Float(), nullable=False),
            sa.Column('amount_remitted', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('variance_amount', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('variance_note', sa.Text(), nullable=True),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('status', sa.String(length=30), nullable=False, server_default='estimated', index=True),
            sa.Column('due_date', sa.String(length=20), nullable=True, index=True),
            sa.Column('source_type', sa.String(length=30), nullable=False, server_default='manual', index=True),
            sa.Column('source_id', sa.Integer(), nullable=True, index=True),
            sa.Column('notes', sa.Text(), nullable=False, server_default=''),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        )

    # Check and add columns on existing tables
    if 'finance_ledger_transactions' in tables:
        cols = {c['name'] for c in inspector.get_columns('finance_ledger_transactions')}
        if 'linked_statutory_obligation_id' not in cols:
            op.add_column(
                'finance_ledger_transactions',
                sa.Column('linked_statutory_obligation_id', sa.Integer(), sa.ForeignKey('finance_statutory_obligations.id', ondelete='SET NULL'), nullable=True)
            )

    if 'finance_payments' in tables:
        cols = {c['name'] for c in inspector.get_columns('finance_payments')}
        if 'related_statutory_obligation_id' not in cols:
            op.add_column(
                'finance_payments',
                sa.Column('related_statutory_obligation_id', sa.Integer(), sa.ForeignKey('finance_statutory_obligations.id', ondelete='SET NULL'), nullable=True)
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_payments' in tables:
        cols = {c['name'] for c in inspector.get_columns('finance_payments')}
        if 'related_statutory_obligation_id' in cols:
            op.drop_column('finance_payments', 'related_statutory_obligation_id')

    if 'finance_ledger_transactions' in tables:
        cols = {c['name'] for c in inspector.get_columns('finance_ledger_transactions')}
        if 'linked_statutory_obligation_id' in cols:
            op.drop_column('finance_ledger_transactions', 'linked_statutory_obligation_id')

    if 'finance_statutory_obligations' in tables:
        op.drop_table('finance_statutory_obligations')
