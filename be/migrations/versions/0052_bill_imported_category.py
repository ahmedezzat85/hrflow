"""0052_bill_imported_category

Database redesign, Stage 2b: a bill has one category, `category_id`. The free-text `finance_bills.category` that sat
beside it becomes `imported_category`, which holds the raw text only while no transaction category matched it (the
data-quality report lists those bills). The API still returns `category` (the category name, else the imported text).

For every bill: the text is matched to a category by name (case-insensitive) when `category_id` is empty and set as
`category_id` on a match; otherwise it is kept in `imported_category`. A bill with a `category_id` whose old text
names a different category is listed in the migration log (the category row wins). The downgrade re-adds `category`
and fills it with the category name, else the imported text, else 'Operating Expense'.

Revision ID: 0052_bill_imported_category
Revises: 0051_finance_duplicate_columns
Create Date: 2026-10-29 10:00:00.000000

"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0052_bill_imported_category'
down_revision: Union[str, None] = '0051_finance_duplicate_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")


def _columns(inspector, table):
    return [c["name"] for c in inspector.get_columns(table)] if table in inspector.get_table_names() else []


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = _columns(inspector, "finance_bills")
    if not cols:
        return
    if "imported_category" not in cols:
        with op.batch_alter_table("finance_bills") as batch_op:
            batch_op.add_column(sa.Column("imported_category", sa.String(100), nullable=True))
    if "category" in cols:
        by_name = {}
        if "finance_transaction_categories" in inspector.get_table_names():
            by_name = {str(n).strip().lower(): i for i, n in bind.execute(sa.text("SELECT id, name FROM finance_transaction_categories")) if n}
        names = {i: n for n, i in by_name.items()}
        for bill_id, number, text, cat_id in bind.execute(sa.text("SELECT id, bill_number, category, category_id FROM finance_bills")).fetchall():
            text = (text or "").strip()
            if cat_id is None and text:
                match = by_name.get(text.lower())
                if match is not None:
                    bind.execute(sa.text("UPDATE finance_bills SET category_id = :c WHERE id = :i"), {"c": match, "i": bill_id})
                else:
                    bind.execute(sa.text("UPDATE finance_bills SET imported_category = :t WHERE id = :i"), {"t": text[:100], "i": bill_id})
                    log.warning("bill %s (%s): category %r matches no category; kept as imported_category", bill_id, number, text)
            elif cat_id is not None and text and text.lower() != names.get(cat_id, "").strip().lower():
                log.warning("bill %s (%s): old category text %r differs from its category %r; the category row is kept",
                            bill_id, number, text, names.get(cat_id))
        with op.batch_alter_table("finance_bills") as batch_op:
            batch_op.drop_column("category")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = _columns(inspector, "finance_bills")
    if not cols:
        return
    if "category" not in cols:
        with op.batch_alter_table("finance_bills") as batch_op:
            batch_op.add_column(sa.Column("category", sa.String(100), nullable=True, server_default="Operating Expense"))
        bind.execute(sa.text(
            "UPDATE finance_bills SET category = COALESCE("
            "(SELECT name FROM finance_transaction_categories c WHERE c.id = finance_bills.category_id), "
            "NULLIF(imported_category, ''), 'Operating Expense')"
        ))
    if "imported_category" in cols:
        with op.batch_alter_table("finance_bills") as batch_op:
            batch_op.drop_column("imported_category")
