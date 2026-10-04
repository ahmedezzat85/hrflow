"""0027_single_assigned_role

One assigned role per user: drop explicit Employee rows (the Employee baseline is
derived from users.employee_id), keep a single row for any user that still holds
several, and add a unique constraint on user_roles.user_id.

Revision ID: 0027_single_assigned_role
Revises: 0026_drop_users_role
Create Date: 2026-10-03 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = '0027_single_assigned_role'
down_revision: Union[str, None] = '0026_drop_users_role'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT_NAME = 'uq_user_roles_user'


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Explicit Employee rows are legacy: the baseline is derived from employee_id.
    bind.execute(text(
        "DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE system_key = 'employee')"
    ))

    # 2. Users that still hold several rows keep one: Super-Admin if present, else the lowest role_id.
    rows = bind.execute(text(
        "SELECT ur.id, ur.user_id, ur.role_id, r.system_key "
        "FROM user_roles ur JOIN roles r ON r.id = ur.role_id "
        "ORDER BY ur.user_id, ur.role_id"
    )).fetchall()
    by_user = {}
    for row_id, user_id, role_id, system_key in rows:
        by_user.setdefault(user_id, []).append((row_id, role_id, system_key))
    drop_ids = []
    for entries in by_user.values():
        if len(entries) < 2:
            continue
        keep = next((e for e in entries if e[2] == 'super_admin'), entries[0])
        drop_ids.extend(e[0] for e in entries if e[0] != keep[0])
    if drop_ids:
        bind.execute(
            text("DELETE FROM user_roles WHERE id IN :ids").bindparams(sa.bindparam("ids", expanding=True)),
            {"ids": drop_ids},
        )

    # 3. One row per user from now on.
    with op.batch_alter_table('user_roles') as batch_op:
        batch_op.create_unique_constraint(CONSTRAINT_NAME, ['user_id'])


def downgrade() -> None:
    with op.batch_alter_table('user_roles') as batch_op:
        batch_op.drop_constraint(CONSTRAINT_NAME, type_='unique')
