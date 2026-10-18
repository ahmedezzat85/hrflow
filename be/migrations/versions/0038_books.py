"""0038_books

Finance expansion X2 (D-028): company books, account visibility, balance checkpoints, intercompany customers.
Every existing account is backfilled into the Local (default) book, so no existing report changes.

Revision ID: 0038_books
Revises: 0037_products
Create Date: 2026-10-18 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = '0038_books'
down_revision: Union[str, None] = '0037_products'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if 'finance_books' not in tables:
        op.create_table(
            'finance_books',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('code', sa.String(20), nullable=False),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index('ix_finance_books_code', 'finance_books', ['code'], unique=True)
    for code, name, default in (('local', 'Local', True), ('overseas', 'Overseas', False)):
        if not bind.execute(text("SELECT 1 FROM finance_books WHERE code = :c"), {"c": code}).first():
            bind.execute(text("INSERT INTO finance_books (code, name, is_default) VALUES (:c, :n, :d)"), {"c": code, "n": name, "d": default})
    local_id = bind.execute(text("SELECT id FROM finance_books WHERE code = 'local'")).scalar()

    if 'finance_bank_accounts' in tables:
        cols = {c['name'] for c in insp.get_columns('finance_bank_accounts')}
        if 'book_id' not in cols or 'visibility' not in cols:
            with op.batch_alter_table('finance_bank_accounts') as batch_op:
                if 'book_id' not in cols:
                    batch_op.add_column(sa.Column('book_id', sa.Integer(), nullable=True))
                    batch_op.create_foreign_key('fk_bank_accounts_book_id', 'finance_books', ['book_id'], ['id'], ondelete='RESTRICT')
                    batch_op.create_index('ix_finance_bank_accounts_book_id', ['book_id'])
                if 'visibility' not in cols:
                    batch_op.add_column(sa.Column('visibility', sa.String(20), nullable=False, server_default='full'))
        bind.execute(text("UPDATE finance_bank_accounts SET book_id = :b WHERE book_id IS NULL"), {"b": local_id})
        with op.batch_alter_table('finance_bank_accounts') as batch_op:
            batch_op.alter_column('book_id', existing_type=sa.Integer(), nullable=False)

    if 'finance_account_balance_checkpoints' not in tables:
        op.create_table(
            'finance_account_balance_checkpoints',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('account_id', sa.Integer(), sa.ForeignKey('finance_bank_accounts.id', ondelete='CASCADE'), nullable=False),
            sa.Column('date', sa.String(20), nullable=False),
            sa.Column('balance', sa.Float(), nullable=False),
            sa.Column('note', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('created_by', sa.String(255), nullable=True),
        )
        op.create_index('ix_finance_account_balance_checkpoints_account_id', 'finance_account_balance_checkpoints', ['account_id'])
        op.create_index('ix_finance_account_balance_checkpoints_date', 'finance_account_balance_checkpoints', ['date'])

    if 'finance_attachments' in tables:
        acols = {c['name'] for c in insp.get_columns('finance_attachments')}
        if 'checkpoint_id' not in acols:
            with op.batch_alter_table('finance_attachments') as batch_op:
                batch_op.add_column(sa.Column('checkpoint_id', sa.Integer(), nullable=True))
                batch_op.create_foreign_key('fk_finance_attachments_checkpoint_id', 'finance_account_balance_checkpoints', ['checkpoint_id'], ['id'], ondelete='CASCADE')
                batch_op.create_index('ix_finance_attachments_checkpoint_id', ['checkpoint_id'])

    if 'finance_customers' in tables:
        ccols = {c['name'] for c in insp.get_columns('finance_customers')}
        if 'is_intercompany' not in ccols:
            with op.batch_alter_table('finance_customers') as batch_op:
                batch_op.add_column(sa.Column('is_intercompany', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if 'finance_customers' in tables and 'is_intercompany' in {c['name'] for c in insp.get_columns('finance_customers')}:
        with op.batch_alter_table('finance_customers') as batch_op:
            batch_op.drop_column('is_intercompany')

    if 'finance_attachments' in tables and 'checkpoint_id' in {c['name'] for c in insp.get_columns('finance_attachments')}:
        bind.execute(text("DELETE FROM finance_attachments WHERE checkpoint_id IS NOT NULL"))
        idx = {i['name'] for i in insp.get_indexes('finance_attachments')}
        with op.batch_alter_table('finance_attachments') as batch_op:
            if 'ix_finance_attachments_checkpoint_id' in idx:
                batch_op.drop_index('ix_finance_attachments_checkpoint_id')
            batch_op.drop_column('checkpoint_id')

    if 'finance_account_balance_checkpoints' in tables:
        op.drop_table('finance_account_balance_checkpoints')

    if 'finance_bank_accounts' in tables:
        cols = {c['name'] for c in insp.get_columns('finance_bank_accounts')}
        idx = {i['name'] for i in insp.get_indexes('finance_bank_accounts')}
        with op.batch_alter_table('finance_bank_accounts') as batch_op:
            if 'ix_finance_bank_accounts_book_id' in idx:
                batch_op.drop_index('ix_finance_bank_accounts_book_id')
            if 'visibility' in cols:
                batch_op.drop_column('visibility')
            if 'book_id' in cols:
                batch_op.drop_column('book_id')

    if 'finance_books' in tables:
        op.drop_table('finance_books')
