"""0072_auth_sessions

Adds `auth_sessions`: one row per Google sign-in. The session cookie carries the row id; the row holds the user's
Google refresh token (encrypted by the application, never plain text), the last time Google confirmed it, the
absolute end of the session and when it was revoked. Rows are removed with their user. The table starts empty:
cookies issued before this release have no row and simply stop working at their own expiry, then users sign in again.
The downgrade drops the table.

Revision ID: 0072_auth_sessions
Revises: 0071_holidays
Create Date: 2026-11-11 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0072_auth_sessions'
down_revision: Union[str, None] = '0071_holidays'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "auth_sessions" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("refresh_token_enc", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_refreshed_at", sa.DateTime(), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])


def downgrade() -> None:
    if "auth_sessions" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
        op.drop_table("auth_sessions")
