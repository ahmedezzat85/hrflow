"""0002_rename_invoices_to_salary_payment_docs

Revision ID: 0002_rename_invoices_to_salary_payment_docs
Revises: 0001_initial_schema
Create Date: 2026-09-08 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0002_rename_invoices_to_salary_payment_docs'
down_revision: Union[str, None] = '0001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename table 'invoices' to 'salary_payment_docs'
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'invoices' in tables and 'salary_payment_docs' not in tables:
        op.rename_table('invoices', 'salary_payment_docs')


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'salary_payment_docs' in tables and 'invoices' not in tables:
        op.rename_table('salary_payment_docs', 'invoices')
