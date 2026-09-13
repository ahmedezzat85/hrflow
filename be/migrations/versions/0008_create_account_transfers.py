"""0008_create_account_transfers

Revision ID: 0008_create_account_transfers
Revises: 0007_categories_payment_types_ledger_v2
Create Date: 2026-09-09 17:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0008_create_account_transfers'
down_revision: Union[str, None] = '0007_categories_payment_types_ledger_v2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Create finance_account_transfers table
    if 'finance_account_transfers' not in tables:
        op.create_table(
            'finance_account_transfers',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('from_account_id', sa.Integer(), nullable=True),
            sa.Column('to_account_id', sa.Integer(), nullable=True),
            sa.Column('date', sa.String(length=20), nullable=False),
            sa.Column('from_amount', sa.Float(), nullable=False),
            sa.Column('from_currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('to_amount', sa.Float(), nullable=False),
            sa.Column('to_currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('fx_rate', sa.Float(), nullable=True),
            sa.Column('transfer_type', sa.String(length=30), nullable=False, server_default='internal'),
            sa.Column('exchange_reference', sa.String(length=100), nullable=True),
            sa.Column('confirmed_leg', sa.String(length=20), nullable=False, server_default='both'),
            sa.Column('note', sa.Text(), nullable=False, server_default=''),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('created_by', sa.String(length=255), nullable=True),
            sa.ForeignKeyConstraint(['from_account_id'], ['finance_bank_accounts.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['to_account_id'], ['finance_bank_accounts.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_account_transfers_from_account_id'), 'finance_account_transfers', ['from_account_id'], unique=False)
        op.create_index(op.f('ix_finance_account_transfers_to_account_id'), 'finance_account_transfers', ['to_account_id'], unique=False)
        op.create_index(op.f('ix_finance_account_transfers_date'), 'finance_account_transfers', ['date'], unique=False)
        op.create_index(op.f('ix_finance_account_transfers_transfer_type'), 'finance_account_transfers', ['transfer_type'], unique=False)
        op.create_index(op.f('ix_finance_account_transfers_exchange_reference'), 'finance_account_transfers', ['exchange_reference'], unique=False)

    # 2. Add linked_transfer_id to finance_ledger_transactions
    if 'finance_ledger_transactions' in tables:
        cols = [c['name'] for c in inspector.get_columns('finance_ledger_transactions')]
        if 'linked_transfer_id' not in cols:
            op.add_column(
                'finance_ledger_transactions',
                sa.Column('linked_transfer_id', sa.Integer(), nullable=True)
            )
            op.create_index(
                op.f('ix_finance_ledger_transactions_linked_transfer_id'),
                'finance_ledger_transactions',
                ['linked_transfer_id'],
                unique=False
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_ledger_transactions' in tables:
        cols = [c['name'] for c in inspector.get_columns('finance_ledger_transactions')]
        if 'linked_transfer_id' in cols:
            op.drop_index(op.f('ix_finance_ledger_transactions_linked_transfer_id'), table_name='finance_ledger_transactions')
            op.drop_column('finance_ledger_transactions', 'linked_transfer_id')

    if 'finance_account_transfers' in tables:
        op.drop_index(op.f('ix_finance_account_transfers_exchange_reference'), table_name='finance_account_transfers')
        op.drop_index(op.f('ix_finance_account_transfers_transfer_type'), table_name='finance_account_transfers')
        op.drop_index(op.f('ix_finance_account_transfers_date'), table_name='finance_account_transfers')
        op.drop_index(op.f('ix_finance_account_transfers_to_account_id'), table_name='finance_account_transfers')
        op.drop_index(op.f('ix_finance_account_transfers_from_account_id'), table_name='finance_account_transfers')
        op.drop_table('finance_account_transfers')
