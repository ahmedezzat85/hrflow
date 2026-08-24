"""
be/tests/test_migration_and_reconciliation.py
Tests verifying the backfill and reconciliation pipeline from Google Sheets to SQL.
"""
import pytest
from sqlalchemy import create_engine

from db import Base, reset_engine_for_testing
from scripts.backfill_sheets_to_sql import backfill_all
from scripts.reconcile_stores import reconcile


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


def test_backfill_and_reconciliation(fake_sheets_client):
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

    # 2. Run reconciliation
    report = reconcile(client=fake_sheets_client)
    for domain, r in report.items():
        assert r["status"] == "PASS", f"Reconciliation failed on {domain}: {r['mismatches']}"
        assert len(r["mismatches"]) == 0

    # 3. Test idempotency (running backfill a second time should succeed without duplicating)
    stats2 = backfill_all(client=fake_sheets_client)
    assert stats2["employees"] == stats["employees"]

    report2 = reconcile(client=fake_sheets_client)
    for domain, r in report2.items():
        assert r["status"] == "PASS"
