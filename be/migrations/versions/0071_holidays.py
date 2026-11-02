"""0071_holidays

Adds the `holidays` table: official company holidays (name, first and last day). Leave requests exclude these days from the
number of days they take. Dates are text `YYYY-MM-DD` with the same database date check as the other date columns
(ck_dt_holidays_start_date, ck_dt_holidays_end_date). The table starts empty. The downgrade drops it.

Revision ID: 0071_holidays
Revises: 0070_employee_left_date
Create Date: 2026-11-10 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0071_holidays'
down_revision: Union[str, None] = '0070_employee_left_date'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _date_check(column: str) -> sa.CheckConstraint:
    expression = (
        f"(length({column}) = 10 AND substr({column}, 5, 1) = '-' AND substr({column}, 8, 1) = '-' "
        f"AND substr({column}, 1, 4) BETWEEN '1900' AND '2999' AND substr({column}, 6, 2) BETWEEN '01' AND '12' "
        f"AND substr({column}, 9, 2) BETWEEN '01' AND '31')"
    )
    return sa.CheckConstraint(expression, name=f"ck_dt_holidays_{column}")


def upgrade() -> None:
    if "holidays" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "holidays",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("start_date", sa.String(10), nullable=False),
        sa.Column("end_date", sa.String(10), nullable=False),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        _date_check("start_date"),
        _date_check("end_date"),
    )
    op.create_index("ix_holidays_start_date", "holidays", ["start_date"])


def downgrade() -> None:
    if "holidays" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_index("ix_holidays_start_date", table_name="holidays")
        op.drop_table("holidays")
