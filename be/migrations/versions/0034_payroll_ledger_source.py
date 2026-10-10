"""0034_payroll_ledger_source

Finance Review Round 2, slice F5 (D-025): payroll ledger rows are source="payroll".

Existing payroll net-pay rows were saved as source="manual" (so they could be edited or deleted as
hand entries) and were added without recalculating balances. This changes rows whose reference starts
with PAYROLL- from manual to payroll, then recalculates running balances and current_balance for every
affected account, exactly as recalculate_account_running_balances does (opening balance plus the
ledger in date, id order). Account balances therefore drop by the net pay these rows always represented.

Downgrade sets the source back to manual. It does not undo the balance recalculation.

Revision ID: 0034_payroll_ledger_source
Revises: 0033_customer_withholding_tax
Create Date: 2026-10-10 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = '0034_payroll_ledger_source'
down_revision: Union[str, None] = '0033_customer_withholding_tax'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _recalculate(bind, account_id: int) -> None:
    opening = bind.execute(
        text("SELECT opening_balance FROM finance_bank_accounts WHERE id = :id"), {"id": account_id}
    ).scalar()
    running = float(opening or 0.0)
    rows = bind.execute(
        text(
            "SELECT id, amount, direction FROM finance_ledger_transactions "
            "WHERE account_id = :id ORDER BY date ASC, id ASC"
        ),
        {"id": account_id},
    ).fetchall()
    for tx_id, amount, direction in rows:
        running += float(amount or 0.0) if direction == "in" else -float(amount or 0.0)
        bind.execute(
            text("UPDATE finance_ledger_transactions SET running_balance = :rb WHERE id = :id"),
            {"rb": round(running, 4), "id": tx_id},
        )
    bind.execute(
        text("UPDATE finance_bank_accounts SET current_balance = :bal WHERE id = :id"),
        {"bal": round(running, 4), "id": account_id},
    )


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if 'finance_ledger_transactions' not in tables or 'finance_bank_accounts' not in tables:
        return

    accounts = [
        r[0] for r in bind.execute(
            text(
                "SELECT DISTINCT account_id FROM finance_ledger_transactions "
                "WHERE source = 'manual' AND reference LIKE 'PAYROLL-%'"
            )
        ).fetchall()
    ]
    if not accounts:
        return
    bind.execute(
        text(
            "UPDATE finance_ledger_transactions SET source = 'payroll' "
            "WHERE source = 'manual' AND reference LIKE 'PAYROLL-%'"
        )
    )
    for account_id in accounts:
        _recalculate(bind, account_id)


def downgrade() -> None:
    bind = op.get_bind()
    if 'finance_ledger_transactions' not in sa.inspect(bind).get_table_names():
        return
    bind.execute(
        text(
            "UPDATE finance_ledger_transactions SET source = 'manual' "
            "WHERE source = 'payroll' AND reference LIKE 'PAYROLL-%'"
        )
    )
