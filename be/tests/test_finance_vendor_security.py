"""
be/tests/test_finance_vendor_security.py
Unit and integration tests for Story 4.3: Vendor profile and payment-data security.
Covers:
- AC 1: General vendor editors cannot reveal or change payment instructions unless authorized.
- AC 2: Payment-detail changes create an audit event and require verification before use.
- AC 3: Historical bills retain the vendor identity used when issued.
- AC 4: Inactive vendors remain on history but are excluded from new bills by default.
- Duplicate detection & Vendor 360 spend metrics.
"""
import pytest
from datetime import datetime
from finance.models import VendorDB, VendorPaymentInstructionDB, BillDB
from models_db import AuditLogDB


def test_vendor_extended_profile_and_duplicate_check(app_client, admin_cookies):
    """Verifies extended vendor profile attributes and duplicate candidate detection."""
    payload = {
        "name": "MedEquip International LLC",
        "legal_name": "MedEquip Healthcare Systems Inc",
        "contact_name": "Dr. Angela Hansen",
        "contact_email": "accounts@medequip.com",
        "contact_phone": "+1 800-555-0999",
        "tax_id": "TAX-US-778899",
        "remit_address": "450 Medical Plaza, Suite 300, Chicago IL",
        "country": "United States",
        "payment_terms_days": 45,
        "default_currency": "USD",
        "category": "Medical Equipment",
        "default_department": "Clinical",
        "tax_treatment": "withholding_applicable",
        "withholding_tax_rate": 5.0,
        "onboarding_status": "active",
        "notes": "Primary imaging devices vendor",
    }
    create_resp = app_client.post("/api/finance/vendors", json=payload, cookies=admin_cookies)
    assert create_resp.status_code == 201
    vendor = create_resp.json()
    vendor_id = vendor["id"]
    assert vendor["legal_name"] == "MedEquip Healthcare Systems Inc"
    assert vendor["remit_address"] == "450 Medical Plaza, Suite 300, Chicago IL"
    assert vendor["payment_terms_days"] == 45
    assert vendor["withholding_tax_rate"] == 5.0

    # Test duplicate candidate detection by normalized name (without LLC)
    dup_check = app_client.post(
        "/api/finance/vendors/check-duplicate",
        json={"name": "MedEquip International"},
        cookies=admin_cookies,
    )
    assert dup_check.status_code == 200
    candidates = dup_check.json()
    assert len(candidates) >= 1
    assert candidates[0]["id"] == vendor_id
    assert candidates[0]["matched_field"] == "name"

    # Test duplicate by tax_id
    dup_tax = app_client.post(
        "/api/finance/vendors/check-duplicate",
        json={"tax_id": "taxus778899"},
        cookies=admin_cookies,
    )
    assert dup_tax.status_code == 200
    assert any(c["id"] == vendor_id for c in dup_tax.json())


