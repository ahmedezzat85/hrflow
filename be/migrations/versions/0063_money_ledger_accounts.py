"""0063_money_ledger_accounts

Database redesign, Stage 5b-1: the ledger and bank account money columns become exact NUMERIC in the database
(see finance/money.py). The application keeps reading and writing plain floats; only the stored type changes, so SQL sums
and comparisons are exact.
  finance_ledger_transactions: amount, tax_amount, base_amount, memo_gross_amount, memo_fee_amount, running_balance  NUMERIC(18,4)
                               fx_rate                                                                              NUMERIC(18,8)
  finance_bank_accounts:       opening_balance, current_balance                                                      NUMERIC(18,4)

A value with more decimals than its column keeps would be rounded silently, so the upgrade checks first and stops with a list
of every such value (`python scripts/audit_db_integrity.py` does not cover this; the migration message does). The downgrade
turns the columns back into floats. SQLite keeps its flexible storage whatever the declared type, so there the change is only
the declared type.

Revision ID: 0063_money_ledger_accounts
Revises: 0062_schema_parity
Create Date: 2026-11-03 10:00:00.000000

"""
import os
import sys
from typing import Sequence, Union

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import money_support  # noqa: E402


revision: str = '0063_money_ledger_accounts'
down_revision: Union[str, None] = '0062_schema_parity'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = (18, 4)
RATE = (18, 8)
TABLES = {
    "finance_ledger_transactions": {
        "amount": MONEY, "tax_amount": MONEY, "base_amount": MONEY, "memo_gross_amount": MONEY,
        "memo_fee_amount": MONEY, "running_balance": MONEY, "fx_rate": RATE,
    },
    "finance_bank_accounts": {"opening_balance": MONEY, "current_balance": MONEY},
}


def upgrade() -> None:
    money_support.convert(TABLES)


def downgrade() -> None:
    money_support.revert(TABLES)
