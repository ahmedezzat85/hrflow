"""
be/tests/test_migrate_file_layout.py
Unit and integration tests for F4 file layout migration tool (scripts/migrate_file_layout.py).
"""
import os
import sys
import pytest

# Ensure scripts/ is accessible
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS_DIR = os.path.join(REPO_ROOT, "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import file_layout
from migrate_file_layout import FileMigrator, _compute_sha256
from finance.models import BillDB, VendorDB, FinanceAttachmentDB, FinanceChequeDB, FinanceBankAccountDB
from models_db import EmployeeDB, EmployeeDocumentDB, CompanyDocumentDB, SalaryPaymentDocDB
from db import get_db_context


@pytest.fixture
def db_session(app_client):
    with get_db_context() as session:
        yield session


def test_dry_run_leaves_files_untouched_and_reports_pending(db_session, monkeypatch, tmp_path):
    root = tmp_path / "files_root"
    root.mkdir()
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(root))

    # Create legacy file in legacy uploads directory
    legacy_dir = tmp_path / "legacy_bills"
    legacy_dir.mkdir()
    legacy_file = legacy_dir / "old_bill_123.pdf"
    content = b"%PDF-1.4 dummy bill content for dry run"
    legacy_file.write_bytes(content)

    # Create DB record pointing to legacy file
    vendor = VendorDB(name="Acme Corp", category="Software")
    db_session.add(vendor)
    db_session.flush()

    bill = BillDB(
        bill_number="BILL-DRY-01",
        vendor_id=vendor.id,
        issue_date="2026-04-10",
        due_date="2026-05-10",
        currency="USD",
        total=100.0,
        status="approved",
        attachment_url=str(legacy_file),
        attachment_name="old_bill_123.pdf",
    )
    db_session.add(bill)
    db_session.commit()

    migrator = FileMigrator(root=str(root), apply=False)
    summary = migrator.run_migrations(db_session)

    assert summary.get("dry_run_pending") == 1

    # In dry run, DB record must NOT be updated
    db_session.refresh(bill)
    assert bill.attachment_url == str(legacy_file)

    # Legacy file must still exist
    assert legacy_file.exists()

    # Target path under root must NOT exist yet
    expected_ref = file_layout.build_ref("bill", date="2026-04-10", bill_id=bill.id, vendor_slug="Acme Corp", ext="pdf")
    target_path = root / expected_ref
    assert not target_path.exists()


def test_apply_migration_moves_file_verifies_sha256_and_updates_db(db_session, monkeypatch, tmp_path):
    root = tmp_path / "files_root"
    root.mkdir()
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(root))

    # Create legacy file
    legacy_dir = tmp_path / "legacy_bills"
    legacy_dir.mkdir()
    legacy_file = legacy_dir / "old_bill_apply.pdf"
    content = b"%PDF-1.4 real migration content with unique hash"
    legacy_file.write_bytes(content)
    orig_sha = _compute_sha256(str(legacy_file))

    vendor = VendorDB(name="Vercel", category="Hosting")
    db_session.add(vendor)
    db_session.flush()

    bill = BillDB(
        bill_number="BILL-APPLY-01",
        vendor_id=vendor.id,
        issue_date="2026-05-15",
        due_date="2026-06-15",
        currency="USD",
        total=250.0,
        status="approved",
        attachment_url=str(legacy_file),
        attachment_name="old_bill_apply.pdf",
    )
    db_session.add(bill)
    db_session.commit()

    migrator = FileMigrator(root=str(root), apply=True)
    summary = migrator.run_migrations(db_session)

    assert summary.get("migrated") == 1

    # DB record must now have relative layout-v1 ref
    db_session.refresh(bill)
    expected_ref = file_layout.build_ref("bill", date="2026-05-15", bill_id=bill.id, vendor_slug="Vercel", ext="pdf")
    assert bill.attachment_url == expected_ref

    # Target file must exist and match original SHA-256
    target_path = root / expected_ref
    assert target_path.exists()
    assert _compute_sha256(str(target_path)) == orig_sha

    # Legacy file must have been deleted
    assert not legacy_file.exists()


def test_idempotent_rerun_reports_already_migrated(db_session, monkeypatch, tmp_path):
    root = tmp_path / "files_root"
    root.mkdir()
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(root))

    # Set up already migrated bill
    ref = file_layout.build_ref("bill", date="2026-06-01", bill_id=99, vendor_slug="AWS", ext="pdf")
    target_path = root / ref
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(b"AWS invoice content")

    vendor = VendorDB(name="AWS", category="Cloud")
    db_session.add(vendor)
    db_session.flush()

    bill = BillDB(
        id=99,
        bill_number="BILL-AWS-01",
        vendor_id=vendor.id,
        issue_date="2026-06-01",
        due_date="2026-07-01",
        currency="USD",
        total=500.0,
        status="approved",
        attachment_url=ref,
        attachment_name="bill.pdf",
    )
    db_session.add(bill)
    db_session.commit()

    migrator = FileMigrator(root=str(root), apply=True)
    summary = migrator.run_migrations(db_session)

    assert summary.get("already_migrated") == 1
    assert summary.get("migrated", 0) == 0


def test_missing_disk_file_reported_without_crashing(db_session, monkeypatch, tmp_path):
    root = tmp_path / "files_root"
    root.mkdir()
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(root))

    vendor = VendorDB(name="Ghost Vendor", category="Unknown")
    db_session.add(vendor)
    db_session.flush()

    bill = BillDB(
        bill_number="BILL-GHOST-01",
        vendor_id=vendor.id,
        issue_date="2026-07-01",
        due_date="2026-08-01",
        currency="USD",
        total=50.0,
        status="draft",
        attachment_url="/non/existent/path/to/ghost.pdf",
        attachment_name="ghost.pdf",
    )
    db_session.add(bill)
    db_session.commit()

    migrator = FileMigrator(root=str(root), apply=True)
    summary = migrator.run_migrations(db_session)

    assert summary.get("missing_disk_file") == 1


def test_scan_orphans_detects_untracked_files_without_deleting(db_session, monkeypatch, tmp_path):
    root = tmp_path / "files_root"
    root.mkdir()
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(root))

    # Create an orphan file under root
    orphan_dir = root / "untracked_folder"
    orphan_dir.mkdir()
    orphan_file = orphan_dir / "random_orphan.pdf"
    orphan_file.write_bytes(b"orphan data")

    migrator = FileMigrator(root=str(root), apply=True)
    # Run migrations first so known refs are populated
    migrator.run_migrations(db_session)
    orphan_count = migrator.scan_orphans()

    assert orphan_count >= 1
    assert any(r["status"] == "orphan_disk_file" and "random_orphan.pdf" in r["old_ref"] for r in migrator.report_rows)
    # Crucial rule: orphan file must NOT be deleted
    assert orphan_file.exists()


def test_csv_report_generation(db_session, monkeypatch, tmp_path):
    root = tmp_path / "files_root"
    root.mkdir()
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(root))

    migrator = FileMigrator(root=str(root), apply=False)
    migrator.record("TestEntity", "1", "old/path", "new/path", "dry_run_pending", sha256="abc123sha")

    report_path = tmp_path / "audit_report.csv"
    generated_path = migrator.write_csv_report(str(report_path))

    assert os.path.exists(generated_path)
    content = report_path.read_text(encoding="utf-8")
    assert "entity_type,entity_id,old_ref,new_ref,status,sha256,error" in content
    assert "TestEntity,1,old/path,new/path,dry_run_pending,abc123sha" in content
