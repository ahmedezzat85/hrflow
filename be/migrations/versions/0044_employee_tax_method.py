"""0044_employee_tax_method

Employee-level tax method (FT-1, D-040): new effective-dated table `employee_tax_method`
(progressive | flat with a rate fraction), plus snapshot columns `tax_method_snapshot` and
`tax_rate_snapshot` on `finance_payroll_lines` and `total_flat_tax_egp` on `finance_payroll_runs`.
Existing rows stay NULL / 0 and mean "progressive". Idempotent; the downgrade drops them.

Revision ID: 0044_employee_tax_method
Revises: 0043_employee_personal_details
Create Date: 2026-10-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0044_employee_tax_method'
down_revision: Union[str, None] = '0043_employee_personal_details'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LINE_COLUMNS = (
    ('tax_method_snapshot', sa.String(length=20)),
    ('tax_rate_snapshot', sa.Float()),
)


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if 'employee_tax_method' not in tables:
        op.create_table(
            'employee_tax_method',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('method', sa.String(length=20), nullable=False, server_default='progressive'),
            sa.Column('flat_rate', sa.Float(), nullable=True),
            sa.Column('effective_start_date', sa.String(length=20), nullable=False, index=True),
            sa.Column('effective_end_date', sa.String(length=20), nullable=True, index=True),
            sa.Column('notes', sa.Text(), nullable=False, server_default=''),
            sa.Column('created_by', sa.String(length=255), nullable=True, server_default=''),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        )
        op.create_index('ix_emp_tax_method_lookup', 'employee_tax_method', ['employee_id', 'effective_end_date'])

    if 'finance_payroll_lines' in tables:
        existing = {c['name'] for c in insp.get_columns('finance_payroll_lines')}
        for name, type_ in _LINE_COLUMNS:
            if name not in existing:
                op.add_column('finance_payroll_lines', sa.Column(name, type_, nullable=True))

    if 'finance_payroll_runs' in tables:
        existing = {c['name'] for c in insp.get_columns('finance_payroll_runs')}
        if 'total_flat_tax_egp' not in existing:
            op.add_column('finance_payroll_runs', sa.Column('total_flat_tax_egp', sa.Float(), nullable=True, server_default='0'))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if 'finance_payroll_runs' in tables:
        existing = {c['name'] for c in insp.get_columns('finance_payroll_runs')}
        if 'total_flat_tax_egp' in existing:
            with op.batch_alter_table('finance_payroll_runs') as batch:
                batch.drop_column('total_flat_tax_egp')

    if 'finance_payroll_lines' in tables:
        existing = {c['name'] for c in insp.get_columns('finance_payroll_lines')}
        with op.batch_alter_table('finance_payroll_lines') as batch:
            for name, _type in _LINE_COLUMNS:
                if name in existing:
                    batch.drop_column(name)

    if 'employee_tax_method' in tables:
        op.drop_index('ix_emp_tax_method_lookup', table_name='employee_tax_method')
        op.drop_table('employee_tax_method')
