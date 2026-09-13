"""
be/tests/test_finance_activity_timeline.py
Contract, authorization, masking, and ordering tests for Finance Entity Activity & Timeline (Story 1.3).
"""
import pytest
from datetime import datetime


def test_invoice_activity_timeline_admin(app_client, admin_cookies):
    """Admin receives full invoice summary, unmasked attributes, and chronological timeline."""
    # 1. Create a customer and an invoice
    cust_res = app_client.post(
        "/api/finance/customers",
        json={"name": "Timeline Medical Group", "tax_id": "TAX-998877", "contact_email": "tmg@test.com"},
        cookies=admin_cookies,
    )
    assert cust_res.status_code == 201
    cust_id = cust_res.json()["id"]

    inv_res = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": cust_id,
            "invoice_number": "INV-TL-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "draft",
            "currency": "USD",
            "lines": [{"description": "Medical Consultation", "quantity": 1, "unit_price": 5000.0}],
        },
        cookies=admin_cookies,
    )
    assert inv_res.status_code == 201
    inv_id = inv_res.json()["id"]

    # 2. Query activity
    act_res = app_client.get(f"/api/finance/activity/invoice/{inv_id}", cookies=admin_cookies)
    assert act_res.status_code == 200
    data = act_res.json()

    assert data["entity_type"] == "invoice"
    assert data["entity_id"] == inv_id
    assert data["title"] == "Invoice INV-TL-001"
    assert data["status"] == "draft"

    summary = data["summary"]
    assert summary["reference"] == "INV-TL-001"
    assert summary["counterparty"] == "Timeline Medical Group"
    assert summary["amount"] == 5000.0
    assert summary["currency"] == "USD"
    assert summary["sensitive_masked"] is False

    # Tax ID should NOT be masked for admin
    tax_attr = next((a for a in summary["attributes"] if a["label"] == "Customer Tax ID"), None)
    assert tax_attr is not None
    assert tax_attr["value"] == "TAX-998877"

    # Timeline assertions: at least creation event exists
    timeline = data["timeline"]
    assert len(timeline) >= 1
    assert timeline[0]["event"] == "created"
    assert "INV-TL-001" in timeline[0]["plain_text"]
    assert timeline[0]["actor"] != ""

    # Ordering assertion: timestamps must be monotonically non-decreasing
    timestamps = [e["timestamp"] for e in timeline]
    assert timestamps == sorted(timestamps)


def test_invoice_activity_sensitive_masking_non_admin(app_client, admin_cookies, employee_cookies):
    """Non-admin users receive masked tax IDs and account numbers with sensitive_masked=True."""
    # Create customer with tax ID and invoice
    cust_res = app_client.post(
        "/api/finance/customers",
        json={"name": "Masking Health Corp", "tax_id": "TAX-12345678", "contact_email": "mask@test.com"},
        cookies=admin_cookies,
    )
    assert cust_res.status_code == 201
    cust_id = cust_res.json()["id"]

    inv_res = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": cust_id,
            "invoice_number": "INV-MASK-002",
            "issue_date": "2026-09-02",
            "due_date": "2026-10-02",
            "status": "sent",
            "currency": "USD",
            "lines": [{"description": "Diagnostics", "quantity": 2, "unit_price": 1000.0}],
        },
        cookies=admin_cookies,
    )
    assert inv_res.status_code == 201
    inv_id = inv_res.json()["id"]

    # Fetch as employee
    act_res = app_client.get(f"/api/finance/activity/invoice/{inv_id}", cookies=employee_cookies)
    assert act_res.status_code == 200
    data = act_res.json()

    summary = data["summary"]
    assert summary["sensitive_masked"] is True

    # Tax ID must be masked
    tax_attr = next((a for a in summary["attributes"] if a["label"] == "Customer Tax ID"), None)
    assert tax_attr is not None
    assert tax_attr["value"].startswith("******")
    assert tax_attr["value"].endswith("5678")


def test_bill_activity_timeline_and_payments(app_client, admin_cookies):
    """Vendor bills expose plain-language timeline and linked payment records."""
    vendor_res = app_client.post(
        "/api/finance/vendors",
        json={"name": "Datadog Observability", "tax_id": "VAT-554433", "category": "SaaS"},
        cookies=admin_cookies,
    )
    assert vendor_res.status_code == 201
    vendor_id = vendor_res.json()["id"]

    bill_res = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "BILL-DD-101",
            "category": "SaaS",
            "issue_date": "2026-09-03",
            "due_date": "2026-09-20",
            "status": "unpaid",
            "currency": "USD",
            "lines": [{"description": "APM licenses", "quantity": 1, "unit_price": 1200.0}],
        },
        cookies=admin_cookies,
    )
    assert bill_res.status_code == 201
    bill_id = bill_res.json()["id"]

    act_res = app_client.get(f"/api/finance/activity/bill/{bill_id}", cookies=admin_cookies)
    assert act_res.status_code == 200
    data = act_res.json()

    assert data["entity_type"] == "bill"
    assert data["title"] == "Bill BILL-DD-101"
    assert data["summary"]["counterparty"] == "Datadog Observability"
    assert data["summary"]["amount"] == 1200.0
    assert len(data["timeline"]) >= 1
    assert "received from Datadog Observability" in data["timeline"][0]["plain_text"]


