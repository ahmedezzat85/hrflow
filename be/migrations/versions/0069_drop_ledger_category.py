"""0069_drop_ledger_category

Database redesign, Stage 6b: drops the legacy `finance_ledger_transactions.category` text column.

Migration 0006 created it (`varchar(100) NOT NULL DEFAULT 'other'`) before ledger rows had a real category. The category is
`category_id` (migration 0007) and the model has not had the text column for a long time, so every row written since holds the
default 'other' (older rows 'revenue' or 'cost', derived from the direction). Nothing reads it. A database built on the current
models never has the column, so the upgrade does nothing there.

The downgrade adds the column back as `NOT NULL DEFAULT 'other'`, filled with the name of the row's category (or 'other').

Revision ID: 0069_drop_ledger_category
Revises: 0068_bill_scans
Create Date: 2026-11-08 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0069_drop_ledger_category'
down_revision: Union[str, None] = '0068_bill_scans'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column() -> bool:
    insp = sa.inspect(op.get_bind())
    return "finance_ledger_transactions" in insp.get_table_names() and \
        "category" in {c["name"] for c in insp.get_columns("finance_ledger_transactions")}


def upgrade() -> None:
    if _has_column():
        with op.batch_alter_table("finance_ledger_transactions") as batch_op:
            batch_op.drop_column("category")


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "finance_ledger_transactions" not in insp.get_table_names() or _has_column():
        return
    with op.batch_alter_table("finance_ledger_transactions") as batch_op:
        batch_op.add_column(sa.Column("category", sa.String(100), nullable=False, server_default="other"))
    op.get_bind().execute(sa.text(
        "UPDATE finance_ledger_transactions SET category = COALESCE("
        "(SELECT c.name FROM finance_transaction_categories c WHERE c.id = finance_ledger_transactions.category_id), 'other')"))
