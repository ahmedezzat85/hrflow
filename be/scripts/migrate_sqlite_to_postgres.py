"""
be/scripts/migrate_sqlite_to_postgres.py
Migrates all active records from SQLite (hrflow.db) into PostgreSQL.
Preserves primary keys, relationships, and resets PostgreSQL sequences.

Usage:
    python scripts/migrate_sqlite_to_postgres.py [--source-url URL] [--dest-url URL] [--dry-run]
"""
import sys
import os
import argparse
import time
from typing import Dict, Any, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker

from config import Config
from db import Base
from models_db import (
    EmployeeDB,
    UserDB,
    SalaryHistoryDB,
    EmployeeBankAccountDB,
    EmployeeNoteDB,
    EmployeeDocumentDB,
    CompanyDocumentDB,
    InsuranceCategoryDB,
    InsuranceClaimDB,
    RequestDB,
    VacationHistoryDB,
    InvoiceDB,
    AuditLogDB,
)

# Ordered models respecting foreign key dependencies
MIGRATION_MODELS = [
    ("employees", EmployeeDB),
    ("users", UserDB),
    ("salary_history", SalaryHistoryDB),
    ("employee_bank_accounts", EmployeeBankAccountDB),
    ("employee_notes", EmployeeNoteDB),
    ("employee_documents", EmployeeDocumentDB),
    ("company_documents", CompanyDocumentDB),
    ("insurance_categories", InsuranceCategoryDB),
    ("insurance_claims", InsuranceClaimDB),
    ("requests", RequestDB),
    ("vacation_history", VacationHistoryDB),
    ("invoices", InvoiceDB),
    ("audit_log", AuditLogDB),
]


def _row_to_dict(obj) -> Dict[str, Any]:
    """Extract clean column dictionary from SQLAlchemy model instance."""
    data = {}
    for col in obj.__table__.columns:
        data[col.name] = getattr(obj, col.name)
    return data


def migrate_data(
    source_url: str = None,
    dest_url: str = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    start_time = time.time()

    # Determine connection URLs
    if not source_url:
        sqlite_path = Config.SQLITE_PATH
        source_url = f"sqlite:///{sqlite_path}"

    if not dest_url:
        dest_url = Config.DATABASE_URL
        if dest_url.startswith("sqlite"):
            raise ValueError(
                f"Destination DATABASE_URL is SQLite ('{dest_url}'). "
                "Specify a PostgreSQL destination URL via --dest-url or configure POSTGRES_* / DATABASE_URL in .env."
            )

    source_connect_args = {"check_same_thread": False} if source_url.startswith("sqlite") else {}
    dest_connect_args = {"check_same_thread": False} if dest_url.startswith("sqlite") else {}

    src_engine = create_engine(source_url, connect_args=source_connect_args)
    dst_engine = create_engine(dest_url, connect_args=dest_connect_args)

    SrcSession = sessionmaker(bind=src_engine)
    DstSession = sessionmaker(bind=dst_engine)

    stats = {
        "source_url": source_url,
        "dest_url": dest_url,
        "dry_run": dry_run,
        "tables": {},
        "total_records": 0,
    }

    if not dry_run:
        # Create schema on destination if missing
        Base.metadata.create_all(bind=dst_engine)

    with SrcSession() as src_db, DstSession() as dst_db:
        try:
            for table_name, model_cls in MIGRATION_MODELS:
                src_rows = src_db.query(model_cls).all()
                count = len(src_rows)
                stats["tables"][table_name] = count
                stats["total_records"] += count

                if not dry_run and count > 0:
                    for row in src_rows:
                        data = _row_to_dict(row)
                        # Check if record exists in destination
                        pk_col = model_cls.__table__.primary_key.columns.keys()[0]
                        pk_val = data[pk_col]

                        existing = dst_db.query(model_cls).filter(
                            getattr(model_cls, pk_col) == pk_val
                        ).first()

                        if not existing:
                            dst_obj = model_cls(**data)
                            dst_db.add(dst_obj)
                        else:
                            for k, v in data.items():
                                setattr(existing, k, v)

                    dst_db.flush()

            if not dry_run:
                dst_db.commit()

                # Reset PostgreSQL sequences so auto-increments continue correctly
                if "postgresql" in dest_url or "postgres" in dest_url:
                    inspector = inspect(dst_engine)
                    for table_name, model_cls in MIGRATION_MODELS:
                        pk_cols = [c.name for c in model_cls.__table__.primary_key.columns]
                        if len(pk_cols) == 1 and pk_cols[0] == "id":
                            try:
                                seq_sql = text(
                                    f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), "
                                    f"COALESCE((SELECT MAX(id) FROM {table_name}), 1));"
                                )
                                dst_db.execute(seq_sql)
                                dst_db.commit()
                            except Exception:
                                pass
        except Exception:
            if not dry_run:
                dst_db.rollback()
            raise

    stats["elapsed_seconds"] = round(time.time() - start_time, 2)
    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Migrate HRFlow data from SQLite (system of record) into PostgreSQL."
    )
    parser.add_argument(
        "--source-url",
        type=str,
        default=None,
        help="Source SQLite database URL (defaults to sqlite:///./hrflow.db)",
    )
    parser.add_argument(
        "--dest-url",
        type=str,
        default=None,
        help="Destination PostgreSQL connection URL (e.g. postgresql://user:pass@localhost:5432/hrflow)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Inspect SQLite records and validate schema without writing to PostgreSQL",
    )
    args = parser.parse_args()

    mode_label = "[DRY-RUN] " if args.dry_run else ""
    print(f"Starting {mode_label}SQLite -> PostgreSQL Migration...")
    try:
        results = migrate_data(
            source_url=args.source_url,
            dest_url=args.dest_url,
            dry_run=args.dry_run,
        )
    except Exception as e:
        print(f"\n[ERROR] Migration failed: {e}")
        sys.exit(1)

    print("\n" + "=" * 60)
    print(f"{'Table Name':<30} | {'Records Migrated':<15}")
    print("-" * 60)
    for table, count in results["tables"].items():
        print(f"{table:<30} | {count:<15}")
    print("=" * 60)
    print(f"Total records: {results['total_records']} (took {results['elapsed_seconds']}s)")
    if not args.dry_run:
        print("[SUCCESS] SQLite data successfully migrated into PostgreSQL!")


if __name__ == "__main__":
    main()
