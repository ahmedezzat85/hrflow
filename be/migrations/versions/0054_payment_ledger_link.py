"""0054_payment_ledger_link

Database redesign, Stage 2b: a payment and the ledger row it posted are linked. Adds
`finance_payments.ledger_transaction_id` (foreign key to `finance_ledger_transactions`, unique: one payment, one
ledger row). Until now the two were paired only by matching account, date, amount and bill/invoice, so either could
exist without the other.

Existing payments are backfilled by that same match, one to one, lowest ledger id first: same bank account, same
date, same amount, matching direction, a bill/invoice/statutory-obligation link equal to the payment's, and a payment
source (bill_payment, invoice_payment, cheque, statutory_remittance). Payments with no match stay NULL and are listed
in the migration log, never guessed. The downgrade drops the column.

Revision ID: 0054_payment_ledger_link
Revises: 0053_bill_amount_paid_derived
Create Date: 2026-10-29 15:00:00.000000

"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0054_payment_ledger_link'
down_revision: Union[str, None] = '0053_bill_amount_paid_derived'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

SOURCES = ("bill_payment", "invoice_payment", "cheque", "statutory_remittance")


def _columns(inspector, table):
    return [c["name"] for c in inspector.get_columns(table)] if table in inspector.get_table_names() else []


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = _columns(inspector, "finance_payments")
    if not cols:
        return
    # 0013 adds columns that the current models have and the table lacks, without constraints, so the column may
    # exist already without its foreign key or unique index: ensure each part separately.
    has_fk = any(fk["constrained_columns"] == ["ledger_transaction_id"] for fk in inspector.get_foreign_keys("finance_payments"))
    if "ledger_transaction_id" not in cols or not has_fk:
        with op.batch_alter_table("finance_payments") as batch_op:
            if "ledger_transaction_id" not in cols:
                batch_op.add_column(sa.Column("ledger_transaction_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_finance_payments_ledger_transaction_id", "finance_ledger_transactions",
                ["ledger_transaction_id"], ["id"], ondelete="SET NULL",
            )
    existing = {ix["name"] for ix in sa.inspect(bind).get_indexes("finance_payments")}
    if "uq_finance_payments_ledger_transaction_id" not in existing:
        op.create_index("uq_finance_payments_ledger_transaction_id", "finance_payments", ["ledger_transaction_id"], unique=True)

    if "finance_ledger_transactions" not in inspector.get_table_names():
        return
    ledger = bind.execute(sa.text(
        "SELECT id, account_id, date, amount, direction, source, linked_bill_id, linked_invoice_id, "
        "linked_statutory_obligation_id FROM finance_ledger_transactions WHERE source IN :sources ORDER BY id"
    ).bindparams(sa.bindparam("sources", expanding=True)), {"sources": list(SOURCES)}).fetchall()
    by_key = {}
    for row in ledger:
        by_key.setdefault((row.account_id, row.date, row.direction), []).append(row)
    claimed = {r[0] for r in bind.execute(sa.text("SELECT ledger_transaction_id FROM finance_payments WHERE ledger_transaction_id IS NOT NULL"))}
    unmatched = 0
    for p in bind.execute(sa.text(
        "SELECT id, bank_account_id, payment_date, amount, direction, related_bill_id, related_invoice_id, "
        "related_statutory_obligation_id FROM finance_payments WHERE ledger_transaction_id IS NULL ORDER BY id"
    )).fetchall():
        wanted = "out" if p.direction == "outgoing" else "in"
        match = None
        for row in by_key.get((p.bank_account_id, p.payment_date, wanted), []):
            if row.id in claimed or abs(float(row.amount) - float(p.amount)) >= 0.005:
                continue
            if ((p.related_bill_id is not None and row.linked_bill_id == p.related_bill_id)
                    or (p.related_invoice_id is not None and row.linked_invoice_id == p.related_invoice_id)
                    or (p.related_statutory_obligation_id is not None
                        and row.linked_statutory_obligation_id == p.related_statutory_obligation_id)):
                match = row
                break
        if match is None:
            unmatched += 1
            log.warning("payment %s (%s %s on %s, account %s): no matching ledger row; ledger_transaction_id left empty",
                        p.id, p.direction, p.amount, p.payment_date, p.bank_account_id)
            continue
        claimed.add(match.id)
        bind.execute(sa.text("UPDATE finance_payments SET ledger_transaction_id = :l WHERE id = :p"), {"l": match.id, "p": p.id})
    if unmatched:
        log.warning("%s payment(s) have no matching ledger row", unmatched)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = _columns(inspector, "finance_payments")
    if "ledger_transaction_id" not in cols:
        return
    if "uq_finance_payments_ledger_transaction_id" in {ix["name"] for ix in inspector.get_indexes("finance_payments")}:
        op.drop_index("uq_finance_payments_ledger_transaction_id", table_name="finance_payments")
    fk_names = {fk["name"] for fk in inspector.get_foreign_keys("finance_payments") if fk["constrained_columns"] == ["ledger_transaction_id"]}
    with op.batch_alter_table("finance_payments") as batch_op:
        for name in fk_names:
            if name:  # databases built from the models carry an unnamed foreign key, which goes with the column
                batch_op.drop_constraint(name, type_="foreignkey")
        batch_op.drop_column("ledger_transaction_id")
