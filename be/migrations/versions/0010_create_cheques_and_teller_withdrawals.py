"""0010_create_cheques_and_teller_withdrawals

Revision ID: 0010_create_cheques_and_teller_withdrawals
Revises: 0009_invoice_expected_bank_and_channel
Create Date: 2026-09-10 13:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0010_create_cheques_and_teller_withdrawals'
down_revision: Union[str, None] = '0009_invoice_expected_bank_and_channel'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Create finance_cheques table
    if 'finance_cheques' not in tables:
        op.create_table(
            'finance_cheques',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('cheque_number', sa.String(length=50), nullable=False),
            sa.Column('account_id', sa.Integer(), sa.ForeignKey('finance_bank_accounts.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('issue_date', sa.String(length=20), nullable=False),
            sa.Column('amount', sa.Float(), nullable=False),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('payee', sa.String(length=255), nullable=False),
            sa.Column('purpose_type', sa.String(length=50), nullable=False, server_default='other'),
            sa.Column('destination_cash_account_id', sa.Integer(), sa.ForeignKey('finance_bank_accounts.id', ondelete='SET NULL'), nullable=True),
            sa.Column('linked_bill_id', sa.Integer(), sa.ForeignKey('finance_bills.id', ondelete='SET NULL'), nullable=True),
            sa.Column('status', sa.String(length=30), nullable=False, server_default='issued'),
            sa.Column('clear_date', sa.String(length=20), nullable=True),
            sa.Column('fiscal_year', sa.Integer(), nullable=False),
            sa.Column('linked_transaction_id', sa.Integer(), sa.ForeignKey('finance_ledger_transactions.id', ondelete='SET NULL'), nullable=True),
            sa.Column('linked_cash_transaction_id', sa.Integer(), sa.ForeignKey('finance_ledger_transactions.id', ondelete='SET NULL'), nullable=True),
            sa.Column('notes', sa.Text(), nullable=False, server_default=''),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('created_by', sa.String(length=255), nullable=True),
            sa.UniqueConstraint('account_id', 'cheque_number', name='uq_cheque_account_number'),
        )
        op.create_index(op.f('ix_finance_cheques_account_id'), 'finance_cheques', ['account_id'], unique=False)
        op.create_index(op.f('ix_finance_cheques_issue_date'), 'finance_cheques', ['issue_date'], unique=False)
        op.create_index(op.f('ix_finance_cheques_payee'), 'finance_cheques', ['payee'], unique=False)
        op.create_index(op.f('ix_finance_cheques_purpose_type'), 'finance_cheques', ['purpose_type'], unique=False)
        op.create_index(op.f('ix_finance_cheques_status'), 'finance_cheques', ['status'], unique=False)
        op.create_index(op.f('ix_finance_cheques_fiscal_year'), 'finance_cheques', ['fiscal_year'], unique=False)
        op.create_index(op.f('ix_finance_cheques_destination_cash_account_id'), 'finance_cheques', ['destination_cash_account_id'], unique=False)
        op.create_index(op.f('ix_finance_cheques_linked_bill_id'), 'finance_cheques', ['linked_bill_id'], unique=False)

    # 2. Add columns to finance_ledger_transactions
    if 'finance_ledger_transactions' in tables:
        cols = [c['name'] for c in inspector.get_columns('finance_ledger_transactions')]
        with op.batch_alter_table('finance_ledger_transactions') as batch_op:
            if 'cheque_number' not in cols:
                batch_op.add_column(sa.Column('cheque_number', sa.String(length=50), nullable=True))
                batch_op.create_index(op.f('ix_finance_ledger_transactions_cheque_number'), ['cheque_number'], unique=False)
            if 'linked_cheque_id' not in cols:
                batch_op.add_column(sa.Column('linked_cheque_id', sa.Integer(), nullable=True))
                batch_op.create_index(op.f('ix_finance_ledger_transactions_linked_cheque_id'), ['linked_cheque_id'], unique=False)
                batch_op.create_foreign_key('fk_ledger_cheque', 'finance_cheques', ['linked_cheque_id'], ['id'], ondelete='SET NULL')
            if 'destination_cash_account_id' not in cols:
                batch_op.add_column(sa.Column('destination_cash_account_id', sa.Integer(), nullable=True))
                batch_op.create_foreign_key('fk_ledger_dest_cash', 'finance_bank_accounts', ['destination_cash_account_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_ledger_transactions' in tables:
        with op.batch_alter_table('finance_ledger_transactions') as batch_op:
            batch_op.drop_column('destination_cash_account_id')
            batch_op.drop_column('linked_cheque_id')
            batch_op.drop_column('cheque_number')

    if 'finance_cheques' in tables:
        op.drop_table('finance_cheques')
