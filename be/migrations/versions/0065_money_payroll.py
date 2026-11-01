"""0065_money_payroll

Database redesign, Stage 5b-3a: the payroll money columns become exact NUMERIC in the database.
  finance_payroll_runs:                 totals NUMERIC(18,4); fx_rate_value NUMERIC(18,8)
  finance_payroll_lines:                amounts, snapshots and EGP/USD figures NUMERIC(18,4); the rate and FX snapshots NUMERIC(18,8)
  finance_payroll_adjustments:          amount NUMERIC(18,4)
  finance_employee_compensation_plans:  amount NUMERIC(18,4)
  finance_payroll_rate_settings:        employee_rate, employer_rate NUMERIC(18,8)
  finance_payroll_tax_settings:         tax_limit_p_egp NUMERIC(18,4)
(brackets_json stays text; snapshots keep exactly what was calculated.)

Same rules as 0063: exact NUMERIC in the database, plain floats in Python (finance/money.py); the upgrade stops with a list when
a value has more decimals than its column keeps (4 for amounts, 8 for rates); the downgrade turns the columns back into floats.

Revision ID: 0065_money_payroll
Revises: 0064_money_bills_invoices_payments
Create Date: 2026-11-05 10:00:00.000000

"""
import os
import sys
from typing import Sequence, Union

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import money_support  # noqa: E402


revision: str = '0065_money_payroll'
down_revision: Union[str, None] = '0064_money_bills_invoices_payments'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = (18, 4)
RATE = (18, 8)
TABLES = {
    "finance_payroll_runs": {"total_gross": MONEY, "total_tax": MONEY, "total_deductions": MONEY, "total_net": MONEY, "total_employer_cost": MONEY, "fx_rate_value": RATE, "total_employee_tax_egp": MONEY, "total_social_insurance_egp": MONEY, "total_flat_tax_egp": MONEY},
    "finance_payroll_adjustments": {"amount": MONEY},
    "finance_payroll_lines": {"base_salary": MONEY, "allowances_total": MONEY, "deductions_total": MONEY, "net_pay": MONEY, "employer_cost_extra": MONEY, "insured_base_snapshot": MONEY, "employee_rate_snapshot": RATE, "employer_rate_snapshot": RATE, "configured_internal_salary_usd_snapshot": MONEY, "insured_base_egp_snapshot": MONEY, "fx_rate_snapshot": RATE, "base_gross_egp": MONEY, "variable_gross_egp": MONEY, "employee_social_insurance_egp": MONEY, "employer_social_insurance_egp": MONEY, "employee_tax_egp": MONEY, "employee_social_insurance_usd_equivalent": MONEY, "employee_tax_usd_equivalent": MONEY, "final_internal_net_egp": MONEY, "final_internal_payment_usd": MONEY, "taxable_gross_egp": MONEY, "annual_taxed_salary_egp": MONEY, "annual_tax_egp": MONEY, "tax_rate_snapshot": RATE},
    "finance_employee_compensation_plans": {"amount": MONEY},
    "finance_payroll_rate_settings": {"employee_rate": RATE, "employer_rate": RATE},
    "finance_payroll_tax_settings": {"tax_limit_p_egp": MONEY},
}


def upgrade() -> None:
    money_support.convert(TABLES)


def downgrade() -> None:
    money_support.revert(TABLES)
