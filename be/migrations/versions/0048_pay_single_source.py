"""0048_pay_single_source

Pay has one stored source, the compensation plan (D-046). Drops the cached copies:
  employees.salary, employees.internal_salary_usd, employees.external_salary_usd
  salary_history.previous_salary, salary_history.new_salary  (always internal + external)
The API keeps the same field names and derives them from the plan (finance/current_pay.py).

Nothing is written to the plan table: employees whose old columns held an amount that the plan in force today
does not hold are listed in the migration log, so nothing is lost silently. Run
`python scripts/check_pay_columns.py` before upgrading to see the same list.
The downgrade re-adds the columns and refills them from the plan in force today and from the history split.

Revision ID: 0048_pay_single_source
Revises: 0047_account_year_openings
Create Date: 2026-10-27 12:00:00.000000

"""
import logging
from datetime import date
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0048_pay_single_source'
down_revision: Union[str, None] = '0047_account_year_openings'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

EMPLOYEE_COLUMNS = ("salary", "internal_salary_usd", "external_salary_usd")
HISTORY_COLUMNS = ("previous_salary", "new_salary")


def _columns(inspector, table):
    return [c["name"] for c in inspector.get_columns(table)] if table in inspector.get_table_names() else []


def _plan_pay(bind, today):
    """{employee_id: (internal, external)} in force today."""
    if "finance_employee_compensation_plans" not in sa.inspect(bind).get_table_names():
        return {}
    rows = bind.execute(sa.text(
        "SELECT employee_id, component_type, amount FROM finance_employee_compensation_plans "
        "WHERE effective_start_date <= :d AND (effective_end_date IS NULL OR effective_end_date >= :d)"
    ), {"d": today}).fetchall()
    pay = {}
    for emp_id, component, amount in rows:
        cur = pay.setdefault(emp_id, [0.0, 0.0])
        cur[0 if component == "internal_usd_cash" else 1] += float(amount or 0.0)
    return {k: (round(v[0], 2), round(v[1], 2)) for k, v in pay.items()}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    emp_cols = _columns(inspector, "employees")
    if "internal_salary_usd" in emp_cols and "external_salary_usd" in emp_cols:
        plan = _plan_pay(bind, date.today().isoformat())
        rows = bind.execute(sa.text("SELECT id, name, internal_salary_usd, external_salary_usd FROM employees")).fetchall()
        for emp_id, name, old_int, old_ext in rows:
            old = (round(float(old_int or 0.0), 2), round(float(old_ext or 0.0), 2))
            if old != plan.get(emp_id, (0.0, 0.0)) and old != (0.0, 0.0):
                log.warning(
                    "pay columns dropped for employee %s (%s): old internal/external %s, plan in force today %s",
                    emp_id, name, old, plan.get(emp_id, (0.0, 0.0)),
                )

    drop_emp = [c for c in EMPLOYEE_COLUMNS if c in emp_cols]
    if drop_emp:
        with op.batch_alter_table("employees") as batch_op:
            for name in drop_emp:
                batch_op.drop_column(name)
    drop_hist = [c for c in HISTORY_COLUMNS if c in _columns(inspector, "salary_history")]
    if drop_hist:
        with op.batch_alter_table("salary_history") as batch_op:
            for name in drop_hist:
                batch_op.drop_column(name)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    emp_cols = _columns(inspector, "employees")
    if emp_cols:
        with op.batch_alter_table("employees") as batch_op:
            for name in EMPLOYEE_COLUMNS:
                if name not in emp_cols:
                    batch_op.add_column(sa.Column(name, sa.Float(), nullable=True, server_default="0"))
        plan = _plan_pay(bind, date.today().isoformat())
        for emp_id, (internal, external) in plan.items():
            bind.execute(sa.text(
                "UPDATE employees SET internal_salary_usd = :i, external_salary_usd = :e, salary = :t WHERE id = :id"
            ), {"i": internal, "e": external, "t": round(internal + external, 2), "id": emp_id})
    hist_cols = _columns(inspector, "salary_history")
    if hist_cols:
        with op.batch_alter_table("salary_history") as batch_op:
            for name in HISTORY_COLUMNS:
                if name not in hist_cols:
                    batch_op.add_column(sa.Column(name, sa.Float(), nullable=True, server_default="0"))
        bind.execute(sa.text(
            "UPDATE salary_history SET previous_salary = COALESCE(previous_internal_usd, 0) + COALESCE(previous_external_usd, 0), "
            "new_salary = COALESCE(new_internal_usd, 0) + COALESCE(new_external_usd, 0)"
        ))
