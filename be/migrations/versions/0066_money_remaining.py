"""0066_money_remaining

Database redesign, Stage 5b-3b: the remaining money columns become exact NUMERIC in the database.
  finance_account_transfers: from_amount, to_amount, fee NUMERIC(18,4); fx_rate NUMERIC(18,8)
  finance_subscriptions, finance_subscription_charges: amounts and variances NUMERIC(18,4)
  finance_statement_imports, finance_statement_lines, finance_reconciliation_rules: balances and amounts NUMERIC(18,4)
  finance_account_balance_checkpoints, finance_account_year_openings: balances NUMERIC(18,4)
  finance_statutory_obligations: the four amounts NUMERIC(18,4)
  insurance_categories, insurance_claims, salary_payment_docs (amount_usd): NUMERIC(18,4)
  employee_social_insurance.insured_base NUMERIC(18,4); employee_tax_method.flat_rate NUMERIC(18,8)
After this migration no money column is a float; the only float left is finance_bills.extraction_confidence, which is not money.

Same rules as 0063: exact NUMERIC in the database, plain floats in Python (finance/money.py); the upgrade stops with a list when
a value has more decimals than its column keeps (4 for amounts, 8 for rates); the downgrade turns the columns back into floats.

Revision ID: 0066_money_remaining
Revises: 0065_money_payroll
Create Date: 2026-11-06 10:00:00.000000

"""
import os
import sys
from typing import Sequence, Union

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import money_support  # noqa: E402


revision: str = '0066_money_remaining'
down_revision: Union[str, None] = '0065_money_payroll'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = (18, 4)
RATE = (18, 8)
TABLES = {
    "finance_account_transfers": {"from_amount": MONEY, "to_amount": MONEY, "fee": MONEY, "fx_rate": RATE},
    "finance_subscriptions": {"amount": MONEY, "monthly_equivalent_amount": MONEY},
    "finance_subscription_charges": {"amount": MONEY, "variance_amount": MONEY, "expected_amount": MONEY},
    "finance_statement_imports": {"opening_balance": MONEY, "closing_balance": MONEY},
    "finance_statement_lines": {"raw_amount": MONEY},
    "finance_reconciliation_rules": {"min_amount": MONEY, "max_amount": MONEY},
    "finance_account_balance_checkpoints": {"balance": MONEY},
    "finance_account_year_openings": {"opening_balance": MONEY},
    "finance_statutory_obligations": {"amount_estimated": MONEY, "amount_accrued": MONEY, "amount_remitted": MONEY, "variance_amount": MONEY},
    "insurance_categories": {"annual_limit": MONEY},
    "insurance_claims": {"amount": MONEY},
    "salary_payment_docs": {"amount_usd": MONEY},
    "employee_social_insurance": {"insured_base": MONEY},
    "employee_tax_method": {"flat_rate": RATE},
}


def upgrade() -> None:
    money_support.convert(TABLES)


def downgrade() -> None:
    money_support.revert(TABLES)
