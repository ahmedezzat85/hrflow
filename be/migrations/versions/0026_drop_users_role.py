"""0026_drop_users_role

Revision ID: 0026_drop_users_role
Revises: 0025_payroll_split
Create Date: 2026-10-03 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0026_drop_users_role'
down_revision: Union[str, None] = '0025_payroll_split'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "users" in tables:
        columns = [c["name"] for c in inspector.get_columns("users")]
        if "role" in columns:
            with op.batch_alter_table("users") as batch_op:
                batch_op.drop_column("role")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "users" in tables:
        columns = [c["name"] for c in inspector.get_columns("users")]
        if "role" not in columns:
            with op.batch_alter_table("users") as batch_op:
                batch_op.add_column(sa.Column("role", sa.String(50), nullable=True, server_default="employee"))
