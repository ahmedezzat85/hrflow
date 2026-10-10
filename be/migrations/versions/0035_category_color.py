"""0035_category_color

Finance restyle v2, slice BE-1 (D-027): add color column to finance_transaction_categories
and backfill existing categories in sort_order, id order with the 8-color palette.

Revision ID: 0035_category_color
Revises: 0034_payroll_ledger_source
Create Date: 2026-10-10 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = '0035_category_color'
down_revision: Union[str, None] = '0034_payroll_ledger_source'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CATEGORY_PALETTE = ("blue", "orange", "teal", "violet", "green", "pink", "sky", "ochre")


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if 'finance_transaction_categories' not in tables:
        return

    columns = {c['name'] for c in insp.get_columns('finance_transaction_categories')}
    if 'color' not in columns:
        with op.batch_alter_table('finance_transaction_categories') as batch_op:
            batch_op.add_column(sa.Column('color', sa.String(16), nullable=True))

    rows = bind.execute(
        text("SELECT id FROM finance_transaction_categories ORDER BY sort_order ASC, id ASC")
    ).fetchall()
    for idx, (cat_id,) in enumerate(rows):
        color = CATEGORY_PALETTE[idx % len(CATEGORY_PALETTE)]
        bind.execute(
            text("UPDATE finance_transaction_categories SET color = :c WHERE id = :id"),
            {"c": color, "id": cat_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if 'finance_transaction_categories' not in tables:
        return

    columns = {c['name'] for c in insp.get_columns('finance_transaction_categories')}
    if 'color' in columns:
        with op.batch_alter_table('finance_transaction_categories') as batch_op:
            batch_op.drop_column('color')
