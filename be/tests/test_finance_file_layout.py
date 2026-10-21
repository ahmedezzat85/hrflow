"""
be/tests/test_finance_file_layout.py
Verification tests for F2: Finance writers store relative refs under the unified HRFLOW_FILES_ROOT layout.
Tests verify new uploads land in expected folders, refs are relative, downloads/deletes work,
and legacy files remain resolvable.
"""
import io
import os
import pytest

import file_layout
from finance.models import (
    BillDB,
    FinanceChequeDB,
    FinanceAttachmentDB,
    FinanceBankAccountDB,
    SubscriptionChargeDB,
    AccountBalanceCheckpointDB,
    LedgerTransactionDB,
    VendorDB,
)


def _setup_bank_account(db, account_name="Test CIB USD", bank_name="CIB", currency="USD"):
    acc = FinanceBankAccountDB(
        account_name=account_name,
        bank_name=bank_name,
        account_number="100029384756",
        currency=currency,
        account_type="bank",
        current_balance=50000.0,
        is_active=True,
    )
    db.add(acc)
    db.flush()
    return acc


def test_bill_upload_lands_in_layout_and_stores_relative_ref(app_client, admin_cookies, monkeypatch, tmp_path):
    """Verifies that uploading a bill attachment writes to finance/<yyyy>/bills/<yyyy-mm>/ and stores a relative ref."""
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path))

    # 0. Create vendor
    vendor_resp = app_client.post(
        "/api/finance/vendors",
        cookies=admin_cookies,
        json={"name": "Cloud Infra Inc", "category": "Operations"},
    )
    assert vendor_resp.status_code == 201
    vendor_id = vendor_resp.json()["id"]

    # 1. Create a draft bill
    draft_resp = app_client.post(
        "/api/finance/bills",
        cookies=admin_cookies,
        json={
            "vendor_id": vendor_id,
            "bill_number": "BILL-F2-001",
            "issue_date": "2026-05-12",
            "due_date": "2026-06-12",
            "currency": "USD",
            "lines": [{"description": "Hosting", "quantity": 1, "unit_price": 1200.0, "line_total": 1200.0}],
        },
    )
    assert draft_resp.status_code in (200, 201), draft_resp.text
    bill_id = draft_resp.json()["id"]

    # 2. Upload an attachment
    file_bytes = b"%PDF-1.4 Fake bill content for F2 testing"
    upload_resp = app_client.post(
        f"/api/finance/bills/{bill_id}/attachment",
        cookies=admin_cookies,
        files={"file": ("invoice_may.pdf", io.BytesIO(file_bytes), "application/pdf")},
    )
    assert upload_resp.status_code == 200, upload_resp.text
    bill_data = upload_resp.json()

    # 3. Verify ref is relative and in year-first bills layout
    rel_ref = bill_data["attachment_url"]
    assert not os.path.isabs(rel_ref)
    assert rel_ref.startswith("finance/2026/bills/2026-05/bill-")
    assert rel_ref.endswith(".pdf")

    # 4. Verify file exists on disk under tmp_path
    disk_file = tmp_path / rel_ref
    assert disk_file.is_file()
    assert disk_file.read_bytes() == file_bytes

    # 5. Verify download endpoint serves the file
    down_resp = app_client.get(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
    assert down_resp.status_code == 200
    assert down_resp.content == file_bytes

    # 6. Verify delete removes the file from disk
    del_resp = app_client.delete(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
    assert del_resp.status_code == 200
    assert not disk_file.exists()


def test_cheque_scan_upload_lands_in_account_folder(app_client, admin_cookies, monkeypatch, tmp_path):
    """Verifies cheque scans write to finance/<yyyy>/cheques/<account-folder>/chq-<num>__<id>.<ext>."""
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path))

    # 1. Create a bank account
    acc_resp = app_client.post(
        "/api/finance/accounts",
        cookies=admin_cookies,
        json={
            "account_name": "Operational CIB",
            "bank_name": "Commercial International Bank",
            "account_number": "88776655",
            "currency": "USD",
            "opening_balance": 10000.0,
            "is_active": True,
        },
    )
    assert acc_resp.status_code in (200, 201), acc_resp.text
    account_id = acc_resp.json()["id"]

    # 2. Issue a cheque
    chq_resp = app_client.post(
        "/api/finance/cheques",
        cookies=admin_cookies,
        json={
            "account_id": account_id,
            "cheque_number": "CHQ-7788",
            "issue_date": "2026-07-20",
            "amount": 350.0,
            "currency": "USD",
            "payee": "Equipment Supplier",
            "purpose_type": "other",
        },
    )
    assert chq_resp.status_code in (200, 201), chq_resp.text
    cheque_id = chq_resp.json()["id"]

    # 3. Upload a scan
    scan_bytes = b"\xFF\xD8\xFFFake JPEG cheque scan"
    upload_resp = app_client.post(
        f"/api/finance/cheques/{cheque_id}/attachments",
        cookies=admin_cookies,
        files=[("files", ("front_scan.jpg", io.BytesIO(scan_bytes), "image/jpeg"))],
    )
    assert upload_resp.status_code in (200, 201), upload_resp.text
    atts = upload_resp.json()
    assert len(atts) == 1
    att_id = atts[0]["id"]

    # Verify ref in database
    from db import get_db_context
    with get_db_context() as db:
        att_row = db.query(FinanceAttachmentDB).filter(FinanceAttachmentDB.id == att_id).one()
        rel_ref = att_row.storage_ref
        assert not os.path.isabs(rel_ref)
        assert rel_ref.startswith(f"finance/2026/cheques/{account_id}-commercial-international-usd/chq-")
        assert f"__{cheque_id}.jpg" in rel_ref

        # Verify disk file
        disk_file = tmp_path / rel_ref
        assert disk_file.is_file()
        assert disk_file.read_bytes() == scan_bytes

    # Verify download
    down_resp = app_client.get(f"/api/finance/cheques/{cheque_id}/attachments/{att_id}/download", cookies=admin_cookies)
    assert down_resp.status_code == 200
    assert down_resp.content == scan_bytes

    # Verify delete
    del_resp = app_client.delete(f"/api/finance/cheques/{cheque_id}/attachments/{att_id}", cookies=admin_cookies)
    assert del_resp.status_code in (200, 204)
    assert not (tmp_path / rel_ref).exists()


