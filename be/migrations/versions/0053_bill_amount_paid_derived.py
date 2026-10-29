"""0053_bill_amount_paid_derived

Database redesign, Stage 2b: `finance_bills.amount_paid` is no longer stored. A bill's paid amount is the sum of its
live (not reversed) payments in `finance_payments`, computed when the bill is read; the stored copy could drift from
the payments (it was written by hand in several places). The API keeps `amount_paid` on bill responses.

Nothing is written to the payment table: every bill whose stored amount differs from its live payments is listed in
the migration log first, so nothing is lost silently. Run `python scripts/audit_db_integrity.py` before upgrading to
see the same list. The downgrade re-adds the column and refills it from the live payments.

Revision ID: 0053_bill_amount_paid_derived
Revises: 0052_bill_imported_category
Create Date: 2026-10-29 12:00:00.000000

"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0053_bill_amount_paid_derived'
down_revision: Union[str, None] = '0052_bill_imported_category'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")


def _columns(inspector, table):
    return [c["name"] for c in inspector.get_columns(table)] if table in inspector.get_table_names() else []


def _live_payments_sql():
    return ("SELECT COALESCE(SUM(p.amount), 0) FROM finance_payments p "
            "WHERE p.related_bill_id = finance_bills.id AND p.is_reversed = :f")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = _columns(inspector, "finance_bills")
    if "amount_paid" not in cols:
        return
    if "finance_payments" in inspector.get_table_names():
        rows = bind.execute(sa.text(
            f"SELECT id, bill_number, amount_paid, ({_live_payments_sql()}) AS live FROM finance_bills"
        ), {"f": False}).fetchall()
        for bill_id, number, stored, live in rows:
            if abs(float(stored or 0.0) - float(live or 0.0)) > 0.005:
                log.warning("bill %s (%s): stored amount_paid %s, live payments sum to %s; now derived from the payments",
                            bill_id, number, stored, live)
    with op.batch_alter_table("finance_bills") as batch_op:
        batch_op.drop_column("amount_paid")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = _columns(inspector, "finance_bills")
    if not cols or "amount_paid" in cols:
        return
    with op.batch_alter_table("finance_bills") as batch_op:
        batch_op.add_column(sa.Column("amount_paid", sa.Float(), nullable=False, server_default="0"))
    if "finance_payments" in inspector.get_table_names():
        bind.execute(sa.text(f"UPDATE finance_bills SET amount_paid = ({_live_payments_sql()})"), {"f": False})
