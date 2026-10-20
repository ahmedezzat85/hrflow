"""0041_import_batches

Bulk / historical import (D-033, slice I0): the `finance_import_batches` table and a nullable `import_batch_id`
on bills, cheques and sales invoices, so a batch's still-untouched Drafts can be listed or discarded together.
Existing rows keep NULL. Idempotent; the downgrade drops the columns and the table (no other data is touched).

Revision ID: 0041_import_batches
Revises: 0040_subscriptions_v2
Create Date: 2026-10-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0041_import_batches'
down_revision: Union[str, None] = '0040_subscriptions_v2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TARGET_TABLES = ('finance_bills', 'finance_cheques', 'finance_sales_invoices')


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if 'finance_import_batches' not in tables:
        op.create_table(
            'finance_import_batches',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('kind', sa.String(20), nullable=False),
            sa.Column('created_by', sa.String(255), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('manifest_name', sa.String(255), nullable=True),
            sa.Column('archive_name', sa.String(255), nullable=True),
            sa.Column('rows_total', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('rows_created', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('rows_failed', sa.Integer(), nullable=False, server_default='0'),
        )
        op.create_index('ix_finance_import_batches_kind', 'finance_import_batches', ['kind'])

    for table in TARGET_TABLES:
        if table not in tables:
            continue
        cols = {c['name'] for c in insp.get_columns(table)}
        if 'import_batch_id' in cols:
            continue
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(sa.Column('import_batch_id', sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                f'fk_{table}_import_batch_id', 'finance_import_batches', ['import_batch_id'], ['id'], ondelete='SET NULL'
            )
            batch_op.create_index(f'ix_{table}_import_batch_id', ['import_batch_id'])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    for table in reversed(TARGET_TABLES):
        if table not in tables:
            continue
        cols = {c['name'] for c in insp.get_columns(table)}
        if 'import_batch_id' not in cols:
            continue
        idx = {i['name'] for i in insp.get_indexes(table)}
        fks = {fk['name'] for fk in insp.get_foreign_keys(table)}
        with op.batch_alter_table(table) as batch_op:
            if f'ix_{table}_import_batch_id' in idx:
                batch_op.drop_index(f'ix_{table}_import_batch_id')
            if f'fk_{table}_import_batch_id' in fks:
                batch_op.drop_constraint(f'fk_{table}_import_batch_id', type_='foreignkey')
            batch_op.drop_column('import_batch_id')

    if 'finance_import_batches' in tables:
        op.drop_table('finance_import_batches')
