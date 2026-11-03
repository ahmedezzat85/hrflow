"""api_tokens: personal access tokens for the MCP server (MCP-1)

Revision ID: 0073_api_tokens
Revises: 0072_auth_sessions
Create Date: 2026-11-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0073_api_tokens'
down_revision: Union[str, None] = '0072_auth_sessions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "api_tokens" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("scopes", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_api_tokens_user_id", "api_tokens", ["user_id"])


def downgrade() -> None:
    if "api_tokens" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_index("ix_api_tokens_user_id", table_name="api_tokens")
        op.drop_table("api_tokens")
