"""0017_fux_416_employee_compensation_plans

Revision ID: 0017_fux_416_employee_compensation_plans
Revises: 0016_fux_411_bill_category_and_vendor_defaults
Create Date: 2026-09-17 14:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0017_fux_416_employee_compensation_plans'
down_revision: Union[str, None] = '0016_fux_411_bill_category_and_vendor_defaults'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_employee_compensation_plans' not in tables:
        op.create_table(
            'finance_employee_compensation_plans',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id', ondelete='RESTRICT'), nullable=False, index=True),
            sa.Column('component_type', sa.String(length=50), nullable=False, index=True),
            sa.Column('amount', sa.Float(), nullable=False),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('effective_start_date', sa.String(length=20), nullable=False, index=True),
            sa.Column('effective_end_date', sa.String(length=20), nullable=True, index=True),
            sa.Column('notes', sa.Text(), nullable=False, server_default=''),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        )
        op.create_index(
            'ix_emp_comp_plan_lookup',
            'finance_employee_compensation_plans',
            ['employee_id', 'component_type', 'effective_end_date'],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_employee_compensation_plans' in tables:
        op.drop_index('ix_emp_comp_plan_lookup', table_name='finance_employee_compensation_plans')
        op.drop_table('finance_employee_compensation_plans')
