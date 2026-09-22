"""0018_fux_417_payroll_line_compensation_split

Revision ID: 0018_fux_417_payroll_line_compensation_split
Revises: 0017_fux_416_employee_compensation_plans
Create Date: 2026-09-17 15:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0018_fux_417_payroll_line_compensation_split'
down_revision: Union[str, None] = '0017_fux_416_employee_compensation_plans'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    
    # 1. Add columns to finance_payroll_runs
    runs_columns = [col['name'] for col in inspector.get_columns('finance_payroll_runs')]
    if 'fx_rate_source' not in runs_columns:
        op.add_column('finance_payroll_runs', sa.Column('fx_rate_source', sa.String(length=30), nullable=True, server_default='first_of_month'))
    if 'fx_rate_value' not in runs_columns:
        op.add_column('finance_payroll_runs', sa.Column('fx_rate_value', sa.Float(), nullable=True))

    # 2. Add columns to finance_payroll_lines
    lines_columns = [col['name'] for col in inspector.get_columns('finance_payroll_lines')]
    if 'compensation_type' not in lines_columns:
        op.add_column('finance_payroll_lines', sa.Column('compensation_type', sa.String(length=50), nullable=True, server_default='internal_usd_cash'))
    if 'is_taxable_local' not in lines_columns:
        op.add_column('finance_payroll_lines', sa.Column('is_taxable_local', sa.Boolean(), nullable=True, server_default=sa.text('1')))
    if 'is_insurable' not in lines_columns:
        op.add_column('finance_payroll_lines', sa.Column('is_insurable', sa.Boolean(), nullable=True, server_default=sa.text('1')))

    # Backfill existing rows
    bind.execute(sa.text("UPDATE finance_payroll_lines SET compensation_type = 'internal_usd_cash' WHERE compensation_type IS NULL"))
    bind.execute(sa.text("UPDATE finance_payroll_lines SET is_taxable_local = 1 WHERE is_taxable_local IS NULL"))
    bind.execute(sa.text("UPDATE finance_payroll_lines SET is_insurable = 1 WHERE is_insurable IS NULL"))
    bind.execute(sa.text("UPDATE finance_payroll_runs SET fx_rate_source = 'first_of_month' WHERE fx_rate_source IS NULL"))


def downgrade() -> None:
    # SQLite does not easily support drop_column in older versions, but batch operations can be used if needed
    with op.batch_alter_table('finance_payroll_lines') as batch_op:
        batch_op.drop_column('is_insurable')
        batch_op.drop_column('is_taxable_local')
        batch_op.drop_column('compensation_type')

    with op.batch_alter_table('finance_payroll_runs') as batch_op:
        batch_op.drop_column('fx_rate_value')
        batch_op.drop_column('fx_rate_source')
