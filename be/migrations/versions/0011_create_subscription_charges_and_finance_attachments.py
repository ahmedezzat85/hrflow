"""0011_create_subscription_charges_and_finance_attachments

Revision ID: 0011_create_subscription_charges_and_finance_attachments
Revises: 0010_create_cheques_and_teller_withdrawals
Create Date: 2026-09-11 15:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0011_create_subscription_charges_and_finance_attachments'
down_revision: Union[str, None] = '0010_create_cheques_and_teller_withdrawals'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Create finance_subscription_charges table
    if 'finance_subscription_charges' not in tables:
        op.create_table(
            'finance_subscription_charges',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('subscription_id', sa.Integer(), sa.ForeignKey('finance_subscriptions.id', ondelete='CASCADE'), nullable=False),
            sa.Column('billing_date', sa.String(length=20), nullable=False),
            sa.Column('amount', sa.Float(), nullable=False),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('linked_transaction_id', sa.Integer(), sa.ForeignKey('finance_ledger_transactions.id', ondelete='SET NULL'), nullable=True),
            sa.Column('note', sa.Text(), nullable=False, server_default=''),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('created_by', sa.String(length=255), nullable=True),
        )
        op.create_index(op.f('ix_finance_subscription_charges_subscription_id'), 'finance_subscription_charges', ['subscription_id'], unique=False)
        op.create_index(op.f('ix_finance_subscription_charges_billing_date'), 'finance_subscription_charges', ['billing_date'], unique=False)
        op.create_index(op.f('ix_finance_subscription_charges_linked_transaction_id'), 'finance_subscription_charges', ['linked_transaction_id'], unique=False)

    # 2. Create finance_attachments table
    if 'finance_attachments' not in tables:
        op.create_table(
            'finance_attachments',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('subscription_charge_id', sa.Integer(), sa.ForeignKey('finance_subscription_charges.id', ondelete='CASCADE'), nullable=True),
            sa.Column('statement_import_id', sa.Integer(), nullable=True),
            sa.Column('ledger_transaction_id', sa.Integer(), sa.ForeignKey('finance_ledger_transactions.id', ondelete='CASCADE'), nullable=True),
            sa.Column('file_name', sa.String(length=255), nullable=False),
            sa.Column('file_size', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('mime_type', sa.String(length=100), nullable=False, server_default='application/octet-stream'),
            sa.Column('storage_ref', sa.String(length=500), nullable=False),
            sa.Column('uploaded_at', sa.DateTime(), nullable=True),
            sa.Column('uploaded_by', sa.String(length=255), nullable=True),
        )
        op.create_index(op.f('ix_finance_attachments_subscription_charge_id'), 'finance_attachments', ['subscription_charge_id'], unique=False)
        op.create_index(op.f('ix_finance_attachments_ledger_transaction_id'), 'finance_attachments', ['ledger_transaction_id'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_attachments' in tables:
        op.drop_table('finance_attachments')

    if 'finance_subscription_charges' in tables:
        op.drop_table('finance_subscription_charges')
