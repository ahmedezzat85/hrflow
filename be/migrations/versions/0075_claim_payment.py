"""0075_claim_payment

Insurance claim payment link (D-053, proposed): an approved claim can be paid from a company account, which posts one ledger row.
Adds to `insurance_claims`:
  payment_status                    unpaid (default) | paid | reversed, checked by ck_insurance_claims_payment_status
  paid_at, paid_by_user_id          when and by whom the current payment was recorded
  ledger_transaction_id             the ledger row of the current payment (unique; a row can back one claim only)
  payment_reversal_transaction_id   the ledger row that reversed the last payment
The ledger `source` column is a plain string with no check constraint, so the new sources `insurance_claim` and
`insurance_claim_reversal` need no schema change (cash_basis.py classifies them). Existing claims become `unpaid`.
The downgrade drops the check, the unique index and the columns.

Revision ID: 0075_claim_payment
Revises: 0074_history_import
Create Date: 2026-11-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0075_claim_payment'
down_revision: Union[str, None] = '0074_history_import'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "insurance_claims"
CHECK = "ck_insurance_claims_payment_status"
UNIQUE = "uq_insurance_claims_ledger_transaction_id"
FK_USER = "fk_insurance_claims_paid_by_user_id"
FK_PAY = "fk_insurance_claims_ledger_transaction_id"
FK_REV = "fk_insurance_claims_payment_reversal_transaction_id"


REFERENCES = (
    ("paid_by_user_id", "users", FK_USER),
    ("ledger_transaction_id", "finance_ledger_transactions", FK_PAY),
    ("payment_reversal_transaction_id", "finance_ledger_transactions", FK_REV),
)


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    found = {c["name"]: c for c in insp.get_columns(TABLE)}
    checks = {c.get("name") for c in insp.get_check_constraints(TABLE)}
    uniques = {c.get("name") for c in insp.get_unique_constraints(TABLE)}
    fks = {tuple(fk["constrained_columns"]) for fk in insp.get_foreign_keys(TABLE)}
    # Migration 0013 builds missing columns from the live models with a plain ALTER, so a database upgraded from scratch may already
    # have these columns without their NOT NULL and foreign keys: recreate the table so every path ends in the same shape.
    with op.batch_alter_table(TABLE, recreate="always") as b:
        if "payment_status" not in found:
            b.add_column(sa.Column("payment_status", sa.String(20), nullable=False, server_default="unpaid"))
        elif found["payment_status"]["nullable"]:
            b.alter_column("payment_status", existing_type=sa.String(20), nullable=False, existing_server_default="unpaid")
        if "paid_at" not in found:
            b.add_column(sa.Column("paid_at", sa.DateTime(), nullable=True))
        for column, target, name in REFERENCES:
            if column not in found:
                b.add_column(sa.Column(column, sa.Integer(), sa.ForeignKey(target + ".id", name=name, ondelete="RESTRICT"), nullable=True))
            elif (column,) not in fks:
                b.create_foreign_key(name, target, [column], ["id"], ondelete="RESTRICT")
        if CHECK not in checks:
            b.create_check_constraint(CHECK, "payment_status IN ('unpaid', 'paid', 'reversed')")
        if UNIQUE not in uniques:
            b.create_unique_constraint(UNIQUE, ["ledger_transaction_id"])


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns(TABLE)}
    checks = {c.get("name") for c in insp.get_check_constraints(TABLE)}
    uniques = {c.get("name") for c in insp.get_unique_constraints(TABLE)}
    with op.batch_alter_table(TABLE) as b:
        if CHECK in checks:
            b.drop_constraint(CHECK, type_="check")
        if UNIQUE in uniques:
            b.drop_constraint(UNIQUE, type_="unique")
        # dropping a column drops its foreign key with it (PostgreSQL) or leaves it out of the rebuilt table (SQLite)
        for col in ("payment_reversal_transaction_id", "ledger_transaction_id", "paid_by_user_id", "paid_at", "payment_status"):
            if col in cols:
                b.drop_column(col)
