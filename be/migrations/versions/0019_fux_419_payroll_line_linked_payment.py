"""0019_fux_419_payroll_line_linked_payment

Revision ID: 0019_fux_419_payroll_line_linked_payment
Revises: 0018_fux_417_payroll_line_compensation_split
Create Date: 2026-09-18 14:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0019_fux_419_payroll_line_linked_payment'
down_revision: Union[str, None] = '0018_fux_417_payroll_line_compensation_split'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    
    # Add linked_payment_id column to finance_payroll_lines if not present
    lines_columns = [col['name'] for col in inspector.get_columns('finance_payroll_lines')]
    if 'linked_payment_id' not in lines_columns:
        with op.batch_alter_table('finance_payroll_lines') as batch_op:
            batch_op.add_column(sa.Column('linked_payment_id', sa.Integer(), nullable=True))
            batch_op.create_index(batch_op.f('ix_finance_payroll_lines_linked_payment_id'), ['linked_payment_id'], unique=False)
            batch_op.create_foreign_key(
                'fk_finance_payroll_lines_linked_payment_id',
                'finance_payments',
                ['linked_payment_id'],
                ['id'],
                ondelete='SET NULL'
            )


def downgrade() -> None:
    with op.batch_alter_table('finance_payroll_lines') as batch_op:
        batch_op.drop_constraint('fk_finance_payroll_lines_linked_payment_id', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_finance_payroll_lines_linked_payment_id'))
        batch_op.drop_column('linked_payment_id')
