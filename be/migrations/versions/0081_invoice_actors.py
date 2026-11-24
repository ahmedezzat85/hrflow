"""0081_invoice_actors

The invoice activity timeline shows who did what, from stored facts: `finance_sales_invoices.created_by`, `sent_by`
and `sent_at`, and `finance_payments.created_by`. Rows that exist before this migration were all entered by the
company's finance user, so they backfill to that user (a payment keeps the actor its ledger row already recorded when
there is one). `sent_at` stays empty for them: the issue date is the only date known.

Revision ID: 0081_invoice_actors
Revises: 0080_payment_reversal_date_kind
Create Date: 2026-11-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0081_invoice_actors'
down_revision: Union[str, None] = '0080_payment_reversal_date_kind'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LEGACY_ACTOR = 'ahmed.ezzat@voyance.health'


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    inv_cols = {c['name'] for c in insp.get_columns('finance_sales_invoices')}
    pay_cols = {c['name'] for c in insp.get_columns('finance_payments')}
    with op.batch_alter_table('finance_sales_invoices') as b:
        if 'created_by' not in inv_cols:
            b.add_column(sa.Column('created_by', sa.String(255), nullable=True))
        if 'sent_by' not in inv_cols:
            b.add_column(sa.Column('sent_by', sa.String(255), nullable=True))
        if 'sent_at' not in inv_cols:
            b.add_column(sa.Column('sent_at', sa.DateTime, nullable=True))
    with op.batch_alter_table('finance_payments') as b:
        if 'created_by' not in pay_cols:
            b.add_column(sa.Column('created_by', sa.String(255), nullable=True))

    bind = op.get_bind()
    params = {'actor': LEGACY_ACTOR}
    bind.execute(sa.text("UPDATE finance_sales_invoices SET created_by = :actor WHERE created_by IS NULL"), params)
    bind.execute(sa.text(
        "UPDATE finance_sales_invoices SET sent_by = :actor "
        "WHERE sent_by IS NULL AND status IN ('sent', 'partially_paid', 'paid')"
    ), params)
    # A payment keeps the actor its own ledger row recorded; the rest were entered by the legacy user.
    bind.execute(sa.text(
        "UPDATE finance_payments SET created_by = ("
        "SELECT l.created_by FROM finance_ledger_transactions l WHERE l.id = finance_payments.ledger_transaction_id) "
        "WHERE created_by IS NULL AND related_invoice_id IS NOT NULL AND ledger_transaction_id IS NOT NULL"
    ))
    bind.execute(sa.text(
        "UPDATE finance_payments SET created_by = :actor WHERE created_by IS NULL AND related_invoice_id IS NOT NULL"
    ), params)


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    inv_cols = {c['name'] for c in insp.get_columns('finance_sales_invoices')}
    pay_cols = {c['name'] for c in insp.get_columns('finance_payments')}
    with op.batch_alter_table('finance_payments') as b:
        if 'created_by' in pay_cols:
            b.drop_column('created_by')
    with op.batch_alter_table('finance_sales_invoices') as b:
        for name in ('sent_at', 'sent_by', 'created_by'):
            if name in inv_cols:
                b.drop_column(name)
