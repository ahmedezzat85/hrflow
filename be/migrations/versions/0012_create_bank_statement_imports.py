"""0012_create_bank_statement_imports

Revision ID: 0012_create_bank_statement_imports
Revises: 0011_create_subscription_charges_and_finance_attachments
Create Date: 2026-09-11 19:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0012_create_bank_statement_imports'
down_revision: Union[str, None] = '0011_create_subscription_charges_and_finance_attachments'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Create finance_statement_imports table
    if 'finance_statement_imports' not in tables:
        op.create_table(
            'finance_statement_imports',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('account_id', sa.Integer(), sa.ForeignKey('finance_bank_accounts.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('period_month', sa.String(length=10), nullable=False),
            sa.Column('file_type', sa.String(length=10), nullable=False, server_default='csv'),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='needs_review'),
            sa.Column('uploaded_file_ref', sa.String(length=500), nullable=False, server_default=''),
            sa.Column('total_lines_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('matched_lines_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('reconciled_at', sa.DateTime(), nullable=True),
            sa.Column('reconciled_by', sa.String(length=255), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('created_by', sa.String(length=255), nullable=True),
        )
        op.create_index(op.f('ix_finance_statement_imports_account_id'), 'finance_statement_imports', ['account_id'], unique=False)
        op.create_index(op.f('ix_finance_statement_imports_period_month'), 'finance_statement_imports', ['period_month'], unique=False)
        op.create_index(op.f('ix_finance_statement_imports_status'), 'finance_statement_imports', ['status'], unique=False)

    # 2. Create finance_statement_lines table
    if 'finance_statement_lines' not in tables:
        op.create_table(
            'finance_statement_lines',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('import_id', sa.Integer(), sa.ForeignKey('finance_statement_imports.id', ondelete='CASCADE'), nullable=False),
            sa.Column('raw_date', sa.String(length=20), nullable=False),
            sa.Column('raw_amount', sa.Float(), nullable=False),
            sa.Column('direction', sa.String(length=10), nullable=False, server_default='out'),
            sa.Column('raw_description', sa.String(length=500), nullable=False, server_default=''),
            sa.Column('raw_reference', sa.String(length=100), nullable=True, server_default=''),
            sa.Column('matched_transaction_id', sa.Integer(), sa.ForeignKey('finance_ledger_transactions.id', ondelete='SET NULL'), nullable=True),
            sa.Column('matched_cheque_id', sa.Integer(), sa.ForeignKey('finance_cheques.id', ondelete='SET NULL'), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='unmatched'),
            sa.Column('notes', sa.Text(), nullable=False, server_default=''),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
        op.create_index(op.f('ix_finance_statement_lines_import_id'), 'finance_statement_lines', ['import_id'], unique=False)
        op.create_index(op.f('ix_finance_statement_lines_raw_date'), 'finance_statement_lines', ['raw_date'], unique=False)
        op.create_index(op.f('ix_finance_statement_lines_matched_transaction_id'), 'finance_statement_lines', ['matched_transaction_id'], unique=False)
        op.create_index(op.f('ix_finance_statement_lines_matched_cheque_id'), 'finance_statement_lines', ['matched_cheque_id'], unique=False)
        op.create_index(op.f('ix_finance_statement_lines_status'), 'finance_statement_lines', ['status'], unique=False)


def downgrade() -> None:
    op.drop_table('finance_statement_lines')
    op.drop_table('finance_statement_imports')
