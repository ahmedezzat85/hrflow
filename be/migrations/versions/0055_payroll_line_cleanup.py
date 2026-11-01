"""0055_payroll_line_cleanup

Database redesign, Stage 3: payroll line columns that repeated other columns, and two missing foreign keys.
  finance_payroll_lines.tax_employee_si_egp        = employee_social_insurance_egp (the same value, written twice)
  finance_payroll_lines.total_social_insurance_egp = employee + employer social insurance (EGP)
Both are dropped; the model derives them (`PayrollLineDB.tax_employee_si_egp`, `.total_social_insurance_egp`) and the
API keeps the field names. The run-level `finance_payroll_runs.total_social_insurance_egp` is a stored total and stays.

New foreign keys:
  finance_payroll_lines.tax_settings_version_id -> finance_payroll_tax_settings.id (ON DELETE SET NULL).
      A line pointing at a missing version is set to NULL and listed in the migration log.
  finance_payroll_adjustments.employee_id -> employees.id (ON DELETE RESTRICT).
      An adjustment for an employee that does not exist cannot be repaired automatically, so the upgrade stops and
      lists them; run `python scripts/audit_db_integrity.py` first (check `orphan:adjustment_employee`).

Before dropping, every line whose stored value differs from the derived one is listed in the migration log. The
downgrade re-adds the columns, refills them from the employee and employer amounts, and drops the foreign keys.

Revision ID: 0055_payroll_line_cleanup
Revises: 0054_payment_ledger_link
Create Date: 2026-10-30 10:00:00.000000

"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0055_payroll_line_cleanup'
down_revision: Union[str, None] = '0054_payment_ledger_link'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

LINE_DROPS = ("tax_employee_si_egp", "total_social_insurance_egp")


def _columns(inspector, table):
    return [c["name"] for c in inspector.get_columns(table)] if table in inspector.get_table_names() else []


def _has_fk(inspector, table, column):
    return any(fk["constrained_columns"] == [column] for fk in inspector.get_foreign_keys(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    line_cols = _columns(inspector, "finance_payroll_lines")
    if line_cols:
        if {"employee_social_insurance_egp", "employer_social_insurance_egp"} <= set(line_cols):
            if "total_social_insurance_egp" in line_cols:
                for line_id, stored, emp, org in bind.execute(sa.text(
                    "SELECT id, total_social_insurance_egp, employee_social_insurance_egp, employer_social_insurance_egp "
                    "FROM finance_payroll_lines")).fetchall():
                    derived = round(float(emp or 0.0) + float(org or 0.0), 2)
                    if stored is not None and abs(float(stored) - derived) > 0.011:
                        log.warning("payroll line %s: stored total social insurance %s, employee + employer is %s; now derived",
                                    line_id, stored, derived)
            if "tax_employee_si_egp" in line_cols:
                for line_id, stored, emp in bind.execute(sa.text(
                    "SELECT id, tax_employee_si_egp, employee_social_insurance_egp FROM finance_payroll_lines")).fetchall():
                    if stored is not None and emp is not None and abs(float(stored) - float(emp)) > 0.011:
                        log.warning("payroll line %s: stored tax_employee_si_egp %s, employee social insurance is %s; now derived",
                                    line_id, stored, emp)
        drop = [c for c in LINE_DROPS if c in line_cols]
        if drop:
            with op.batch_alter_table("finance_payroll_lines") as batch_op:
                for name in drop:
                    batch_op.drop_column(name)

        if "tax_settings_version_id" in line_cols and "finance_payroll_tax_settings" in inspector.get_table_names():
            orphans = bind.execute(sa.text(
                "SELECT id, tax_settings_version_id FROM finance_payroll_lines WHERE tax_settings_version_id IS NOT NULL "
                "AND tax_settings_version_id NOT IN (SELECT id FROM finance_payroll_tax_settings)")).fetchall()
            for line_id, version_id in orphans:
                log.warning("payroll line %s: tax settings version %s does not exist; set to NULL", line_id, version_id)
            if orphans:
                bind.execute(sa.text(
                    "UPDATE finance_payroll_lines SET tax_settings_version_id = NULL WHERE tax_settings_version_id IS NOT NULL "
                    "AND tax_settings_version_id NOT IN (SELECT id FROM finance_payroll_tax_settings)"))
            if not _has_fk(sa.inspect(bind), "finance_payroll_lines", "tax_settings_version_id"):
                with op.batch_alter_table("finance_payroll_lines") as batch_op:
                    batch_op.create_foreign_key(
                        "fk_finance_payroll_lines_tax_settings_version_id", "finance_payroll_tax_settings",
                        ["tax_settings_version_id"], ["id"], ondelete="SET NULL")

    adj_cols = _columns(inspector, "finance_payroll_adjustments")
    if adj_cols and "employee_id" in adj_cols and "employees" in inspector.get_table_names():
        orphans = bind.execute(sa.text(
            "SELECT id, employee_id FROM finance_payroll_adjustments WHERE employee_id NOT IN (SELECT id FROM employees)")).fetchall()
        if orphans:
            listing = ", ".join(f"{i} (employee {e})" for i, e in orphans[:20])
            raise RuntimeError(
                f"{len(orphans)} payroll adjustment(s) belong to an employee that does not exist: {listing}. "
                "Fix or remove them, then upgrade again (python scripts/audit_db_integrity.py lists them)."
            )
        if not _has_fk(sa.inspect(bind), "finance_payroll_adjustments", "employee_id"):
            with op.batch_alter_table("finance_payroll_adjustments") as batch_op:
                batch_op.create_foreign_key(
                    "fk_finance_payroll_adjustments_employee_id", "employees", ["employee_id"], ["id"], ondelete="RESTRICT")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, column in (("finance_payroll_adjustments", "employee_id"), ("finance_payroll_lines", "tax_settings_version_id")):
        fks = [fk for fk in inspector.get_foreign_keys(table) if fk["constrained_columns"] == [column]] if table in inspector.get_table_names() else []
        named = [fk["name"] for fk in fks if fk.get("name")]
        if named:
            with op.batch_alter_table(table) as batch_op:
                for name in named:
                    batch_op.drop_constraint(name, type_="foreignkey")

    line_cols = _columns(inspector, "finance_payroll_lines")
    if line_cols:
        with op.batch_alter_table("finance_payroll_lines") as batch_op:
            if "total_social_insurance_egp" not in line_cols:
                batch_op.add_column(sa.Column("total_social_insurance_egp", sa.Float(), nullable=True, server_default="0.0"))
            if "tax_employee_si_egp" not in line_cols:
                batch_op.add_column(sa.Column("tax_employee_si_egp", sa.Float(), nullable=True, server_default="0.0"))
        bind.execute(sa.text(
            "UPDATE finance_payroll_lines SET "
            "total_social_insurance_egp = ROUND(CAST(COALESCE(employee_social_insurance_egp, 0) + COALESCE(employer_social_insurance_egp, 0) AS NUMERIC), 2), "
            "tax_employee_si_egp = COALESCE(employee_social_insurance_egp, 0)"))
