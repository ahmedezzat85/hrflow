"""
be/scripts/bootstrap_admin.py
Creates (or repairs) the first Super-Admin user on a fresh database.

Usage (inside the app container):
    python scripts/bootstrap_admin.py --email admin@example.com [--name "Full Name"]

Idempotent: safe to run more than once. The email must match the Google account
used to sign in (and the ALLOWED_WORKSPACE_DOMAIN, if configured).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_db_context, init_db
from models_db import UserDB
from core.rbac_models import RoleDB, UserRoleDB


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the first HRFlow Super-Admin.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="")
    args = parser.parse_args()
    email = args.email.strip().lower()

    init_db()  # ensures the RBAC catalog and the Super-Admin role exist
    with get_db_context() as db:
        role = db.query(RoleDB).filter(RoleDB.name == "Super-Admin").first()
        if role is None:
            print("ERROR: Super-Admin role not found; run migrations first.", file=sys.stderr)
            return 1
        user = db.query(UserDB).filter(UserDB.email.ilike(email)).first()
        if user is None:
            user = UserDB(email=email, name=args.name or None)
            db.add(user)
            db.flush()
        user.archived_at = None
        link = db.query(UserRoleDB).filter(UserRoleDB.user_id == user.id).first()
        if link is None:
            db.add(UserRoleDB(user_id=user.id, role_id=role.id))
        else:
            link.role_id = role.id
    print(f"Super-Admin ready: {email}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
