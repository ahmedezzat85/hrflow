"""0067_date_checks

Database redesign, Stage 5b-4: dates stay `YYYY-MM-DD` text in the application (comparisons, slicing and JSON all rely on it), but
the database now refuses anything else.

1. A CHECK on each of the 40 date columns: length 10, dashes in the right places, year 1900 to 2999, month 01 to 12, day 01 to 31;
   a column that may be empty also accepts NULL and the empty string. Existing data is checked first and the upgrade stops with a
   list of every bad value (the audit script's `date:*` sections report the same rows).
2. PostgreSQL only: pay history can no longer overlap. A GiST exclusion constraint on the compensation plan, tax method and social
   insurance tables rejects two rows of one employee (and component) whose date ranges overlap, end dates included; a row with no
   end date runs to infinity. It needs the `btree_gist` extension and an immutable date function (`hrflow_iso_date`), both created
   here; if the database user may not create them the constraints are skipped with a warning. Existing overlaps stop the upgrade
   with a list (the audit script's `overlap:*` sections report them). SQLite (development, tests) keeps the application's own
   open-ended-row rule from migration 0056.

The downgrade drops the checks and the exclusion constraints (the function and extension stay).

Revision ID: 0067_date_checks
Revises: 0066_money_remaining
Create Date: 2026-11-07 10:00:00.000000

"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0067_date_checks'
down_revision: Union[str, None] = '0066_money_remaining'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

# table -> {column: may be empty}; frozen copy of finance/date_checks.py (tests/test_date_checks.py keeps them in step)
DATE_COLUMNS = {
    "employee_notes": {"date": False},
    "employee_social_insurance": {"effective_start_date": False, "effective_end_date": True},
    "employee_tax_method": {"effective_start_date": False, "effective_end_date": True},
    "employees": {"join_date": True},
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

# table, columns that identify the person/component, start column, end column, constraint name
OVERLAP_RULES = (
    ("finance_employee_compensation_plans", ("employee_id", "component_type"), "effective_start_date", "effective_end_date",
     "ex_comp_plan_no_overlap"),
    ("employee_social_insurance", ("employee_id",), "effective_start_date", "effective_end_date", "ex_social_insurance_no_overlap"),
    ("employee_tax_method", ("employee_id",), "effective_start_date", "effective_end_date", "ex_tax_method_no_overlap"),
)


def _name(table, column):
    return f"ck_dt_{table}_{column}"[:63]


def _expression(column, may_be_empty):
    well_formed = (
        f"(length({column}) = 10 AND substr({column}, 5, 1) = '-' AND substr({column}, 8, 1) = '-' "
        f"AND substr({column}, 1, 4) BETWEEN '1900' AND '2999' AND substr({column}, 6, 2) BETWEEN '01' AND '12' "
        f"AND substr({column}, 9, 2) BETWEEN '01' AND '31')"
    )
    return f"{column} IS NULL OR {column} = '' OR {well_formed}" if may_be_empty else well_formed


def _existing_checks(inspector, table):
    return {c.get("name") for c in inspector.get_check_constraints(table)}


def _overlaps(bind, table, keys, start, end):
    """Pairs of rows of the same key whose inclusive date ranges overlap (open end = no end)."""
    cols = ", ".join(keys)
    rows = bind.execute(sa.text(f"SELECT id, {cols}, {start}, {end} FROM {table} ORDER BY {cols}, {start}, id")).fetchall()
    found, by_key = [], {}
    for row in rows:
        by_key.setdefault(tuple(row[1:1 + len(keys)]), []).append(row)
    for key, group in by_key.items():
        for i, first in enumerate(group):
            first_end = first[-1] or "9999-12-31"
            for second in group[i + 1:]:
                if str(second[-2]) <= str(first_end):
                    found.append(f"{table} {dict(zip(keys, key))}: rows {first[0]} and {second[0]} overlap")
    return found


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    todo, problems = [], []
    for table, cols in DATE_COLUMNS.items():
        if table not in tables:
            continue
        have = {c["name"] for c in inspector.get_columns(table)}
        existing = _existing_checks(inspector, table)
        for column, may_be_empty in cols.items():
            name = _name(table, column)
            if column not in have or name in existing:
                continue
            todo.append((table, column, may_be_empty, name))
            bad = bind.execute(sa.text(
                f"SELECT id, {column} FROM {table} WHERE NOT ({_expression(column, may_be_empty)}) ORDER BY id")).fetchall()
            if bad:
                shown = ", ".join(f"id {r[0]} = {r[1]!r}" for r in bad[:5])
                problems.append(f"{table}.{column}: {len(bad)} value(s) are not a YYYY-MM-DD date, e.g. {shown}")

    exclusion = []
    if bind.dialect.name == "postgresql":
        for table, keys, start, end, name in OVERLAP_RULES:
            if table in tables:
                present = bind.execute(sa.text("SELECT 1 FROM pg_constraint WHERE conname = :n"), {"n": name}).first()
                if not present:
                    exclusion.append((table, keys, start, end, name))
                    problems.extend(_overlaps(bind, table, keys, start, end))
    if problems:
        raise RuntimeError(
            f"{len(problems)} problem(s) block the date constraints; fix them, then upgrade again:\n  " + "\n  ".join(problems[:60]))

    by_table = {}
    for table, column, may_be_empty, name in todo:
        by_table.setdefault(table, []).append((column, may_be_empty, name))
    for table, items in by_table.items():
        with op.batch_alter_table(table) as batch_op:
            for column, may_be_empty, name in items:
                batch_op.create_check_constraint(name, _expression(column, may_be_empty))

    if exclusion:
        try:
            with bind.begin_nested():   # a savepoint: a refusal must not abort the checks above
                op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
                op.execute("CREATE OR REPLACE FUNCTION hrflow_iso_date(text) RETURNS date LANGUAGE sql IMMUTABLE AS "
                           "$$ SELECT to_date($1, 'YYYY-MM-DD') $$")
                for table, keys, start, end, name in exclusion:
                    lead = ", ".join(f"{k} WITH =" for k in keys)
                    op.execute(
                        f"ALTER TABLE {table} ADD CONSTRAINT {name} EXCLUDE USING gist ({lead}, "
                        f"daterange(hrflow_iso_date({start}), COALESCE(hrflow_iso_date(NULLIF({end}, '')), 'infinity'::date), '[]') WITH &&)"
                    )
        except Exception as exc:  # noqa: BLE001 - the database user may not be allowed to create the extension or function
            log.warning("The no-overlap constraints were NOT created (they need the btree_gist extension and the function "
                        "hrflow_iso_date, which this database user may not create): %s. Create them as a database administrator.", exc)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if bind.dialect.name == "postgresql":
        for table, _keys, _start, _end, name in OVERLAP_RULES:
            if table in tables:
                op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}")
    for table, cols in DATE_COLUMNS.items():
        if table not in tables:
            continue
        existing = _existing_checks(inspector, table)
        names = [_name(table, c) for c in cols if _name(table, c) in existing]
        if names:
            with op.batch_alter_table(table) as batch_op:
                for name in names:
                    batch_op.drop_constraint(name, type_="check")
