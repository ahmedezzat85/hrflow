"""
be/tests/test_migration_and_reconciliation.py
Tests verifying the backfill, reconciliation, and cold-storage export pipeline
from Google Sheets to SQL.
"""
import os
import json
import pytest
from sqlalchemy import create_engine

from db import Base, reset_engine_for_testing, get_db_context
from models_db import EmployeeDB, EmployeeBankAccountDB
from scripts.backfill_sheets_to_sql import backfill_all
from scripts.reconcile_stores import reconcile
from scripts.export_sheets_cold_storage import export_cold_storage


@pytest.fixture(autouse=True)
def setup_test_sql_db(tmp_path):
    db_file = tmp_path / "test_migration.db"
    db_url = f"sqlite:///{db_file}"
    reset_engine_for_testing(db_url)
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    reset_engine_for_testing(None)


def test_cold_storage_export(fake_sheets_client, tmp_path):
    output_dir = str(tmp_path / "cold_storage_test")

    # Seed data
    fake_sheets_client.append_row("EmployeeBankAccounts", {
        "employee_id": 1,
        "bank_name": "CIB",
        "iban": "EG1234567890",
        "swift_code": "CIBE",
        "updated_by": "admin@hrflow.test",
        "updated_at": "2026-08-20",
    })

    # 1. Test dry-run (no files written)
    dry_stats = export_cold_storage(client=fake_sheets_client, output_dir=output_dir, dry_run=True)
    assert dry_stats["dry_run"] is True
    assert dry_stats["total_records"] > 0
    assert not os.path.exists(output_dir)

    # 2. Test actual export
    stats = export_cold_storage(client=fake_sheets_client, output_dir=output_dir, dry_run=False)
    assert stats["total_records"] > 0
    assert os.path.exists(output_dir)

    # Verify manifest
    manifest_path = os.path.join(output_dir, "manifest.json")
    assert os.path.exists(manifest_path)
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    assert manifest["total_records"] == stats["total_records"]

    # Verify JSON and CSV files exist
    assert os.path.exists(os.path.join(output_dir, "Employees.json"))
    assert os.path.exists(os.path.join(output_dir, "Employees.csv"))
    assert os.path.exists(os.path.join(output_dir, "EmployeeBankAccounts.json"))
    assert os.path.exists(os.path.join(output_dir, "EmployeeBankAccounts.csv"))


def test_backfill_dry_run_and_domain_filter(fake_sheets_client):
    fake_sheets_client.append_row("EmployeeBankAccounts", {
        "employee_id": 1,
        "bank_name": "QNB",
        "iban": "EG987654321",
        "swift_code": "QNBE",
        "updated_by": "admin@hrflow.test",
        "updated_at": "2026-08-20",
    })

    # 1. Dry run should not commit employees
    dry_stats = backfill_all(client=fake_sheets_client, domain="all", dry_run=True)
    assert dry_stats["employees"] > 0
    with get_db_context() as db:
        assert db.query(EmployeeDB).count() == 0

    # 2. Backfill only bank domain (without employees)
    stats = backfill_all(client=fake_sheets_client, domain="bank", dry_run=False)
    assert stats["bank_accounts"] == 1
    assert stats["employees"] == 0
    with get_db_context() as db:
        assert db.query(EmployeeBankAccountDB).count() == 1
        assert db.query(EmployeeDB).count() == 0


def test_backfill_and_reconciliation_full(fake_sheets_client):
    # Seed additional records to test all tables
    fake_sheets_client.append_row("EmployeeBankAccounts", {
        "employee_id": 1,
        "bank_name": "CIB",
        "iban": "EG1234567890",
        "swift_code": "CIBE",
        "updated_by": "admin@hrflow.test",
        "updated_at": "2026-08-20",
    })
    fake_sheets_client.append_row("Invoices", {
        "id": 1,
        "employee_id": 1,
        "employee_name": "Admin One",
        "invoice_number": "260801",
        "payment_year": 2026,
        "payment_month": 8,
        "amount_usd": 5000.0,
        "currency": "USD",
        "status": "generated",
    })

    # 1. Run backfill
    stats = backfill_all(client=fake_sheets_client)
    assert stats["employees"] > 0
    assert stats["users"] > 0
    assert stats["bank_accounts"] > 0
    assert stats["insurance_categories"] > 0
    assert stats["invoices"] > 0

    # 2. Run reconciliation on single domain
    report_bank = reconcile(client=fake_sheets_client, domain="bank")
    assert "bank_accounts" in report_bank
    assert report_bank["bank_accounts"]["status"] == "PASS"

    # 3. Run reconciliation on all domains
    report = reconcile(client=fake_sheets_client, domain="all")
    for domain, r in report.items():
        assert r["status"] == "PASS", f"Reconciliation failed on {domain}: {r['mismatches']}"
        assert len(r["mismatches"]) == 0

    # 4. Test idempotency (running backfill a second time should succeed without duplicating)
    stats2 = backfill_all(client=fake_sheets_client)
    assert stats2["employees"] == stats["employees"]

    report2 = reconcile(client=fake_sheets_client)
    for domain, r in report2.items():
        assert r["status"] == "PASS"

    # 5. Test discrepancy detection when a row is removed from SQL
    with get_db_context() as db:
        bank = db.query(EmployeeBankAccountDB).first()
        db.delete(bank)

    mismatch_report = reconcile(client=fake_sheets_client, domain="bank")
    assert mismatch_report["bank_accounts"]["status"] == "FAIL"
    assert len(mismatch_report["bank_accounts"]["mismatches"]) > 0
