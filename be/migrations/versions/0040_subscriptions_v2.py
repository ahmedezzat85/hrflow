"""0040_subscriptions_v2

Finance expansion X5 (D-031): billing email, proof source and expectation on subscriptions; status, expected
amount, proof status and settle/skip details on subscription charges. Existing charges were logged after the fact,
so they become `settled`; their proof is `attached` when a file exists, else `unavailable` (existing subscriptions
do not expect proofs, so nothing is flagged retroactively).

Revision ID: 0040_subscriptions_v2
Revises: 0039_revenue_receipts
Create Date: 2026-10-18 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = '0040_subscriptions_v2'
down_revision: Union[str, None] = '0039_revenue_receipts'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SUB_COLS = ('billing_email', 'proof_source', 'proof_expected')
CHARGE_COLS = ('status', 'expected_amount', 'proof_status', 'proof_note', 'settled_at', 'skipped_reason')


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if 'finance_subscriptions' in tables:
        cols = {c['name'] for c in insp.get_columns('finance_subscriptions')}
        with op.batch_alter_table('finance_subscriptions') as batch_op:
            if 'billing_email' not in cols:
                batch_op.add_column(sa.Column('billing_email', sa.String(255), nullable=True))
            if 'proof_source' not in cols:
                batch_op.add_column(sa.Column('proof_source', sa.String(30), nullable=False, server_default='none'))
            if 'proof_expected' not in cols:
                batch_op.add_column(sa.Column('proof_expected', sa.Boolean(), nullable=False, server_default=sa.false()))

    if 'finance_subscription_charges' in tables:
        cols = {c['name'] for c in insp.get_columns('finance_subscription_charges')}
        with op.batch_alter_table('finance_subscription_charges') as batch_op:
            if 'status' not in cols:
                batch_op.add_column(sa.Column('status', sa.String(20), nullable=False, server_default='settled'))
            if 'expected_amount' not in cols:
                batch_op.add_column(sa.Column('expected_amount', sa.Float(), nullable=True))
            if 'proof_status' not in cols:
                batch_op.add_column(sa.Column('proof_status', sa.String(20), nullable=False, server_default='pending'))
            if 'proof_note' not in cols:
                batch_op.add_column(sa.Column('proof_note', sa.Text(), nullable=True))
            if 'settled_at' not in cols:
                batch_op.add_column(sa.Column('settled_at', sa.DateTime(), nullable=True))
            if 'skipped_reason' not in cols:
                batch_op.add_column(sa.Column('skipped_reason', sa.String(255), nullable=True))
        if 'status' not in cols:
            # Backfill: historical charges are settled; their proof is whatever file exists
            bind.execute(text("UPDATE finance_subscription_charges SET settled_at = created_at WHERE settled_at IS NULL"))
            if 'finance_attachments' in tables:
                bind.execute(text(
                    "UPDATE finance_subscription_charges SET proof_status = CASE WHEN EXISTS "
                    "(SELECT 1 FROM finance_attachments a WHERE a.subscription_charge_id = finance_subscription_charges.id) "
                    "THEN 'attached' ELSE 'unavailable' END"
                ))
            else:
                bind.execute(text("UPDATE finance_subscription_charges SET proof_status = 'unavailable'"))
        idx = {i['name'] for i in insp.get_indexes('finance_subscription_charges')}
        if 'uq_subscription_expected_charge' not in idx:
            op.create_index(
                'uq_subscription_expected_charge', 'finance_subscription_charges', ['subscription_id', 'billing_date'], unique=True,
                sqlite_where=sa.text("status = 'expected'"), postgresql_where=sa.text("status = 'expected'"),
            )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if 'finance_subscription_charges' in tables:
        cols = {c['name'] for c in insp.get_columns('finance_subscription_charges')}
        idx = {i['name'] for i in insp.get_indexes('finance_subscription_charges')}
        # Expected and skipped charges did not exist before this migration; they are not part of the old model
        if 'status' in cols:
            bind.execute(text("DELETE FROM finance_subscription_charges WHERE status IN ('expected', 'skipped')"))
        with op.batch_alter_table('finance_subscription_charges') as batch_op:
            if 'uq_subscription_expected_charge' in idx:
                batch_op.drop_index('uq_subscription_expected_charge')
            for name in reversed(CHARGE_COLS):
                if name in cols:
                    batch_op.drop_column(name)
    if 'finance_subscriptions' in tables:
        cols = {c['name'] for c in insp.get_columns('finance_subscriptions')}
        with op.batch_alter_table('finance_subscriptions') as batch_op:
            for name in reversed(SUB_COLS):
                if name in cols:
                    batch_op.drop_column(name)
