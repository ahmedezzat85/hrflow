"""
be/finance/date_checks.py
Database redesign, Stage 5b-4: every date column that holds a `YYYY-MM-DD` string is also checked by the database.

The application reads and writes these as plain strings (comparisons, slicing and JSON all rely on that), so the columns stay
text; a CHECK constraint makes sure only a well-formed date can be stored. The check is portable (SQLite and PostgreSQL):
length 10, dashes in the right places, year 1900 to 2999, month 01 to 12, day 01 to 31. A column that may be empty (NULL, or the
empty string where the model defaults to it) accepts those too.

Not covered on purpose: salary_payment_docs.invoice_date holds the date as printed on the generated document (for example
"05 Nov 2026"), not an ISO date.

DATE_COLUMNS is the single list; the model (attach_date_checks, called at the end of models_db.py) and migration 0067 use it.
Migration 0067 keeps its own frozen copy, and tests/test_date_checks.py fails when the two drift apart.
"""
from typing import Dict, Tuple

from sqlalchemy import CheckConstraint, MetaData

# table -> {column: may be empty}
DATE_COLUMNS: Dict[str, Dict[str, bool]] = {
    "employee_notes": {"date": False},
    "employee_social_insurance": {"effective_start_date": False, "effective_end_date": True},
    "employee_tax_method": {"effective_start_date": False, "effective_end_date": True},
    "employees": {"join_date": True, "left_date": True},
    "finance_account_balance_checkpoints": {"date": False},
    "finance_account_transfers": {"date": False, "expected_date": True},
    "finance_bank_accounts": {"opening_balance_date": True},
    "finance_bills": {"due_date": True, "issue_date": True, "scheduled_payment_date": True},
    "finance_cheques": {"clear_date": True, "issue_date": False},
    "finance_employee_compensation_plans": {"effective_end_date": True, "effective_start_date": False},
    "finance_ledger_transactions": {"date": False, "period_end": True, "period_start": True},
    "finance_payments": {"payment_date": False},
    "finance_payroll_rate_settings": {"effective_from": False},
    "finance_payroll_runs": {"payment_date": True, "period_end": False, "period_start": False},
    "finance_payroll_tax_settings": {"effective_from": False},
    "finance_sales_invoices": {"due_date": False, "issue_date": False},
    "finance_statement_lines": {"raw_date": False},
    "finance_statutory_obligations": {"due_date": True},
    "finance_subscription_charges": {"billing_date": False},
    "finance_subscriptions": {"contract_end_date": True, "contract_start_date": True, "next_renewal_date": False},
    "finance_vendor_payment_instructions": {"effective_date": True},
    "insurance_claims": {"date": False},
    "requests": {"date": False},
    "salary_history": {"date": False},
    "vacation_history": {"end_date": False, "start_date": False},
}


def check_name(table: str, column: str) -> str:
    return f"ck_dt_{table}_{column}"[:63]


def check_expression(column: str, may_be_empty: bool) -> str:
    well_formed = (
        f"(length({column}) = 10 AND substr({column}, 5, 1) = '-' AND substr({column}, 8, 1) = '-' "
        f"AND substr({column}, 1, 4) BETWEEN '1900' AND '2999' AND substr({column}, 6, 2) BETWEEN '01' AND '12' "
        f"AND substr({column}, 9, 2) BETWEEN '01' AND '31')"
    )
    return f"{column} IS NULL OR {column} = '' OR {well_formed}" if may_be_empty else well_formed


def all_checks() -> Dict[Tuple[str, str], Tuple[str, str]]:
    """{(table, column): (constraint name, expression)}"""
    return {(t, c): (check_name(t, c), check_expression(c, empty)) for t, cols in DATE_COLUMNS.items() for c, empty in cols.items()}


def attach_date_checks(metadata: MetaData) -> None:
    for (table, _column), (name, expression) in all_checks().items():
        metadata.tables[table].append_constraint(CheckConstraint(expression, name=name))
