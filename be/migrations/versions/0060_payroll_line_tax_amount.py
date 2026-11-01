"""0060_payroll_line_tax_amount

Database redesign, Stage 5: `finance_payroll_lines.tax_amount` is dropped. The application always wrote 0.0 into it, while
the real employee tax (in USD) is `employee_tax_usd_equivalent`. The model now exposes `tax_amount` as that value, and the
employee payment-flows report (`/api/finance/reports/payroll/payable-status`) uses the real employee tax and social
insurance of each line, so its tax and insurance figures are no longer zero.

Any line whose stored `tax_amount` is not zero is listed in the migration log first, so nothing is lost silently. The
downgrade re-adds the column and fills it from `employee_tax_usd_equivalent`.

Revision ID: 0060_payroll_line_tax_amount
Revises: 0059_employee_pay_history_restrict
Create Date: 2026-11-01 10:00:00.000000

"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0060_payroll_line_tax_amount'
down_revision: Union[str, None] = '0059_employee_pay_history_restrict'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "finance_payroll_lines" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("finance_payroll_lines")}
    if "tax_amount" not in cols:
        return
    for line_id, value in bind.execute(sa.text(
            "SELECT id, tax_amount FROM finance_payroll_lines WHERE tax_amount IS NOT NULL AND ABS(tax_amount) > 0.005")).fetchall():
        log.warning("payroll line %s: stored tax_amount %s is dropped; the employee tax is employee_tax_usd_equivalent", line_id, value)
    with op.batch_alter_table("finance_payroll_lines") as batch_op:
        batch_op.drop_column("tax_amount")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "finance_payroll_lines" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("finance_payroll_lines")}
    if "tax_amount" in cols:
        return
    with op.batch_alter_table("finance_payroll_lines") as batch_op:
        batch_op.add_column(sa.Column("tax_amount", sa.Float(), nullable=True, server_default="0.0"))
    if "employee_tax_usd_equivalent" in cols:
        bind.execute(sa.text("UPDATE finance_payroll_lines SET tax_amount = COALESCE(employee_tax_usd_equivalent, 0)"))
