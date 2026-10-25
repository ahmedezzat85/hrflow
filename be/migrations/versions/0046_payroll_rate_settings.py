"""0046_payroll_rate_settings

Effective-dated social insurance rates (SI-1, D-040): new table `finance_payroll_rate_settings`
(employee_rate, employer_rate, effective_from = YYYY-MM-01). Seeded with one row from the current global
`finance_payroll_settings` rates (0.11 / 0.18 if that row is missing) dated 2000-01-01, so every existing
period resolves exactly as before. The global row stays as the readable fallback. Idempotent; the downgrade
drops the table.

Revision ID: 0046_payroll_rate_settings
Revises: 0045_payroll_funding_accounts
Create Date: 2026-10-25 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0046_payroll_rate_settings'
down_revision: Union[str, None] = '0045_payroll_funding_accounts'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SEED_DATE = '2000-01-01'


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if 'finance_payroll_rate_settings' not in tables:
        op.create_table(
            'finance_payroll_rate_settings',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('effective_from', sa.String(length=20), nullable=False, index=True),
            sa.Column('employee_rate', sa.Float(), nullable=False),
            sa.Column('employer_rate', sa.Float(), nullable=False),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('created_by', sa.String(length=255), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_by', sa.String(length=255), nullable=True),
        )

    already = bind.execute(sa.text("SELECT COUNT(*) FROM finance_payroll_rate_settings")).scalar() or 0
    if already == 0:
        employee_rate, employer_rate = 0.11, 0.18
        if 'finance_payroll_settings' in tables:
            row = bind.execute(sa.text("SELECT employee_rate, employer_rate FROM finance_payroll_settings WHERE id = 1")).first()
            if row is not None and row[0] is not None and row[1] is not None:
                employee_rate, employer_rate = float(row[0]), float(row[1])
        bind.execute(
            sa.text(
                "INSERT INTO finance_payroll_rate_settings (effective_from, employee_rate, employer_rate, created_by, updated_by) "
                "VALUES (:d, :e, :o, 'system', 'system')"
            ),
            {"d": _SEED_DATE, "e": employee_rate, "o": employer_rate},
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'finance_payroll_rate_settings' in insp.get_table_names():
        op.drop_table('finance_payroll_rate_settings')
