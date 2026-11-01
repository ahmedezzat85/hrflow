"""0064_money_bills_invoices_payments

Database redesign, Stage 5b-2: money columns of the sales and purchase side become exact NUMERIC in the database (see
finance/money.py); the application keeps reading and writing floats. Same rules as 0063: the upgrade stops with a list when a
value has more decimals than its column keeps, and the downgrade turns the columns back into floats.
  finance_sales_invoices:       subtotal, tax_amount, total NUMERIC(18,4); vat_rate, withholding_tax_rate NUMERIC(18,8)
  finance_sales_invoice_lines:  quantity, unit_price, line_total NUMERIC(18,4)
  finance_bills:                subtotal, tax_amount, total NUMERIC(18,4)  (extraction_confidence stays a float: it is not money)
  finance_bill_lines:           quantity, unit_price, line_total NUMERIC(18,4)
  finance_payments:             amount, withheld_amount NUMERIC(18,4)
  finance_cheques:              amount NUMERIC(18,4)
  finance_products:             default_price NUMERIC(18,4)
  finance_customers, finance_vendors: withholding_tax_rate NUMERIC(18,8)

Revision ID: 0064_money_bills_invoices_payments
Revises: 0063_money_ledger_accounts
Create Date: 2026-11-04 10:00:00.000000

"""
import os
import sys
from typing import Sequence, Union

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import money_support  # noqa: E402


revision: str = '0064_money_bills_invoices_payments'
down_revision: Union[str, None] = '0063_money_ledger_accounts'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = (18, 4)
RATE = (18, 8)
TABLES = {
    "finance_sales_invoices": {"subtotal": MONEY, "tax_amount": MONEY, "total": MONEY, "vat_rate": RATE, "withholding_tax_rate": RATE},
    "finance_sales_invoice_lines": {"quantity": MONEY, "unit_price": MONEY, "line_total": MONEY},
    "finance_bills": {"subtotal": MONEY, "tax_amount": MONEY, "total": MONEY},
    "finance_bill_lines": {"quantity": MONEY, "unit_price": MONEY, "line_total": MONEY},
    "finance_payments": {"amount": MONEY, "withheld_amount": MONEY},
    "finance_cheques": {"amount": MONEY},
    "finance_products": {"default_price": MONEY},
    "finance_customers": {"withholding_tax_rate": RATE},
    "finance_vendors": {"withholding_tax_rate": RATE},
}


def upgrade() -> None:
    money_support.convert(TABLES)


def downgrade() -> None:
    money_support.revert(TABLES)
