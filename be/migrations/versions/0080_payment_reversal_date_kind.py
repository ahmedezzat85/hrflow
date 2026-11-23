"""0080_payment_reversal_date_kind

A receipt can be reversed as of the day the money went back (INV-REFUND-1): `finance_payments.reversal_date` is the
accounting date of the reversing ledger row, `finance_payments.reversal_kind` says `refund` (money returned to the
customer) or `correction` (the receipt was entered wrongly). `reversed_at` stays the timestamp of the action.
Payments reversed before this migration backfill to the date part of `reversed_at` (the date their ledger row already
carries) and to `correction`.

Revision ID: 0080_payment_reversal_date_kind
Revises: 0079_commission_settlements
Create Date: 2026-11-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0080_payment_reversal_date_kind'
down_revision: Union[str, None] = '0079_commission_settlements'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DATE_CHECK = 'ck_dt_finance_payments_reversal_date'
_KIND_CHECK = 'ck_finance_payments_reversal_kind'
# Same expression as finance/date_checks.py for a column that may be empty
_DATE_OK = (
    "reversal_date IS NULL OR reversal_date = '' OR (length(reversal_date) = 10 AND substr(reversal_date, 5, 1) = '-' "
    "AND substr(reversal_date, 8, 1) = '-' AND substr(reversal_date, 1, 4) BETWEEN '1900' AND '2999' "
    "AND substr(reversal_date, 6, 2) BETWEEN '01' AND '12' AND substr(reversal_date, 9, 2) BETWEEN '01' AND '31')"
)


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c['name'] for c in sa.inspect(bind).get_columns('finance_payments')}
    with op.batch_alter_table('finance_payments') as b:
        if 'reversal_date' not in cols:
            b.add_column(sa.Column('reversal_date', sa.String(20), nullable=True))
        if 'reversal_kind' not in cols:
            b.add_column(sa.Column('reversal_kind', sa.String(20), nullable=True))

    # Existing reversals: their ledger row was dated the day of the action, and they were corrections.
    op.execute(sa.text(
        "UPDATE finance_payments SET reversal_date = substr(CAST(reversed_at AS VARCHAR(40)), 1, 10), reversal_kind = 'correction' "
        "WHERE is_reversed AND reversed_at IS NOT NULL AND reversal_date IS NULL"
    ))
    op.execute(sa.text("UPDATE finance_payments SET reversal_kind = 'correction' WHERE is_reversed AND reversal_kind IS NULL"))

    existing = {c.get('name') for c in sa.inspect(bind).get_check_constraints('finance_payments')}
    with op.batch_alter_table('finance_payments') as b:
        if _DATE_CHECK not in existing:
            b.create_check_constraint(_DATE_CHECK, _DATE_OK)
        if _KIND_CHECK not in existing:
            b.create_check_constraint(_KIND_CHECK, "reversal_kind IS NULL OR reversal_kind IN ('refund', 'correction')")


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = {c['name'] for c in insp.get_columns('finance_payments')}
    checks = {c.get('name') for c in insp.get_check_constraints('finance_payments')}
    with op.batch_alter_table('finance_payments') as b:
        for name in (_DATE_CHECK, _KIND_CHECK):
            if name in checks:
                b.drop_constraint(name, type_='check')
        if 'reversal_kind' in cols:
            b.drop_column('reversal_kind')
        if 'reversal_date' in cols:
            b.drop_column('reversal_date')
