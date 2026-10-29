"""0059_employee_pay_history_restrict

Database redesign, Stage 4b: deleting an employee must not erase their pay history. The compensation plan table already
used `ON DELETE RESTRICT` on `employee_id`; the tax method and social insurance tables used `CASCADE`, so the database
silently deleted those rows with the employee. Both now use `RESTRICT`, matching the plan table, the payroll lines and the
payroll adjustments (migration 0055). The application also refuses the delete with a readable 409
(services/employee_delete_guard.py), and the model no longer cascades the delete in Python.

No data changes. The downgrade restores `CASCADE`.

Revision ID: 0059_employee_pay_history_restrict
Revises: 0058_value_checks
Create Date: 2026-10-31 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0059_employee_pay_history_restrict'
down_revision: Union[str, None] = '0058_value_checks'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("employee_tax_method", "employee_social_insurance")
CONVENTION = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}


def _set_ondelete(table: str, ondelete: str) -> None:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return
    fks = [fk for fk in inspector.get_foreign_keys(table) if fk["constrained_columns"] == ["employee_id"]]
    if fks and all((fk.get("options") or {}).get("ondelete") == ondelete for fk in fks):
        return
    with op.batch_alter_table(table, naming_convention=CONVENTION) as batch_op:
        for fk in fks:
            batch_op.drop_constraint(fk["name"] or f"fk_{table}_employee_id_employees", type_="foreignkey")
        batch_op.create_foreign_key(f"fk_{table}_employee_id_employees", "employees", ["employee_id"], ["id"], ondelete=ondelete)


def upgrade() -> None:
    for table in TABLES:
        _set_ondelete(table, "RESTRICT")


def downgrade() -> None:
    for table in TABLES:
        _set_ondelete(table, "CASCADE")
