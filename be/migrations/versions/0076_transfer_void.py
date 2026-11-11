"""0076_transfer_void

Void a wrong account transfer (D-054): adds voided_at, voided_by and void_reason to `finance_account_transfers`.
A voided transfer keeps its row (hidden by default); its ledger rows are deleted by the void action and balances recomputed.
Existing transfers are unaffected (voided_at stays NULL). Migration 0013 may already have added a column from the live
models, so each column is added only when missing. The downgrade drops the columns.

Revision ID: 0076_transfer_void
Revises: 0075_claim_payment
Create Date: 2026-11-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0076_transfer_void'
down_revision: Union[str, None] = '0075_claim_payment'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "finance_account_transfers"
INDEX = "ix_finance_account_transfers_voided_at"


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns(TABLE)}
    with op.batch_alter_table(TABLE) as b:
        if "voided_at" not in cols:
            b.add_column(sa.Column("voided_at", sa.DateTime(), nullable=True))
        if "voided_by" not in cols:
            b.add_column(sa.Column("voided_by", sa.String(255), nullable=True))
        if "void_reason" not in cols:
            b.add_column(sa.Column("void_reason", sa.Text(), nullable=True))
    if INDEX not in {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(TABLE)}:
        op.create_index(INDEX, TABLE, ["voided_at"])


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if INDEX in {i["name"] for i in insp.get_indexes(TABLE)}:
        op.drop_index(INDEX, table_name=TABLE)
    cols = {c["name"] for c in insp.get_columns(TABLE)}
    with op.batch_alter_table(TABLE) as b:
        for col in ("void_reason", "voided_by", "voided_at"):
            if col in cols:
                b.drop_column(col)
