"""0050_employee_derived_data

Database redesign, Stage 1: employee data that was stored as a copy is derived or removed.
  employees.vac_used     -> approved annual-leave days starting this year, from vacation_history
  employees.next_raise   -> latest salary_history date + 365 days
  employees.role         -> dropped (access comes from the RBAC roles; the profile never read it)
  employee_documents.view_url / download_url, company_documents.view_url / download_url
                         -> dropped (the backend authorizes and streams by drive_file_id)
The API keeps the `vac_used` and `next_raise` field names and fills them from services/employee_derived.py.

Nothing is written to other tables. Every employee whose stored vac_used or next_raise differs from the derived
value, and every role other than 'employee', is listed in the migration log first, so nothing is lost silently.
Run `python scripts/audit_db_integrity.py` before upgrading to see the same differences. The downgrade re-adds the
columns and refills vac_used, next_raise and role the same way; the document URLs come back empty.

Revision ID: 0050_employee_derived_data
Revises: 0049_history_amounts_derived
Create Date: 2026-10-28 12:00:00.000000

"""
import logging
from datetime import date, timedelta
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0050_employee_derived_data'
down_revision: Union[str, None] = '0049_history_amounts_derived'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

EMPLOYEE_COLUMNS = ("vac_used", "next_raise", "role")
DOCUMENT_TABLES = ("employee_documents", "company_documents")
DOCUMENT_COLUMNS = ("view_url", "download_url")


def _columns(inspector, table):
    return [c["name"] for c in inspector.get_columns(table)] if table in inspector.get_table_names() else []


def _vac_used_map(bind):
    """{employee_id: approved annual-leave days starting this year}."""
    if "vacation_history" not in sa.inspect(bind).get_table_names():
        return {}
    year = date.today().year
    rows = bind.execute(sa.text(
        "SELECT employee_id, SUM(days) FROM vacation_history WHERE status = 'Approved' "
        "AND (type = 'Annual Leave' OR type IS NULL OR type = '') AND start_date >= :a AND start_date < :b "
        "GROUP BY employee_id"
    ), {"a": f"{year}-01-01", "b": f"{year + 1}-01-01"}).fetchall()
    return {emp_id: int(days or 0) for emp_id, days in rows}


def _next_raise_map(bind):
    """{employee_id: latest salary_history date + 365 days}."""
    if "salary_history" not in sa.inspect(bind).get_table_names():
        return {}
    result = {}
    for emp_id, latest in bind.execute(sa.text("SELECT employee_id, MAX(date) FROM salary_history GROUP BY employee_id")):
        try:
            result[emp_id] = (date.fromisoformat(str(latest)[:10]) + timedelta(days=365)).isoformat()
        except ValueError:
            continue
    return result


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    emp_cols = _columns(inspector, "employees")

    if "vac_used" in emp_cols or "next_raise" in emp_cols or "role" in emp_cols:
        used, raises = _vac_used_map(bind), _next_raise_map(bind)
        select = ", ".join(["id", "name"] + [c for c in EMPLOYEE_COLUMNS if c in emp_cols])
        for row in bind.execute(sa.text(f"SELECT {select} FROM employees ORDER BY id")).mappings():
            emp_id = row["id"]
            if "vac_used" in row and int(row["vac_used"] or 0) != used.get(emp_id, 0):
                log.warning("employee %s (%s): stored vac_used %s, approved annual leave this year is %s; now derived",
                            emp_id, row["name"], row["vac_used"], used.get(emp_id, 0))
            if "next_raise" in row and (row["next_raise"] or "") != raises.get(emp_id, ""):
                log.warning("employee %s (%s): stored next_raise %r, one year after the last pay change is %r; now derived",
                            emp_id, row["name"], row["next_raise"], raises.get(emp_id, ""))
            if "role" in row and (row["role"] or "employee") != "employee":
                log.warning("employee %s (%s): employees.role %r is dropped; access comes from the RBAC role",
                            emp_id, row["name"], row["role"])
        drop = [c for c in EMPLOYEE_COLUMNS if c in emp_cols]
        with op.batch_alter_table("employees") as batch_op:
            for name in drop:
                batch_op.drop_column(name)

    for table in DOCUMENT_TABLES:
        drop = [c for c in DOCUMENT_COLUMNS if c in _columns(inspector, table)]
        if drop:
            with op.batch_alter_table(table) as batch_op:
                for name in drop:
                    batch_op.drop_column(name)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    emp_cols = _columns(inspector, "employees")
    if emp_cols:
        with op.batch_alter_table("employees") as batch_op:
            if "vac_used" not in emp_cols:
                batch_op.add_column(sa.Column("vac_used", sa.Integer(), nullable=True, server_default="0"))
            if "next_raise" not in emp_cols:
                batch_op.add_column(sa.Column("next_raise", sa.String(20), nullable=True, server_default=""))
            if "role" not in emp_cols:
                batch_op.add_column(sa.Column("role", sa.String(50), nullable=True, server_default="employee"))
        for emp_id, days in _vac_used_map(bind).items():
            bind.execute(sa.text("UPDATE employees SET vac_used = :d WHERE id = :i"), {"d": days, "i": emp_id})
        for emp_id, day in _next_raise_map(bind).items():
            bind.execute(sa.text("UPDATE employees SET next_raise = :d WHERE id = :i"), {"d": day, "i": emp_id})
    for table in DOCUMENT_TABLES:
        cols = _columns(inspector, table)
        if not cols:
            continue
        with op.batch_alter_table(table) as batch_op:
            for name in DOCUMENT_COLUMNS:
                if name not in cols:
                    batch_op.add_column(sa.Column(name, sa.Text(), nullable=True, server_default=""))