def test_checkpoint_attachment_lands_in_account_folder(app_client, admin_cookies, monkeypatch, tmp_path):
    """Verifies balance checkpoint attachments write to finance/<yyyy>/balance-checkpoints/<account-folder>/."""
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path))

    # 1. Create a cash account with partial visibility (checkpoints are for partial visibility accounts)
    acc_resp = app_client.post(
        "/api/finance/accounts",
        cookies=admin_cookies,
        json={
            "account_name": "HQ Safe Box",
            "account_number": "CASH-HQ-01",
            "currency": "EGP",
            "opening_balance": 5000.0,
            "visibility": "partial",
            "is_active": True,
        },
    )
    assert acc_resp.status_code in (200, 201), acc_resp.text
    account_id = acc_resp.json()["id"]

    # 2. Create a balance checkpoint
    cp_resp = app_client.post(
        f"/api/finance/accounts/{account_id}/checkpoints",
        cookies=admin_cookies,
        json={
            "date": "2026-06-30",
            "balance": 5000.0,
            "note": "Mid-year cash count",
        },
    )
    assert cp_resp.status_code in (200, 201), cp_resp.text
    checkpoint_id = cp_resp.json()["id"]

    # 3. Upload checkpoint proof attachment
    file_bytes = b"%PDF-1.4 Cash count verification sheet"
    upload_resp = app_client.post(
        f"/api/finance/accounts/{account_id}/checkpoints/{checkpoint_id}/attachment",
        cookies=admin_cookies,
        files={"file": ("cash_count.pdf", io.BytesIO(file_bytes), "application/pdf")},
    )
    assert upload_resp.status_code == 200, upload_resp.text

    # Verify database storage_ref and disk placement
    from db import get_db_context
    with get_db_context() as db:
        att_row = db.query(FinanceAttachmentDB).filter(FinanceAttachmentDB.checkpoint_id == checkpoint_id).one()
        rel_ref = att_row.storage_ref
        assert not os.path.isabs(rel_ref)
        assert rel_ref.startswith(f"finance/2026/balance-checkpoints/{account_id}-hq-safe-box/chkpt-{checkpoint_id}__")
        assert rel_ref.endswith(".pdf")

        disk_file = tmp_path / rel_ref
        assert disk_file.is_file()
        assert disk_file.read_bytes() == file_bytes

    # Verify download
    down_resp = app_client.get(
        f"/api/finance/accounts/{account_id}/checkpoints/{checkpoint_id}/attachment",
        cookies=admin_cookies,
    )
    assert down_resp.status_code == 200
    assert down_resp.content == file_bytes


def test_legacy_fallback_downloads_still_work(app_client, admin_cookies, monkeypatch, tmp_path):
    """Verifies that an unmigrated bill with a legacy path can still be downloaded."""
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path))

    # Create a legacy directory under root to simulate unmigrated files
    legacy_dir = tmp_path / "finance_bills"
    legacy_dir.mkdir(parents=True, exist_ok=True)
    old_file = legacy_dir / "legacy_bill_9999.pdf"
    old_content = b"%PDF-1.3 Legacy unmigrated bill file"
    old_file.write_bytes(old_content)

    # Insert a bill directly with legacy attachment_url
    from db import get_db_context
    with get_db_context() as db:
        vendor = VendorDB(name="Legacy Vendor", category="Operations")
        db.add(vendor)
        db.commit()

        bill = BillDB(
            vendor_id=vendor.id,
            bill_number="LEGACY-001",
            issue_date="2025-11-01",
            due_date="2025-12-01",
            currency="USD",
            total=500.0,
            subtotal=500.0,
            status="draft",
            attachment_name="legacy_bill_9999.pdf",
            attachment_url="legacy_bill_9999.pdf",  # bare legacy name
            created_by="admin@test.com",
        )
        db.add(bill)
        db.commit()
        bill_id = bill.id

    # Verify download succeeds through fallback resolver
    down_resp = app_client.get(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
    assert down_resp.status_code == 200
    assert down_resp.content == old_content