def test_cheque_activity_timeline_and_masking(app_client, admin_cookies, employee_cookies):
    """Cheque activity shows clear/issued events and masks account number for non-admin."""
    # 1. Create bank account and issue cheque
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={"account_name": "Cheque Issuing CIB", "account_number": "123456789012", "currency": "EGP", "opening_balance": 50000.0},
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    acc_id = acc_res.json()["id"]

    chq_res = app_client.post(
        "/api/finance/cheques",
        json={
            "account_id": acc_id,
            "cheque_number": "990011",
            "issue_date": "2026-09-05",
            "amount": 15000.0,
            "currency": "EGP",
            "payee": "Cairo Office Landlord",
            "purpose_type": "vendor_payment",
            "fiscal_year": 2026,
            "notes": "Office lease Q3",
        },
        cookies=admin_cookies,
    )
    assert chq_res.status_code == 201
    chq_id = chq_res.json()["id"]

    # 2. Admin fetch
    act_admin = app_client.get(f"/api/finance/activity/cheque/{chq_id}", cookies=admin_cookies)
    assert act_admin.status_code == 200
    d_admin = act_admin.json()
    assert d_admin["summary"]["sensitive_masked"] is False
    acc_attr = next(a for a in d_admin["summary"]["attributes"] if a["label"] == "Account Number")
    assert acc_attr["value"] == "123456789012"
    assert len(d_admin["timeline"]) >= 1
    assert "issued to Cairo Office Landlord" in d_admin["timeline"][0]["plain_text"]

    # 3. Non-admin fetch -> masked
    act_emp = app_client.get(f"/api/finance/activity/cheque/{chq_id}", cookies=employee_cookies)
    assert act_emp.status_code == 200
    d_emp = act_emp.json()
    assert d_emp["summary"]["sensitive_masked"] is True
    acc_attr_emp = next(a for a in d_emp["summary"]["attributes"] if a["label"] == "Account Number")
    assert acc_attr_emp["value"].startswith("******")
    assert acc_attr_emp["value"].endswith("9012")


def test_transfer_activity_timeline(app_client, admin_cookies):
    """Account transfers expose source/dest accounts, amounts, and settlement timeline."""
    acc1 = app_client.post(
        "/api/finance/accounts",
        json={"account_name": "Vault A", "account_number": "VA-001", "currency": "USD", "opening_balance": 100000.0},
        cookies=admin_cookies,
    ).json()["id"]

    acc2 = app_client.post(
        "/api/finance/accounts",
        json={"account_name": "Vault B", "account_number": "VB-002", "currency": "USD", "opening_balance": 50000.0},
        cookies=admin_cookies,
    ).json()["id"]


    trf_res = app_client.post(
        "/api/finance/transfers",
        json={
            "from_account_id": acc1,
            "to_account_id": acc2,
            "date": "2026-09-06",
            "from_amount": 25000.0,
            "from_currency": "USD",
            "to_amount": 25000.0,
            "to_currency": "USD",
            "transfer_type": "internal",
            "note": "Liquidity rebalance",
        },
        cookies=admin_cookies,
    )
    assert trf_res.status_code == 201
    trf_id = trf_res.json()["id"]

    act_res = app_client.get(f"/api/finance/activity/transfer/{trf_id}", cookies=admin_cookies)
    assert act_res.status_code == 200
    data = act_res.json()
    assert data["entity_type"] == "transfer"
    assert data["summary"]["amount"] == 25000.0
    assert "Vault A" in data["summary"]["counterparty"]
    assert "Vault B" in data["summary"]["counterparty"]
    assert len(data["timeline"]) >= 1
    assert "initiated" in data["timeline"][0]["plain_text"]


def test_activity_unsupported_and_not_found(app_client, admin_cookies):
    """Validates 400 Bad Request for unsupported entity types and 404 for missing entities."""
    res_bad_type = app_client.get("/api/finance/activity/unknown_entity/1", cookies=admin_cookies)
    assert res_bad_type.status_code == 400
    assert "Unsupported entity type" in res_bad_type.json()["detail"]

    res_missing = app_client.get("/api/finance/activity/invoice/999999", cookies=admin_cookies)
    assert res_missing.status_code == 404
    assert "not found" in res_missing.json()["detail"]

