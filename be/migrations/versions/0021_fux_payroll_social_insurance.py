"""0021_fux_payroll_social_insurance

Revision ID: 0021_fux_payroll_social_insurance
Revises: 0020_fux_420_payroll_dual_funding_accounts
Create Date: 2026-09-23 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0021_fux_payroll_social_insurance'
down_revision: Union[str, None] = '0020_fux_420_payroll_dual_funding_accounts'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Create employee_social_insurance table
    if 'employee_social_insurance' not in tables:
        op.create_table(
            'employee_social_insurance',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('insured_flag', sa.Boolean(), nullable=False, server_default=sa.text('0')),
            sa.Column('insured_base', sa.Float(), nullable=True),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('effective_start_date', sa.String(length=20), nullable=False, index=True),
            sa.Column('effective_end_date', sa.String(length=20), nullable=True, index=True),
            sa.Column('notes', sa.Text(), nullable=False, server_default=''),
            sa.Column('created_by', sa.String(length=255), nullable=True, server_default=''),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        )
        op.create_index(
            'ix_emp_social_ins_lookup',
            'employee_social_insurance',
            ['employee_id', 'effective_end_date'],
        )

    # 2. Create finance_payroll_settings table
    if 'finance_payroll_settings' not in tables:
        op.create_table(
            'finance_payroll_settings',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('employee_rate', sa.Float(), nullable=False, server_default='0.11'),
            sa.Column('employer_rate', sa.Float(), nullable=False, server_default='0.18'),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_by', sa.String(length=255), nullable=True, server_default='system'),
        )
        # Seed initial default rates
        bind.execute(
            sa.text(
                "INSERT INTO finance_payroll_settings (id, employee_rate, employer_rate, updated_by) "
                "VALUES (1, 0.11, 0.18, 'system')"
            )
        )

    # 3. Add snapshot columns to finance_payroll_lines
    lines_columns = [col['name'] for col in inspector.get_columns('finance_payroll_lines')]
    if 'insured_base_snapshot' not in lines_columns:
        op.add_column('finance_payroll_lines', sa.Column('insured_base_snapshot', sa.Float(), nullable=True, server_default='0.0'))
    if 'employee_rate_snapshot' not in lines_columns:
        op.add_column('finance_payroll_lines', sa.Column('employee_rate_snapshot', sa.Float(), nullable=True, server_default='0.0'))
    if 'employer_rate_snapshot' not in lines_columns:
        op.add_column('finance_payroll_lines', sa.Column('employer_rate_snapshot', sa.Float(), nullable=True, server_default='0.0'))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'employee_social_insurance' in tables:
        op.drop_index('ix_emp_social_ins_lookup', table_name='employee_social_insurance')
        op.drop_table('employee_social_insurance')

    if 'finance_payroll_settings' in tables:
        op.drop_table('finance_payroll_settings')

    with op.batch_alter_table('finance_payroll_lines') as batch_op:
        batch_op.drop_column('employer_rate_snapshot')
        batch_op.drop_column('employee_rate_snapshot')
        batch_op.drop_column('insured_base_snapshot')
