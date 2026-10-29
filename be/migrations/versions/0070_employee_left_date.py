"""0070_employee_left_date

Adds `employees.left_date`: the last day of employment, entered when an employee is archived (archived_at is only the moment the
record was archived). Archiving with a left date also ends the employee's open pay rows (compensation plan, social insurance,
tax method) on that date, so historical payroll runs after it leave them out.

Nullable text `YYYY-MM-DD` with the same date check as the other date columns (ck_dt_employees_left_date). Existing employees have
no left date. The downgrade drops the check and the column.

Revision ID: 0070_employee_left_date
Revises: 0069_drop_ledger_category
Create Date: 2026-11-09 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0070_employee_left_date'
down_revision: Union[str, None] = '0069_drop_ledger_category'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHECK = "ck_dt_employees_left_date"
EXPRESSION = (
    "left_date IS NULL OR left_date = '' OR (length(left_date) = 10 AND substr(left_date, 5, 1) = '-' AND substr(left_date, 8, 1) = '-' "
    "AND substr(left_date, 1, 4) BETWEEN '1900' AND '2999' AND substr(left_date, 6, 2) BETWEEN '01' AND '12' "
    "AND substr(left_date, 9, 2) BETWEEN '01' AND '31')"
)


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("employees")}
    checks = {c.get("name") for c in insp.get_check_constraints("employees")}
    if "left_date" in cols and CHECK in checks:
        return
    with op.batch_alter_table("employees") as batch_op:
        if "left_date" not in cols:
            batch_op.add_column(sa.Column("left_date", sa.String(20), nullable=True))
        if CHECK not in checks:
            batch_op.create_check_constraint(CHECK, EXPRESSION)


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("employees")}
    checks = {c.get("name") for c in insp.get_check_constraints("employees")}
    with op.batch_alter_table("employees") as batch_op:
        if CHECK in checks:
            batch_op.drop_constraint(CHECK, type_="check")
        if "left_date" in cols:
            batch_op.drop_column("left_date")
