"""
be/scripts/manage_api_tokens.py
Creates, lists and revokes personal access tokens for the MCP server (see api_tokens.py).

Usage (inside the app container, or locally with the backend environment):
    python scripts/manage_api_tokens.py create --email owner@example.com --name "claude mcp" [--days 30] [--scopes mcp:read]
    python scripts/manage_api_tokens.py list
    python scripts/manage_api_tokens.py revoke --id 3

`create` prints the secret once; only its hash is stored. Tokens expire (default 30 days, at most 90).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api_tokens
from db import get_db_context, init_db
from models_db import ApiTokenDB, UserDB


def _create(args) -> int:
    with get_db_context() as db:
        user = db.query(UserDB).filter(UserDB.email.ilike(args.email.strip())).first()
        if user is None or user.archived_at is not None:
            print(f"ERROR: no active user {args.email}", file=sys.stderr)
            return 1
        try:
            row, secret = api_tokens.create_token(db, user.id, args.name, args.scopes.split(","), args.days)
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
        print(f"Token id {row.id} for {user.email}, scopes {row.scopes}, expires {row.expires_at:%Y-%m-%d}.")
        print("Secret (shown once, store it as HRFLOW_API_TOKEN):")
        print(secret)
    return 0


def _list(_args) -> int:
    with get_db_context() as db:
        for t in db.query(ApiTokenDB).order_by(ApiTokenDB.id).all():
            state = "revoked" if t.revoked_at else "active"
            print(f"{t.id}\tuser={t.user_id}\t{t.name}\t{t.scopes}\texpires={t.expires_at:%Y-%m-%d}\t"
                  f"last_used={t.last_used_at or '-'}\t{state}")
    return 0


def _revoke(args) -> int:
    from datetime import datetime
    with get_db_context() as db:
        row = db.get(ApiTokenDB, args.id)
        if row is None:
            print(f"ERROR: no token {args.id}", file=sys.stderr)
            return 1
        row.revoked_at = row.revoked_at or datetime.utcnow()
    print(f"Token {args.id} revoked.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage HRFlow personal access tokens.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    create = sub.add_parser("create")
    create.add_argument("--email", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--days", type=int, default=api_tokens.DEFAULT_DAYS)
    create.add_argument("--scopes", default="mcp:read")
    sub.add_parser("list")
    revoke = sub.add_parser("revoke")
    revoke.add_argument("--id", type=int, required=True)
    args = parser.parse_args()

    init_db()
    return {"create": _create, "list": _list, "revoke": _revoke}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
