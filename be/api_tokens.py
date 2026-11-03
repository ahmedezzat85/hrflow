"""
api_tokens.py
Personal access tokens for the MCP server (docs/mcp-server-plan.md, section 4). A token is `hrf_` plus 256 random
bits; only its SHA-256 is stored. A request carrying `Authorization: Bearer hrf_...` acts as the token's user with
that user's permissions narrowed to the token's scopes, so a token can never do more than its owner's role.
Tokens are created and revoked on the host (scripts/manage_api_tokens.py), never through the API, so a leaked
token cannot mint another.
"""
import hashlib
import secrets
from dataclasses import replace
from datetime import datetime, timedelta
from typing import FrozenSet, Optional, Set

from sqlalchemy.orm import Session

TOKEN_PREFIX = "hrf_"
DEFAULT_DAYS = 30
MAX_DAYS = 90
_LAST_USED_GRANULARITY_SECONDS = 60

# Scope name -> the permission keys it can use. Effective permissions = the user's permissions ∩ these.
SCOPES = {
    "mcp:read": frozenset({"hr.employee.read", "hr.vacation.read", "hr.request.read"}),
}


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token_secret() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def parse_scopes(scopes: str) -> FrozenSet[str]:
    return frozenset(s for s in scopes.split(",") if s)


def allowed_permissions(scopes: str) -> Set[str]:
    allowed: Set[str] = set()
    for scope in parse_scopes(scopes):
        allowed |= SCOPES.get(scope, frozenset())
    return allowed


def create_token(db: Session, user_id: int, name: str, scopes: list, days: int = DEFAULT_DAYS):
    """Creates a token row and returns (row, secret). The secret is not stored and cannot be shown again."""
    from models_db import ApiTokenDB

    unknown = [s for s in scopes if s not in SCOPES]
    if unknown or not scopes:
        raise ValueError(f"Scopes must be a non-empty subset of {sorted(SCOPES)}; got {scopes}")
    if not 1 <= days <= MAX_DAYS:
        raise ValueError(f"days must be between 1 and {MAX_DAYS}")
    secret = new_token_secret()
    row = ApiTokenDB(
        user_id=user_id, name=name.strip()[:100], token_hash=hash_token(secret), scopes=",".join(sorted(set(scopes))),
        created_at=datetime.utcnow(), expires_at=datetime.utcnow() + timedelta(days=days),
    )
    db.add(row)
    db.commit()
    return row, secret


def lookup_token(db: Session, secret: str):
    """The live token row for a secret, or None when unknown, revoked or expired."""
    from models_db import ApiTokenDB

    if not secret.startswith(TOKEN_PREFIX):
        return None
    row = db.query(ApiTokenDB).filter(ApiTokenDB.token_hash == hash_token(secret)).first()
    now = datetime.utcnow()
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        return None
    if row.last_used_at is None or (now - row.last_used_at).total_seconds() > _LAST_USED_GRANULARITY_SECONDS:
        row.last_used_at = now
        db.commit()
    return row


def narrow_context(ctx, scopes: str):
    """The user's AccessContext limited to what the token's scopes allow."""
    perms = set(ctx.permissions) & allowed_permissions(scopes)
    return replace(ctx, permissions=perms, is_super_admin=False)


def revoke_user_tokens(db: Session, user_id: int) -> None:
    from models_db import ApiTokenDB

    now = datetime.utcnow()
    db.query(ApiTokenDB).filter(ApiTokenDB.user_id == user_id, ApiTokenDB.revoked_at.is_(None)).update(
        {ApiTokenDB.revoked_at: now}, synchronize_session=False)
    db.commit()
