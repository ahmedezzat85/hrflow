"""0023_payroll_income_tax_settings

Revision ID: 0023_payroll_income_tax_settings
Revises: 0022_fux_421_egp_social_insurance_salary_basis
Create Date: 2026-09-29 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0023_payroll_income_tax_settings'
down_revision: Union[str, None] = '0022_fux_421_egp_social_insurance_salary_basis'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Create finance_payroll_tax_settings table
    if 'finance_payroll_tax_settings' not in tables:
        op.create_table(
            'finance_payroll_tax_settings',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('effective_from', sa.String(length=20), nullable=False, index=True),
            sa.Column('tax_limit_p_egp', sa.Float(), nullable=False, server_default='20000.0'),
            sa.Column('brackets_json', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('created_by', sa.String(length=255), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_by', sa.String(length=255), nullable=True),
        )

    # 2. Add tax_settings_version_id to finance_payroll_runs
    if 'finance_payroll_runs' in tables:
        runs_cols = [col['name'] for col in inspector.get_columns('finance_payroll_runs')]
        with op.batch_alter_table('finance_payroll_runs') as batch_op:
            if 'tax_settings_version_id' not in runs_cols:
                batch_op.add_column(sa.Column('tax_settings_version_id', sa.Integer(), nullable=True))

    # 3. Add tax calculation snapshots to finance_payroll_lines
    if 'finance_payroll_lines' in tables:
        lines_cols = [col['name'] for col in inspector.get_columns('finance_payroll_lines')]
        with op.batch_alter_table('finance_payroll_lines') as batch_op:
            if 'taxable_gross_egp' not in lines_cols:
                batch_op.add_column(sa.Column('taxable_gross_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'tax_employee_si_egp' not in lines_cols:
                batch_op.add_column(sa.Column('tax_employee_si_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'annual_taxed_salary_egp' not in lines_cols:
                batch_op.add_column(sa.Column('annual_taxed_salary_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'annual_tax_egp' not in lines_cols:
                batch_op.add_column(sa.Column('annual_tax_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'tax_settings_version_id' not in lines_cols:
                batch_op.add_column(sa.Column('tax_settings_version_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_payroll_lines' in tables:
        with op.batch_alter_table('finance_payroll_lines') as batch_op:
            batch_op.drop_column('tax_settings_version_id')
            batch_op.drop_column('annual_tax_egp')
            batch_op.drop_column('annual_taxed_salary_egp')
            batch_op.drop_column('tax_employee_si_egp')
            batch_op.drop_column('taxable_gross_egp')

    if 'finance_payroll_runs' in tables:
        with op.batch_alter_table('finance_payroll_runs') as batch_op:
            batch_op.drop_column('tax_settings_version_id')

    if 'finance_payroll_tax_settings' in tables:
        op.drop_table('finance_payroll_tax_settings')
