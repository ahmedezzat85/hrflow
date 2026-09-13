"""0005_customer_vendor_is_active

Revision ID: 0005_customer_vendor_is_active
Revises: 0004_finance_data_model
Create Date: 2026-09-09 13:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0005_customer_vendor_is_active'
down_revision: Union[str, None] = '0004_finance_data_model'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. finance_customers.is_active
    cust_cols = [c['name'] for c in inspector.get_columns('finance_customers')]
    if 'is_active' not in cust_cols:
        op.add_column(
            'finance_customers',
            sa.Column('is_active', sa.Boolean(), server_default=sa.text('1'), nullable=False)
        )

    # 2. finance_vendors.is_active
    vendor_cols = [c['name'] for c in inspector.get_columns('finance_vendors')]
    if 'is_active' not in vendor_cols:
        op.add_column(
            'finance_vendors',
            sa.Column('is_active', sa.Boolean(), server_default=sa.text('1'), nullable=False)
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    cust_cols = [c['name'] for c in inspector.get_columns('finance_customers')]
    if 'is_active' in cust_cols:
        op.drop_column('finance_customers', 'is_active')

    vendor_cols = [c['name'] for c in inspector.get_columns('finance_vendors')]
    if 'is_active' in vendor_cols:
        op.drop_column('finance_vendors', 'is_active')
