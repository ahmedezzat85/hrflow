"""0061_employee_archived

An employee can be archived: `employees.archived_at` / `archived_by` hold the state (NULL = not archived). The API reports
the status "Archived" while it is set; the saved status (Active, On Leave, Suspended) is untouched and comes back when the
employee is unarchived. See services/employee_archive.py for what archiving does.

No existing row changes (every employee starts not archived). The downgrade drops the two columns, which forgets who is
archived: it logs each archived employee first.

Revision ID: 0061_employee_archived
Revises: 0060_payroll_line_tax_amount
Create Date: 2026-11-01 14:00:00.000000

"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0061_employee_archived'
down_revision: Union[str, None] = '0060_payroll_line_tax_amount'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")


def _columns(inspector):
    return {c["name"] for c in inspector.get_columns("employees")} if "employees" in inspector.get_table_names() else set()


def upgrade() -> None:
    cols = _columns(sa.inspect(op.get_bind()))
    if not cols:
        return
    with op.batch_alter_table("employees") as batch_op:
        if "archived_at" not in cols:
            batch_op.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))
        if "archived_by" not in cols:
            batch_op.add_column(sa.Column("archived_by", sa.String(255), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    cols = _columns(sa.inspect(bind))
    if "archived_at" not in cols:
        return
    for emp_id, name, at in bind.execute(sa.text("SELECT id, name, archived_at FROM employees WHERE archived_at IS NOT NULL")).fetchall():
        log.warning("employee %s (%s) was archived at %s; the archived state is dropped", emp_id, name, at)
    with op.batch_alter_table("employees") as batch_op:
        batch_op.drop_column("archived_at")
        if "archived_by" in cols:
            batch_op.drop_column("archived_by")
