"""0051_finance_duplicate_columns

Database redesign, Stage 2a: three finance columns that repeated a fact stored elsewhere.
  finance_payroll_runs.bank_account_id        -> external_funding_account_id (the code always set both to the same account)
  finance_payroll_settings.employee_rate,
                           .employer_rate     -> finance_payroll_rate_settings (effective-dated; the only store of the rates)
  finance_cheques.attachment_url              -> finance_attachments.cheque_id (deprecated by 0036, no longer written)
The API keeps `bank_account_id` on payroll responses (filled from the external funding account).

Before dropping, a run that only has bank_account_id gets it copied into external_funding_account_id, the dated
rates are seeded from the global rates when that table is empty, and every difference or non-empty
attachment_url is listed in the migration log, so nothing is lost silently. The downgrade re-adds the columns and
refills the account and the rates; attachment_url comes back empty.

Revision ID: 0051_finance_duplicate_columns
Revises: 0050_employee_derived_data
Create Date: 2026-10-28 15:00:00.000000

"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0051_finance_duplicate_columns'
down_revision: Union[str, None] = '0050_employee_derived_data'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

RATE_SEED_DATE = "2000-01-01"


def _columns(inspector, table):
    return [c["name"] for c in inspector.get_columns(table)] if table in inspector.get_table_names() else []


def _drop_index_on(bind, table, column):
    """Batch mode on SQLite rebuilds the table; an index that names the dropped column has to go first."""
    for ix in sa.inspect(bind).get_indexes(table):
        if column in ix["column_names"]:
            op.drop_index(ix["name"], table_name=table)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    run_cols = _columns(inspector, "finance_payroll_runs")
    if "bank_account_id" in run_cols:
        for run_id, bank, ext in bind.execute(sa.text(
            "SELECT id, bank_account_id, external_funding_account_id FROM finance_payroll_runs "
            "WHERE bank_account_id IS NOT NULL AND (external_funding_account_id IS NULL OR external_funding_account_id <> bank_account_id)"
        )).fetchall():
            if ext is None:
                bind.execute(sa.text("UPDATE finance_payroll_runs SET external_funding_account_id = :a WHERE id = :i"), {"a": bank, "i": run_id})
                log.warning("payroll run %s: bank_account_id %s copied into external_funding_account_id", run_id, bank)
            else:
                log.warning("payroll run %s: bank_account_id %s differs from external_funding_account_id %s; the external account is kept",
                            run_id, bank, ext)
        _drop_index_on(bind, "finance_payroll_runs", "bank_account_id")
        with op.batch_alter_table("finance_payroll_runs") as batch_op:
            batch_op.drop_column("bank_account_id")

    set_cols = _columns(inspector, "finance_payroll_settings")
    if "employee_rate" in set_cols and "employer_rate" in set_cols:
        row = bind.execute(sa.text("SELECT employee_rate, employer_rate FROM finance_payroll_settings ORDER BY id LIMIT 1")).first()
        rates_table = "finance_payroll_rate_settings" in inspector.get_table_names()
        if row and rates_table:
            if bind.execute(sa.text("SELECT COUNT(*) FROM finance_payroll_rate_settings")).scalar() == 0:
                bind.execute(sa.text(
                    "INSERT INTO finance_payroll_rate_settings (effective_from, employee_rate, employer_rate, created_by, updated_by) "
                    "VALUES (:d, :e, :r, 'migration', 'migration')"), {"d": RATE_SEED_DATE, "e": row[0], "r": row[1]})
                log.warning("payroll rates: dated table was empty, seeded %s from the global row (%s / %s)", RATE_SEED_DATE, row[0], row[1])
            else:
                latest = bind.execute(sa.text(
                    "SELECT employee_rate, employer_rate FROM finance_payroll_rate_settings ORDER BY effective_from DESC, id DESC LIMIT 1")).first()
                if latest and (round(float(latest[0]), 4), round(float(latest[1]), 4)) != (round(float(row[0]), 4), round(float(row[1]), 4)):
                    log.warning("payroll rates: global row %s / %s differs from the newest dated rates %s / %s; the dated rates apply",
                                row[0], row[1], latest[0], latest[1])
        with op.batch_alter_table("finance_payroll_settings") as batch_op:
            batch_op.drop_column("employee_rate")
            batch_op.drop_column("employer_rate")

    chq_cols = _columns(inspector, "finance_cheques")
    if "attachment_url" in chq_cols:
        if "finance_attachments" in inspector.get_table_names():
            orphaned = bind.execute(sa.text(
                "SELECT c.id, c.attachment_url FROM finance_cheques c WHERE c.attachment_url IS NOT NULL AND c.attachment_url <> '' "
                "AND NOT EXISTS (SELECT 1 FROM finance_attachments a WHERE a.cheque_id = c.id)")).fetchall()
        else:
            orphaned = []
        for cheque_id, ref in orphaned:
            log.warning("cheque %s: attachment_url %r has no finance_attachments row and is dropped", cheque_id, ref)
        with op.batch_alter_table("finance_cheques") as batch_op:
            batch_op.drop_column("attachment_url")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    run_cols = _columns(inspector, "finance_payroll_runs")
    if run_cols and "bank_account_id" not in run_cols:
        with op.batch_alter_table("finance_payroll_runs") as batch_op:
            batch_op.add_column(sa.Column(
                "bank_account_id", sa.Integer(), sa.ForeignKey("finance_bank_accounts.id", ondelete="SET NULL", name="fk_finance_payroll_runs_bank_account_id"), nullable=True))
        bind.execute(sa.text("UPDATE finance_payroll_runs SET bank_account_id = external_funding_account_id"))
        op.create_index("ix_finance_payroll_runs_bank_account_id", "finance_payroll_runs", ["bank_account_id"])

    set_cols = _columns(inspector, "finance_payroll_settings")
    if set_cols and "employee_rate" not in set_cols:
        with op.batch_alter_table("finance_payroll_settings") as batch_op:
            batch_op.add_column(sa.Column("employee_rate", sa.Float(), nullable=False, server_default="0.11"))
            batch_op.add_column(sa.Column("employer_rate", sa.Float(), nullable=False, server_default="0.18"))
        if "finance_payroll_rate_settings" in inspector.get_table_names():
            latest = bind.execute(sa.text(
                "SELECT employee_rate, employer_rate FROM finance_payroll_rate_settings ORDER BY effective_from DESC, id DESC LIMIT 1")).first()
            if latest:
                bind.execute(sa.text("UPDATE finance_payroll_settings SET employee_rate = :e, employer_rate = :r"),
                             {"e": latest[0], "r": latest[1]})

    chq_cols = _columns(inspector, "finance_cheques")
    if chq_cols and "attachment_url" not in chq_cols:
        with op.batch_alter_table("finance_cheques") as batch_op:
            batch_op.add_column(sa.Column("attachment_url", sa.String(500), nullable=True))
