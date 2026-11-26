"""0082_audit_log_target_index

The activity drawer and the audit-log page now read audit rows for one record (target_type, target_id) and page by
id instead of loading the whole table (audit 2026-11, M-5). This index serves the per-record lookup.

Revision ID: 0082_audit_log_target_index
Revises: 0081_invoice_actors
Create Date: 2026-11-26
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0082_audit_log_target_index'
down_revision: Union[str, None] = '0081_invoice_actors'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX = 'ix_audit_log_target'


def upgrade() -> None:
    existing = {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('audit_log')}
    if INDEX not in existing:
        op.create_index(INDEX, 'audit_log', ['target_type', 'target_id'])


def downgrade() -> None:
    existing = {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('audit_log')}
    if INDEX in existing:
        op.drop_index(INDEX, table_name='audit_log')
