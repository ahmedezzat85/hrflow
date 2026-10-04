"""
be/scripts/rbac_pre_migration_check.py
Read-only pre-migration inspection script for the RBAC initiative.
Checks the database for:
1. Users where employee_id IS NULL (external or unlinked users)
2. Users with no assigned roles in user_roles
3. Duplicate user emails (case-insensitive)

Can be run against local/test SQLite or staging/production PostgreSQL.
Usage:
    python scripts/rbac_pre_migration_check.py [--db-url URL]
"""
import sys
import os
import argparse
from typing import Dict, Any, List
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

from config import Config
from models_db import UserDB
from core.rbac_models import UserRoleDB, RoleDB


def run_rbac_pre_migration_check(db_url: str = None) -> Dict[str, Any]:
    url = db_url or Config.DATABASE_URL
    print(f"Connecting to database: {url}")
    engine = create_engine(url)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()

    report = {
        "total_users": 0,
        "users_no_employee": [],
        "users_no_roles": [],
        "duplicate_emails": [],
    }

    try:
        users = session.query(UserDB).all()
        report["total_users"] = len(users)

        # 1. Users with employee_id IS NULL
        for u in users:
            if u.employee_id is None:
                report["users_no_employee"].append({
                    "id": u.id,
                    "email": u.email,
                    "role": getattr(u, "role", None),
                })

        # 2. Users with no assigned roles in user_roles
        user_role_counts = defaultdict(int)
        for ur in session.query(UserRoleDB).all():
            user_role_counts[ur.user_id] += 1

        for u in users:
            if user_role_counts[u.id] == 0:
                report["users_no_roles"].append({
                    "id": u.id,
                    "email": u.email,
                    "role": getattr(u, "role", None),
                    "employee_id": u.employee_id,
                })

        # 3. Duplicate emails (case-insensitive)
        email_map = defaultdict(list)
        for u in users:
            norm_email = u.email.strip().lower() if u.email else ""
            email_map[norm_email].append(u.id)

        for email, user_ids in email_map.items():
            if len(user_ids) > 1:
                report["duplicate_emails"].append({
                    "email": email,
                    "user_ids": user_ids,
                    "count": len(user_ids),
                })

        # Print human-readable report
        print("\n=== RBAC PRE-MIGRATION DATA CHECK REPORT ===")
        print(f"Total Users: {report['total_users']}")

        print(f"\n1. Users with employee_id IS NULL ({len(report['users_no_employee'])} found):")
        for item in report["users_no_employee"]:
            print(f"   - User ID {item['id']}: {item['email']} (role: {item['role']})")
        if not report["users_no_employee"]:
            print("   None.")

        print(f"\n2. Users with NO assigned roles in user_roles ({len(report['users_no_roles'])} found):")
        for item in report["users_no_roles"]:
            print(f"   - User ID {item['id']}: {item['email']} (legacy role: {item['role']}, employee_id: {item['employee_id']})")
        if not report["users_no_roles"]:
            print("   None.")

        print(f"\n3. Duplicate emails (case-insensitive) ({len(report['duplicate_emails'])} found):")
        for item in report["duplicate_emails"]:
            print(f"   - Email '{item['email']}': user IDs {item['user_ids']}")
        if not report["duplicate_emails"]:
            print("   None.")

        print("\n=== END OF REPORT ===\n")
        return report

    finally:
        session.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RBAC pre-migration data validation check.")
    parser.add_argument("--db-url", type=str, default=None, help="Database URL to check (defaults to Config.DATABASE_URL)")
    args = parser.parse_args()

    run_rbac_pre_migration_check(db_url=args.db_url)
