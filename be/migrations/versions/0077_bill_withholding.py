"""0077_bill_withholding

Withholding tax on a vendor bill (D-024 amendment): adds `finance_bills.withholding_amount` (NOT NULL, default 0). A bill
with a withholding amount is settled by one payment of total - withholding, recorded with `finance_payments.withheld_amount`
(added by 0033). Existing and imported bills stay at 0, so nothing about them changes.

A database built from scratch may already hold the column as a nullable one (0013 adds missing model columns that way); the
upgrade then fills NULLs with 0 and makes it NOT NULL. The downgrade drops the column.

Revision ID: 0077_bill_withholding
Revises: 0076_transfer_void
Create Date: 2026-11-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0077_bill_withholding'
down_revision: Union[str, None] = '0076_transfer_void'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "finance_bills"
COLUMN = "withholding_amount"


def _column(bind):
    return next((c for c in sa.inspect(bind).get_columns(TABLE) if c["name"] == COLUMN), None)


def upgrade() -> None:
    bind = op.get_bind()
    col = _column(bind)
    if col is None:
        with op.batch_alter_table(TABLE) as b:
            b.add_column(sa.Column(COLUMN, sa.Numeric(18, 4), nullable=False, server_default="0"))
    elif col["nullable"]:
        op.execute(sa.text(f"UPDATE {TABLE} SET {COLUMN} = 0 WHERE {COLUMN} IS NULL"))
        with op.batch_alter_table(TABLE) as b:
            b.alter_column(COLUMN, existing_type=sa.Numeric(18, 4), nullable=False, server_default="0")


def downgrade() -> None:
    if _column(op.get_bind()) is not None:
        with op.batch_alter_table(TABLE) as b:
            b.drop_column(COLUMN)
