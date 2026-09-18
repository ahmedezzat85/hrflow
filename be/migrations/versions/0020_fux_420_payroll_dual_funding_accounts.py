"""0020_fux_420_payroll_dual_funding_accounts

Revision ID: 0020_fux_420_payroll_dual_funding_accounts
Revises: 0019_fux_419_payroll_line_linked_payment
Create Date: 2026-09-18 18:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0020_fux_420_payroll_dual_funding_accounts'
down_revision: Union[str, None] = '0019_fux_419_payroll_line_linked_payment'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Add external_funding_account_id and internal_funding_account_id to finance_payroll_runs
    runs_columns = [col['name'] for col in inspector.get_columns('finance_payroll_runs')]
    with op.batch_alter_table('finance_payroll_runs') as batch_op:
        if 'external_funding_account_id' not in runs_columns:
            batch_op.add_column(sa.Column('external_funding_account_id', sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                'fk_finance_payroll_runs_external_funding_account_id',
                'finance_bank_accounts',
                ['external_funding_account_id'],
                ['id'],
                ondelete='SET NULL'
            )
        if 'internal_funding_account_id' not in runs_columns:
            batch_op.add_column(sa.Column('internal_funding_account_id', sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                'fk_finance_payroll_runs_internal_funding_account_id',
                'finance_bank_accounts',
                ['internal_funding_account_id'],
                ['id'],
                ondelete='SET NULL'
            )


def downgrade() -> None:
    with op.batch_alter_table('finance_payroll_runs') as batch_op:
        batch_op.drop_constraint('fk_finance_payroll_runs_internal_funding_account_id', type_='foreignkey')
        batch_op.drop_column('internal_funding_account_id')
        batch_op.drop_constraint('fk_finance_payroll_runs_external_funding_account_id', type_='foreignkey')
        batch_op.drop_column('external_funding_account_id')