def test_payment_instructions_masking_and_rbac(app_client, admin_cookies, employee_cookies):
    """
    AC 1: General vendor editors without reveal permission only see masked details.
    Revealing unmasked data requires finance.vendor_payment.reveal or admin.
    """
    # 1. Create vendor
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Secure Cloud Provider Inc", "tax_id": "VEND-SEC-01"},
        cookies=admin_cookies,
    )
    assert v_resp.status_code == 201
    vendor_id = v_resp.json()["id"]

    # 2. Add sensitive payment instructions
    instr_payload = {
        "payment_method": "bank_transfer",
        "bank_name": "JPMorgan Chase Bank",
        "account_holder_name": "Secure Cloud Provider Inc",
        "account_number": "98765432104821",
        "routing_number": "021000021",
        "iban": "US99CHAS021000021987654321",
        "effective_date": "2026-01-01",
        "notes": "Direct ACH Wire Instructions",
    }
    create_instr = app_client.post(
        f"/api/finance/vendors/{vendor_id}/payment-instructions",
        json=instr_payload,
        cookies=admin_cookies,
    )
    assert create_instr.status_code == 201
    instr_data = create_instr.json()
    instr_id = instr_data["id"]

    # Check that initial response returned masked account number
    assert instr_data["account_number"].startswith("******")
    assert instr_data["account_number"].endswith("4821")
    assert instr_data["verification_status"] == "unverified"

    # 3. Default GET /payment-instructions returns masked data
    get_masked = app_client.get(
        f"/api/finance/vendors/{vendor_id}/payment-instructions",
        cookies=admin_cookies,
    )
    assert get_masked.status_code == 200
    masked_list = get_masked.json()
    assert len(masked_list) == 1
    assert masked_list[0]["account_number"].startswith("******")
    assert "98765432104821" not in masked_list[0]["account_number"]

    # 4. Request reveal=true with admin_cookies succeeds with unmasked data
    get_unmasked = app_client.get(
        f"/api/finance/vendors/{vendor_id}/payment-instructions?reveal=true",
        cookies=admin_cookies,
    )
    assert get_unmasked.status_code == 200
    assert get_unmasked.json()[0]["account_number"] == "98765432104821"
    assert get_unmasked.json()[0]["iban"] == "US99CHAS021000021987654321"

    # 5. Non-finance employee attempting to access instructions gets 403 Forbidden
    emp_resp = app_client.get(
        f"/api/finance/vendors/{vendor_id}/payment-instructions",
        cookies=employee_cookies,
    )
    assert emp_resp.status_code == 403


def test_payment_detail_audit_and_verification(app_client, admin_cookies):
    """
    AC 2: Payment instruction creation/update triggers an audit log and requires verification.
    """
    from db import get_db_context
    with get_db_context() as session:
        # 1. Create vendor and payment instruction
        v_resp = app_client.post(
            "/api/finance/vendors",
            json={"name": "Audit Tracked Supplies Ltd"},
            cookies=admin_cookies,
        )
        vendor_id = v_resp.json()["id"]

        instr_resp = app_client.post(
            f"/api/finance/vendors/{vendor_id}/payment-instructions",
            json={
                "payment_method": "wire",
                "bank_name": "HSBC UK",
                "account_number": "1122334455",
            },
            cookies=admin_cookies,
        )
        assert instr_resp.status_code == 201
        instr_id = instr_resp.json()["id"]
        assert instr_resp.json()["verification_status"] == "unverified"

        # Verify audit log entry was created
        audit_entry = (
            session.query(AuditLogDB)
            .filter(
                AuditLogDB.target_type == "vendor_payment_instruction",
                AuditLogDB.target_id == str(instr_id),
            )
            .first()
        )
        assert audit_entry is not None
        assert "vendor_payment_instruction_created" in audit_entry.action

        # 2. Verify payment instruction by authorized manager
        verify_resp = app_client.post(
            f"/api/finance/vendors/{vendor_id}/payment-instructions/{instr_id}/verify",
            json={"decision": "verified", "comment": "Bank account verified via telephone confirmation"},
            cookies=admin_cookies,
        )
        assert verify_resp.status_code == 200
        verified_data = verify_resp.json()
        assert verified_data["verification_status"] == "verified"
        assert verified_data["verified_by"] is not None

        # Verify audit log recorded verification
        verify_audit = (
            session.query(AuditLogDB)
            .filter(
                AuditLogDB.target_type == "vendor_payment_instruction",
                AuditLogDB.target_id == str(instr_id),
                AuditLogDB.action == "vendor_payment_instruction_verified",
            )
            .first()
        )
        assert verify_audit is not None


