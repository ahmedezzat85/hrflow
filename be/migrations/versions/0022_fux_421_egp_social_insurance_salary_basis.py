"""0022_fux_421_egp_social_insurance_salary_basis

Revision ID: 0022_fux_421_egp_social_insurance_salary_basis
Revises: 0021_fux_payroll_social_insurance
Create Date: 2026-09-24 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0022_fux_421_egp_social_insurance_salary_basis'
down_revision: Union[str, None] = '0021_fux_payroll_social_insurance'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Update employee_social_insurance currency default to EGP (retain existing rows)
    if 'employee_social_insurance' in tables:
        with op.batch_alter_table('employee_social_insurance') as batch_op:
            batch_op.alter_column('currency', server_default='EGP')

    # 2. Add salary_basis column to finance_employee_compensation_plans
    if 'finance_employee_compensation_plans' in tables:
        comp_cols = [col['name'] for col in inspector.get_columns('finance_employee_compensation_plans')]
        if 'salary_basis' not in comp_cols:
            with op.batch_alter_table('finance_employee_compensation_plans') as batch_op:
                batch_op.add_column(sa.Column('salary_basis', sa.String(length=20), nullable=False, server_default='NET'))

    # 3. Add statutory estimate and calculation snapshot columns to finance_payroll_lines
    if 'finance_payroll_lines' in tables:
        lines_cols = [col['name'] for col in inspector.get_columns('finance_payroll_lines')]
        with op.batch_alter_table('finance_payroll_lines') as batch_op:
            if 'salary_basis_snapshot' not in lines_cols:
                batch_op.add_column(sa.Column('salary_basis_snapshot', sa.String(length=20), nullable=True))
            if 'configured_internal_salary_usd_snapshot' not in lines_cols:
                batch_op.add_column(sa.Column('configured_internal_salary_usd_snapshot', sa.Float(), nullable=True, server_default='0.0'))
            if 'insured_base_egp_snapshot' not in lines_cols:
                batch_op.add_column(sa.Column('insured_base_egp_snapshot', sa.Float(), nullable=True, server_default='0.0'))
            if 'fx_rate_snapshot' not in lines_cols:
                batch_op.add_column(sa.Column('fx_rate_snapshot', sa.Float(), nullable=True))
            if 'base_gross_egp' not in lines_cols:
                batch_op.add_column(sa.Column('base_gross_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'variable_gross_egp' not in lines_cols:
                batch_op.add_column(sa.Column('variable_gross_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'employee_social_insurance_egp' not in lines_cols:
                batch_op.add_column(sa.Column('employee_social_insurance_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'employer_social_insurance_egp' not in lines_cols:
                batch_op.add_column(sa.Column('employer_social_insurance_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'total_social_insurance_egp' not in lines_cols:
                batch_op.add_column(sa.Column('total_social_insurance_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'employee_tax_egp' not in lines_cols:
                batch_op.add_column(sa.Column('employee_tax_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'employee_social_insurance_usd_equivalent' not in lines_cols:
                batch_op.add_column(sa.Column('employee_social_insurance_usd_equivalent', sa.Float(), nullable=True, server_default='0.0'))
            if 'employee_tax_usd_equivalent' not in lines_cols:
                batch_op.add_column(sa.Column('employee_tax_usd_equivalent', sa.Float(), nullable=True, server_default='0.0'))
            if 'final_internal_net_egp' not in lines_cols:
                batch_op.add_column(sa.Column('final_internal_net_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'final_internal_payment_usd' not in lines_cols:
                batch_op.add_column(sa.Column('final_internal_payment_usd', sa.Float(), nullable=True))

    # 4. Add persisted rollups to finance_payroll_runs
    if 'finance_payroll_runs' in tables:
        runs_cols = [col['name'] for col in inspector.get_columns('finance_payroll_runs')]
        with op.batch_alter_table('finance_payroll_runs') as batch_op:
            if 'total_employee_tax_egp' not in runs_cols:
                batch_op.add_column(sa.Column('total_employee_tax_egp', sa.Float(), nullable=True, server_default='0.0'))
            if 'total_social_insurance_egp' not in runs_cols:
                batch_op.add_column(sa.Column('total_social_insurance_egp', sa.Float(), nullable=True, server_default='0.0'))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_payroll_runs' in tables:
        with op.batch_alter_table('finance_payroll_runs') as batch_op:
            batch_op.drop_column('total_social_insurance_egp')
            batch_op.drop_column('total_employee_tax_egp')

    if 'finance_payroll_lines' in tables:
        with op.batch_alter_table('finance_payroll_lines') as batch_op:
            batch_op.drop_column('final_internal_payment_usd')
            batch_op.drop_column('final_internal_net_egp')
            batch_op.drop_column('employee_tax_usd_equivalent')
            batch_op.drop_column('employee_social_insurance_usd_equivalent')
            batch_op.drop_column('employee_tax_egp')
            batch_op.drop_column('total_social_insurance_egp')
            batch_op.drop_column('employer_social_insurance_egp')
            batch_op.drop_column('employee_social_insurance_egp')
            batch_op.drop_column('variable_gross_egp')
            batch_op.drop_column('base_gross_egp')
            batch_op.drop_column('fx_rate_snapshot')
            batch_op.drop_column('insured_base_egp_snapshot')
            batch_op.drop_column('configured_internal_salary_usd_snapshot')
            batch_op.drop_column('salary_basis_snapshot')

    if 'finance_employee_compensation_plans' in tables:
        with op.batch_alter_table('finance_employee_compensation_plans') as batch_op:
            batch_op.drop_column('salary_basis')

    if 'employee_social_insurance' in tables:
        with op.batch_alter_table('employee_social_insurance') as batch_op:
            batch_op.alter_column('currency', server_default='USD')
