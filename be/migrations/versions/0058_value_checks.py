"""0058_value_checks

Database redesign, Stage 4b: columns that hold one of a fixed set of values get a CHECK, so a script or a hand edit
cannot store a status the application does not know.
  finance_bills.status                  draft, pending_approval, rejected, approved, scheduled, partially_paid, paid, void
  finance_sales_invoices.status         draft, sent, partially_paid, paid, void
  finance_ledger_transactions.direction in, out
  finance_payments.direction            incoming, outgoing
  finance_bank_accounts.account_type    bank, cash

Only columns whose allowed values the code already defines in one place are covered (finance/bill_status.py,
finance/invoice_status.py); other status columns (payroll runs, cheques, statement lines, ...) have no single
authoritative list and are left alone.

Existing data is checked first. A row with a value outside the set cannot be repaired automatically, so the upgrade
stops and lists every bad value with its row count; fix them, then upgrade again. The downgrade drops the CHECKs.

Revision ID: 0058_value_checks
Revises: 0057_payroll_base_pay_line_unique
Create Date: 2026-10-31 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0058_value_checks'
down_revision: Union[str, None] = '0057_payroll_base_pay_line_unique'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The allowed values are copied here on purpose: a migration describes the schema at its revision and must not change
# when the application's lists do (tests/test_value_checks.py fails when the model and this list drift apart).
BILL_STATUSES = ("draft", "pending_approval", "rejected", "approved", "scheduled", "partially_paid", "paid", "void")
INVOICE_STATUSES = ("draft", "sent", "partially_paid", "paid", "void")

# constraint name, table, column, allowed values
RULES = (
    ("ck_finance_bills_status", "finance_bills", "status", BILL_STATUSES),
    ("ck_finance_sales_invoices_status", "finance_sales_invoices", "status", INVOICE_STATUSES),
    ("ck_finance_ledger_direction", "finance_ledger_transactions", "direction", ("in", "out")),
    ("ck_finance_payments_direction", "finance_payments", "direction", ("incoming", "outgoing")),
    ("ck_finance_bank_accounts_type", "finance_bank_accounts", "account_type", ("bank", "cash")),
)


def _expr(column, values):
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _existing_checks(inspector, table):
    return {c.get("name") for c in inspector.get_check_constraints(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    todo = []
    problems = []
    for name, table, column, values in RULES:
        if table not in tables or column not in {c["name"] for c in inspector.get_columns(table)}:
            continue
        if name in _existing_checks(inspector, table):
            continue
        todo.append((name, table, column, values))
        bad = bind.execute(sa.text(
            f"SELECT {column}, COUNT(*) FROM {table} WHERE {column} IS NULL OR NOT ({_expr(column, values)}) GROUP BY {column}")).fetchall()
        for value, n in bad:
            problems.append(f"{table}.{column} = {value!r}: {n} row(s) (allowed: {', '.join(values)})")
    if problems:
        raise RuntimeError(
            f"{len(problems)} value(s) are outside the allowed sets; fix them, then upgrade again:\n  " + "\n  ".join(problems)
        )

    for name, table, column, values in todo:
        with op.batch_alter_table(table) as batch_op:
            batch_op.create_check_constraint(name, _expr(column, values))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for name, table, _column, _values in RULES:
        if table in tables and name in _existing_checks(inspector, table):
            with op.batch_alter_table(table) as batch_op:
                batch_op.drop_constraint(name, type_="check")
