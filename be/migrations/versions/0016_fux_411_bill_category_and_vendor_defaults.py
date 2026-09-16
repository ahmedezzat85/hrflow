"""0016_fux_411_bill_category_and_vendor_defaults

Revision ID: 0016_fux_411_bill_category_and_vendor_defaults
Revises: 0015_fux_410_statutory_obligations
Create Date: 2026-09-16 12:00:00.000000

"""
import logging
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

logger = logging.getLogger("alembic.runtime.migration")

# revision identifiers, used by Alembic.
revision: str = '0016_fux_411_bill_category_and_vendor_defaults'
down_revision: Union[str, None] = '0015_fux_410_statutory_obligations'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Add default_category_id to finance_vendors
    if 'finance_vendors' in tables:
        cols = {c['name'] for c in inspector.get_columns('finance_vendors')}
        if 'default_category_id' not in cols:
            op.add_column(
                'finance_vendors',
                sa.Column(
                    'default_category_id',
                    sa.Integer(),
                    sa.ForeignKey('finance_transaction_categories.id', ondelete='SET NULL'),
                    nullable=True,
                )
            )

    # 2. Add category_id to finance_bills
    if 'finance_bills' in tables:
        cols = {c['name'] for c in inspector.get_columns('finance_bills')}
        if 'category_id' not in cols:
            op.add_column(
                'finance_bills',
                sa.Column(
                    'category_id',
                    sa.Integer(),
                    sa.ForeignKey('finance_transaction_categories.id', ondelete='SET NULL'),
                    nullable=True,
                )
            )

    # 3. Seed lookup categories if available
    try:
        from finance.seed_data import seed_finance_lookups
        from sqlalchemy.orm import Session
        session = Session(bind=bind)
        seed_finance_lookups(session)
    except Exception as e:
        logger.warning(f"Could not seed lookups during migration 0016: {e}")

    # 4. Data-quality pass: Backfill bill.category_id based on bill.category text match
    if 'finance_bills' in tables and 'finance_transaction_categories' in tables:
        try:
            # Query categories
            cats = bind.execute(sa.text("SELECT id, name FROM finance_transaction_categories")).fetchall()
            cat_map = {str(c[1]).strip().lower(): c[0] for c in cats if c[1]}

            # Query bills
            bills = bind.execute(sa.text("SELECT id, bill_number, category, category_id FROM finance_bills")).fetchall()
            matched_count = 0
            unmatched_bills = []

            for b in bills:
                b_id, b_num, b_cat, b_cat_id = b[0], b[1], b[2], b[3]
                if b_cat_id is not None:
                    matched_count += 1
                    continue
                cat_key = (b_cat or "").strip().lower()
                if cat_key in cat_map:
                    matched_id = cat_map[cat_key]
                    bind.execute(
                        sa.text("UPDATE finance_bills SET category_id = :cid WHERE id = :bid"),
                        {"cid": matched_id, "bid": b_id}
                    )
                    matched_count += 1
                else:
                    unmatched_bills.append({
                        "id": b_id,
                        "bill_number": b_num,
                        "raw_category": b_cat,
                    })

            logger.info("=" * 60)
            logger.info("FUX-411 DATA QUALITY REPORT — BILL CATEGORY BACKFILL")
            logger.info(f"Total bills processed: {len(bills)}")
            logger.info(f"Successfully matched: {matched_count}")
            logger.info(f"Unmatched (categorized as 'Other' historically): {len(unmatched_bills)}")
            if unmatched_bills:
                for ub in unmatched_bills:
                    logger.warning(
                        f"  [ACTION NEEDED] Bill #{ub['id']} ({ub['bill_number']}) - Raw category: '{ub['raw_category']}'"
                    )
            logger.info("=" * 60)
        except Exception as e:
            logger.warning(f"Data quality backfill failed: {e}")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_bills' in tables:
        cols = {c['name'] for c in inspector.get_columns('finance_bills')}
        if 'category_id' in cols:
            op.drop_column('finance_bills', 'category_id')

    if 'finance_vendors' in tables:
        cols = {c['name'] for c in inspector.get_columns('finance_vendors')}
        if 'default_category_id' in cols:
            op.drop_column('finance_vendors', 'default_category_id')