def test_inactive_vendor_excluded_from_new_bills_and_history_preserved(app_client, admin_cookies):
    """
    AC 3 & 4: Inactive vendors remain on historical bills but are excluded from new bills.
    """
    # 1. Create vendor
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Retiring Vendor Services"},
        cookies=admin_cookies,
    )
    vendor_id = v_resp.json()["id"]

    # 2. Create historical bill while vendor is active
    bill_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": f"BILL-HIST-{vendor_id}",
            "issue_date": "2026-08-01",
            "due_date": "2026-08-31",
            "lines": [{"description": "Prior Period Consulting", "quantity": 1, "unit_price": 3000.0}],
        },
        cookies=admin_cookies,
    )
    assert bill_resp.status_code == 201
    bill_id = bill_resp.json()["id"]
    assert bill_resp.json()["vendor_name"] == "Retiring Vendor Services"

    # 3. Deactivate vendor
    deact_resp = app_client.delete(f"/api/finance/vendors/{vendor_id}", cookies=admin_cookies)
    assert deact_resp.status_code == 200
    assert deact_resp.json()["is_active"] is False

    # 4. Verify inactive vendor is excluded from active dropdown list
    active_vendors = app_client.get("/api/finance/vendors?is_active=true", cookies=admin_cookies).json()
    assert all(v["id"] != vendor_id for v in active_vendors)

    # But still visible when filtering for all / inactive
    all_vendors = app_client.get("/api/finance/vendors", cookies=admin_cookies).json()
    assert any(v["id"] == vendor_id for v in all_vendors)

    # 5. Historical bill retains vendor identity and loads correctly
    hist_bill = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies).json()
    assert hist_bill["vendor_id"] == vendor_id
    assert hist_bill["vendor_name"] == "Retiring Vendor Services"

    # 6. Attempting to create a NEW bill with inactive vendor is blocked with 400
    new_bill_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": f"BILL-BLOCKED-{vendor_id}",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "lines": [{"description": "Unauthorized spend", "quantity": 1, "unit_price": 500.0}],
        },
        cookies=admin_cookies,
    )
    assert new_bill_resp.status_code == 400
    assert "inactive" in new_bill_resp.json()["detail"].lower()


def test_vendor_360_profile_and_spend_metrics(app_client, admin_cookies):
    """Vendor 360 endpoint returns spend metrics, open bills, and payment instructions."""
    # 1. Create vendor
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Premier Diagnostics Tech", "category": "Diagnostics"},
        cookies=admin_cookies,
    )
    vendor_id = v_resp.json()["id"]

    # Create bank account for payments
    bank_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Operating USD 360",
            "account_type": "bank",
            "currency": "USD",
            "opening_balance": 50000.0,
            "account_number": "ACC-360",
        },
        cookies=admin_cookies,
    )
    assert bank_resp.status_code == 201, bank_resp.text
    bank_id = bank_resp.json()["id"]

    # 2. Create bill and pay it
    b1_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": f"BILL-360-PAID-{vendor_id}",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "ready_to_pay",
            "lines": [{"description": "Maintenance", "quantity": 1, "unit_price": 2500.0}],
        },
        cookies=admin_cookies,
    )
    b1_id = b1_resp.json()["id"]

    app_client.post(
        f"/api/finance/bills/{b1_id}/payments",
        json={
            "direction": "outgoing",
            "amount": 2500.0,
            "payment_date": "2026-09-05",
            "bank_account_id": bank_id,
        },
        cookies=admin_cookies,
    )

    # 3. Create open bill ($4,000 unpaid)
    app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": f"BILL-360-OPEN-{vendor_id}",
            "issue_date": "2026-09-10",
            "due_date": "2026-10-10",
            "status": "ready_to_pay",
            "lines": [{"description": "Consumables", "quantity": 1, "unit_price": 4000.0}],
        },
        cookies=admin_cookies,
    )

    # 4. Fetch Vendor 360 summary
    summary_resp = app_client.get(f"/api/finance/vendors/{vendor_id}/360", cookies=admin_cookies)
    assert summary_resp.status_code == 200
    v360 = summary_resp.json()

    assert v360["vendor"]["id"] == vendor_id
    assert v360["metrics"]["total_spend"] == 2500.0
    assert v360["metrics"]["open_bills_count"] == 1
    assert v360["metrics"]["open_bills_total"] == 4000.0
    assert v360["metrics"]["last_payment_amount"] == 2500.0
    assert v360["metrics"]["last_payment_date"] == "2026-09-05"
    assert len(v360["recent_bills"]) == 2
