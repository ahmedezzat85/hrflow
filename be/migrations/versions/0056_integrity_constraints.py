"""0056_integrity_constraints

Database redesign, Stage 4a: rules the application already enforces become database constraints, so a bug, a script or a
hand edit cannot break them.
  uq_bills_number                one bill number across the table, except Drafts (D-019) and rows saved with the
                                 duplicate override
  uq_payroll_runs_period_active  one non-cancelled payroll run per period
  uq_emp_comp_plan_open          one open-ended compensation plan row per employee and component
  uq_emp_social_ins_open         one open-ended social insurance row per employee
  uq_emp_tax_method_open         one open-ended tax method row per employee
  uq_salary_payment_docs_generated  one generated salary document per employee and month
  ck_finance_attachments_one_parent a finance attachment belongs to exactly one record

Existing data is checked first. Rows that would break a rule cannot be repaired automatically (picking which duplicate
to keep is a financial decision), so the upgrade stops and lists every violation of every rule at once; fix them, then
upgrade again. `python scripts/audit_db_integrity.py` reports the same rows on a copy of production beforehand. Full
non-overlap of effective-dated rows needs real date columns and comes with Stage 5; the open-ended rule here prevents the
worst case (two rows both in force from today on). The downgrade drops the constraints.

Revision ID: 0056_integrity_constraints
Revises: 0055_payroll_line_cleanup
Create Date: 2026-10-30 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0056_integrity_constraints'
down_revision: Union[str, None] = '0055_payroll_line_cleanup'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ATTACHMENT_PARENTS = ("subscription_charge_id", "statement_import_id", "ledger_transaction_id", "cheque_id",
                      "checkpoint_id", "sales_invoice_id")
ATTACHMENT_CHECK = "ck_finance_attachments_one_parent"

# name, table, columns, WHERE clause (SQLite / PostgreSQL), SQL that lists duplicates, label
UNIQUE_RULES = (
    ("uq_bills_number", "finance_bills", ["bill_number"],
     "bill_number IS NOT NULL AND is_duplicate_override = 0 AND status <> 'draft'",
     "bill_number IS NOT NULL AND is_duplicate_override = false AND status <> 'draft'",
     "SELECT bill_number AS k, COUNT(*) AS n FROM finance_bills WHERE bill_number IS NOT NULL AND is_duplicate_override = :f "
     "AND status <> 'draft' GROUP BY bill_number HAVING COUNT(*) > 1",
     "bill number used more than once"),
    ("uq_payroll_runs_period_active", "finance_payroll_runs", ["period_label"],
     "status <> 'cancelled'", "status <> 'cancelled'",
     "SELECT period_label AS k, COUNT(*) AS n FROM finance_payroll_runs WHERE status <> 'cancelled' "
     "GROUP BY period_label HAVING COUNT(*) > 1",
     "several non-cancelled payroll runs for one period"),
    ("uq_emp_comp_plan_open", "finance_employee_compensation_plans", ["employee_id", "component_type"],
     "effective_end_date IS NULL", "effective_end_date IS NULL",
     "SELECT employee_id || '/' || component_type AS k, COUNT(*) AS n FROM finance_employee_compensation_plans "
     "WHERE effective_end_date IS NULL GROUP BY employee_id, component_type HAVING COUNT(*) > 1",
     "several open-ended compensation plan rows (employee/component)"),
    ("uq_emp_social_ins_open", "employee_social_insurance", ["employee_id"],
     "effective_end_date IS NULL", "effective_end_date IS NULL",
     "SELECT employee_id AS k, COUNT(*) AS n FROM employee_social_insurance WHERE effective_end_date IS NULL "
     "GROUP BY employee_id HAVING COUNT(*) > 1",
     "several open-ended social insurance rows (employee)"),
    ("uq_emp_tax_method_open", "employee_tax_method", ["employee_id"],
     "effective_end_date IS NULL", "effective_end_date IS NULL",
     "SELECT employee_id AS k, COUNT(*) AS n FROM employee_tax_method WHERE effective_end_date IS NULL "
     "GROUP BY employee_id HAVING COUNT(*) > 1",
     "several open-ended tax method rows (employee)"),
    ("uq_salary_payment_docs_generated", "salary_payment_docs", ["employee_id", "payment_year", "payment_month"],
     "status = 'generated'", "status = 'generated'",
     "SELECT employee_id || '/' || payment_year || '-' || payment_month AS k, COUNT(*) AS n FROM salary_payment_docs "
     "WHERE status = 'generated' GROUP BY employee_id, payment_year, payment_month HAVING COUNT(*) > 1",
     "several generated salary documents (employee/year-month)"),
)


def _parent_count_sql() -> str:
    return " + ".join(f"CASE WHEN {p} IS NULL THEN 0 ELSE 1 END" for p in ATTACHMENT_PARENTS)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    problems = []
    for name, table, cols, _w_sqlite, _w_pg, dup_sql, label in UNIQUE_RULES:
        if table not in tables or not set(cols) <= {c["name"] for c in inspector.get_columns(table)}:
            continue
        if name in {ix["name"] for ix in inspector.get_indexes(table)}:
            continue
        params = {"f": False} if ":f" in dup_sql else {}
        for key, n in bind.execute(sa.text(dup_sql), params).fetchall():
            problems.append(f"{label}: {key} ({n} rows)")
    attachments_ok = "finance_attachments" in tables and set(ATTACHMENT_PARENTS) <= {c["name"] for c in inspector.get_columns("finance_attachments")}
    has_check = attachments_ok and ATTACHMENT_CHECK in {c.get("name") for c in inspector.get_check_constraints("finance_attachments")}
    if attachments_ok and not has_check:
        for att_id, count in bind.execute(sa.text(
            f"SELECT id, ({_parent_count_sql()}) AS parent_count FROM finance_attachments WHERE ({_parent_count_sql()}) <> 1")).fetchall():
            problems.append(f"finance attachment {att_id} has {count} parent records (needs exactly 1)")
    if problems:
        shown = "\n  ".join(problems[:50])
        raise RuntimeError(
            f"{len(problems)} existing row group(s) break the new integrity rules; fix them, then upgrade again "
            f"(python scripts/audit_db_integrity.py reports them):\n  {shown}"
        )

    for name, table, cols, w_sqlite, w_pg, _dup, _label in UNIQUE_RULES:
        if table not in tables or not set(cols) <= {c["name"] for c in inspector.get_columns(table)}:
            continue
        if name in {ix["name"] for ix in sa.inspect(bind).get_indexes(table)}:
            continue
        op.create_index(name, table, cols, unique=True, sqlite_where=sa.text(w_sqlite), postgresql_where=sa.text(w_pg))

    if attachments_ok and not has_check:
        with op.batch_alter_table("finance_attachments") as batch_op:
            batch_op.create_check_constraint(ATTACHMENT_CHECK, f"({_parent_count_sql()}) = 1")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for name, table, *_rest in UNIQUE_RULES:
        if table in tables and name in {ix["name"] for ix in inspector.get_indexes(table)}:
            op.drop_index(name, table_name=table)
    if "finance_attachments" in tables and ATTACHMENT_CHECK in {c.get("name") for c in inspector.get_check_constraints("finance_attachments")}:
        with op.batch_alter_table("finance_attachments") as batch_op:
            batch_op.drop_constraint(ATTACHMENT_CHECK, type_="check")
