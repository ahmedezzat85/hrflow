"""0036_cheque_attachments

Finance expansion X1 (D-032): cheque scans. Adds finance_attachments.cheque_id (CASCADE) and
creates one attachment row for every non-empty finance_cheques.attachment_url. The attachment_url
column is kept (deprecated, no longer written).

Revision ID: 0036_cheque_attachments
Revises: 0035_category_color
Create Date: 2026-10-18 12:00:00.000000

"""
import os
from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = '0036_cheque_attachments'
down_revision: Union[str, None] = '0035_category_color'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if 'finance_attachments' not in tables:
        return

    columns = {c['name'] for c in insp.get_columns('finance_attachments')}
    if 'cheque_id' not in columns:
        with op.batch_alter_table('finance_attachments') as batch_op:
            batch_op.add_column(sa.Column('cheque_id', sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                'fk_finance_attachments_cheque_id', 'finance_cheques', ['cheque_id'], ['id'], ondelete='CASCADE'
            )
            batch_op.create_index('ix_finance_attachments_cheque_id', ['cheque_id'])

    if 'finance_cheques' not in tables:
        return
    rows = bind.execute(
        text(
            "SELECT id, attachment_url, created_by FROM finance_cheques "
            "WHERE attachment_url IS NOT NULL AND TRIM(attachment_url) <> ''"
        )
    ).fetchall()
    for cheque_id, url, created_by in rows:
        exists = bind.execute(
            text("SELECT 1 FROM finance_attachments WHERE cheque_id = :c AND storage_ref = :r"),
            {"c": cheque_id, "r": url},
        ).first()
        if exists:
            continue
        name = os.path.basename(url.replace(chr(92), '/').rstrip('/')) or 'cheque-scan'
        bind.execute(
            text(
                "INSERT INTO finance_attachments "
                "(cheque_id, file_name, file_size, mime_type, storage_ref, uploaded_at, uploaded_by) "
                "VALUES (:c, :n, 0, 'application/octet-stream', :r, :t, :u)"
            ),
            {"c": cheque_id, "n": name[:255], "r": url[:500], "t": datetime.utcnow(), "u": created_by},
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'finance_attachments' not in set(insp.get_table_names()):
        return
    columns = {c['name'] for c in insp.get_columns('finance_attachments')}
    if 'cheque_id' in columns:
        # Migrated attachment_url values are still on finance_cheques, so dropping the scan rows loses nothing from the old column.
        bind.execute(text("DELETE FROM finance_attachments WHERE cheque_id IS NOT NULL"))
        # The index/FK may be named differently when the column came from create_all(); dropping the column
        # removes its FK, and the index is dropped first only when it exists under the expected name.
        index_names = {i['name'] for i in insp.get_indexes('finance_attachments')}
        with op.batch_alter_table('finance_attachments') as batch_op:
            if 'ix_finance_attachments_cheque_id' in index_names:
                batch_op.drop_index('ix_finance_attachments_cheque_id')
            batch_op.drop_column('cheque_id')
