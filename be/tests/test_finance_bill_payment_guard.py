"""
be/tests/test_finance_bill_payment_guard.py
Tests for Story FUX-408: Combined create-and-pay bill action with settlement-status integrity guard.
"""
import pytest


def test_direct_status_paid_rejected_on_create(app_client, admin_cookies):
    """Attempting to directly create a bill with status='paid' or 'partially_paid' without settlement is rejected."""
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "FUX408 Vendor Direct Paid"},
        cookies=admin_cookies,
    )
    assert vend_resp.status_code == 201
    vendor_id = vend_resp.json()["id"]

    # 1. Attempt status="paid" directly without is_paid_now
    bad_paid_payload = {
        "vendor_id": vendor_id,
        "bill_number": "BILL-GUARD-PAID-01",
        "category": "Software",
        "issue_date": "2026-09-01",
        "due_date": "2026-09-30",
        "status": "paid",
        "currency": "USD",
        "lines": [{"description": "License", "quantity": 1, "unit_price": 500.0, "line_total": 500.0}],
    }
    resp_paid = app_client.post("/api/finance/bills", json=bad_paid_payload, cookies=admin_cookies)
    assert resp_paid.status_code == 400
    assert "Paid or partially paid status cannot be set directly" in resp_paid.json()["detail"]

    # 2. Attempt status="partially_paid" directly without is_paid_now
    bad_partial_payload = {
        **bad_paid_payload,
        "bill_number": "BILL-GUARD-PARTIAL-01",
        "status": "partially_paid",
    }
    resp_part = app_client.post("/api/finance/bills", json=bad_partial_payload, cookies=admin_cookies)
    assert resp_part.status_code == 400
    assert "Paid or partially paid status cannot be set directly" in resp_part.json()["detail"]


def test_direct_status_paid_rejected_on_update(app_client, admin_cookies):
    """Attempting to update an existing unpaid bill to status='paid' or 'partially_paid' is rejected."""
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "FUX408 Vendor Update Paid"},
        cookies=admin_cookies,
    )
    assert vend_resp.status_code == 201
    vendor_id = vend_resp.json()["id"]

    # Create bill legitimately as ready_to_pay
    create_payload = {
        "vendor_id": vendor_id,
        "bill_number": "BILL-GUARD-UPDATE-01",
        "category": "Services",
        "issue_date": "2026-09-01",
        "due_date": "2026-09-30",
        "status": "ready_to_pay",
        "currency": "USD",
        "lines": [{"description": "Consulting", "quantity": 1, "unit_price": 1000.0, "line_total": 1000.0}],
    }
    create_resp = app_client.post("/api/finance/bills", json=create_payload, cookies=admin_cookies)
    assert create_resp.status_code == 201
    bill_id = create_resp.json()["id"]

    # Attempt to directly update status to 'paid'
    update_paid = app_client.put(f"/api/finance/bills/{bill_id}", json={"status": "paid"}, cookies=admin_cookies)
    assert update_paid.status_code == 400
    assert "cannot be directly updated to paid or partially paid" in update_paid.json()["detail"]

    # Attempt to directly update status to 'partially_paid'
    update_part = app_client.put(f"/api/finance/bills/{bill_id}", json={"status": "partially_paid"}, cookies=admin_cookies)
    assert update_part.status_code == 400
    assert "cannot be directly updated to paid or partially paid" in update_part.json()["detail"]


def test_combined_create_and_pay_action_full_settlement(app_client, admin_cookies):
    """Creating a bill with is_paid_now=True and valid payment details atomically creates bill and marks it paid."""
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "FUX408 Vendor Combined Pay Full"},
        cookies=admin_cookies,
    )
    assert vend_resp.status_code == 201
    vendor_id = vend_resp.json()["id"]

    # Create bank account with known balance
    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Combined Pay Checking",
            "bank_name": "Test Bank",
            "account_number": "ACT-COMBINED-01",
            "currency": "USD",
            "opening_balance": 50000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_resp.status_code == 201
    account_id = acc_resp.json()["id"]
    initial_balance = acc_resp.json()["current_balance"]

    # Combined create-and-pay
    combined_payload = {
        "vendor_id": vendor_id,
        "bill_number": "BILL-COMBINED-FULL-01",
        "category": "Office Supplies",
        "issue_date": "2026-09-10",
        "due_date": "2026-09-25",
        "status": "ready_to_pay",
        "currency": "USD",
        "lines": [{"description": "Supplies", "quantity": 2, "unit_price": 250.0, "line_total": 500.0}],
        "is_paid_now": True,
        "payment": {
            "bank_account_id": account_id,
            "payment_date": "2026-09-10",
            "amount": 500.0,
            "method": "bank_transfer",
            "reference": "WIRE-REF-9988",
        },
    }
    resp = app_client.post("/api/finance/bills", json=combined_payload, cookies=admin_cookies)
    assert resp.status_code == 201
    created_bill = resp.json()
    assert created_bill["bill_number"] == "BILL-COMBINED-FULL-01"
    assert created_bill["status"] == "paid"
    assert created_bill["amount_paid"] == 500.0
    assert created_bill["remaining_balance"] == 0.0

    # Verify payment record was created
    payments_resp = app_client.get(f"/api/finance/bills/{created_bill['id']}/payments", cookies=admin_cookies)
    assert payments_resp.status_code == 200
    payments = payments_resp.json()
    assert len(payments) == 1
    assert payments[0]["amount"] == 500.0
    assert payments[0]["bank_account_id"] == account_id
    assert payments[0]["reference"] == "WIRE-REF-9988"

    # Verify bank account balance decremented
    updated_acc = app_client.get(f"/api/finance/accounts/{account_id}", cookies=admin_cookies).json()
    assert updated_acc["current_balance"] == initial_balance - 500.0


def test_combined_create_and_pay_action_partial_settlement(app_client, admin_cookies):
    """Creating a bill with is_paid_now=True and amount < total marks status as partially_paid."""
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "FUX408 Vendor Combined Pay Partial"},
        cookies=admin_cookies,
    )
    assert vend_resp.status_code == 201
    vendor_id = vend_resp.json()["id"]

    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Combined Pay Partial Checking",
            "bank_name": "Test Bank",
            "account_number": "ACT-COMBINED-02",
            "currency": "USD",
            "opening_balance": 20000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_resp.status_code == 201
    account_id = acc_resp.json()["id"]

    # Bill total is 1000, paid now is 400
    combined_payload = {
        "vendor_id": vendor_id,
        "bill_number": "BILL-COMBINED-PARTIAL-01",
        "category": "Hosting",
        "issue_date": "2026-09-10",
        "due_date": "2026-09-25",
        "status": "ready_to_pay",
        "currency": "USD",
        "lines": [{"description": "Server", "quantity": 1, "unit_price": 1000.0, "line_total": 1000.0}],
        "is_paid_now": True,
        "payment": {
            "bank_account_id": account_id,
            "payment_date": "2026-09-10",
            "amount": 400.0,
            "method": "bank_transfer",
            "reference": "PARTIAL-DEPOSIT",
        },
    }
    resp = app_client.post("/api/finance/bills", json=combined_payload, cookies=admin_cookies)
    assert resp.status_code == 201
    created_bill = resp.json()
    assert created_bill["status"] == "partially_paid"
    assert created_bill["amount_paid"] == 400.0
    assert created_bill["remaining_balance"] == 600.0


def test_combined_create_and_pay_blocked_when_approval_required(app_client, admin_cookies):
    """If a bill requires approval and is not approved, the combined create-and-pay action is blocked."""
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "FUX408 Vendor Approval Required"},
        cookies=admin_cookies,
    )
    assert vend_resp.status_code == 201
    vendor_id = vend_resp.json()["id"]

    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Approval Checking",
            "bank_name": "Test Bank",
            "account_number": "ACT-APP-01",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_resp.status_code == 201
    account_id = acc_resp.json()["id"]

    combined_payload = {
        "vendor_id": vendor_id,
        "bill_number": "BILL-COMBINED-APP-01",
        "category": "Capital Expenditure",
        "issue_date": "2026-09-10",
        "due_date": "2026-09-25",
        "status": "needs_approval",
        "requires_approval": True,
        "approval_status": "pending",
        "currency": "USD",
        "lines": [{"description": "Machinery", "quantity": 1, "unit_price": 5000.0, "line_total": 5000.0}],
        "is_paid_now": True,
        "payment": {
            "bank_account_id": account_id,
            "payment_date": "2026-09-10",
            "amount": 5000.0,
            "method": "bank_transfer",
        },
    }
    resp = app_client.post("/api/finance/bills", json=combined_payload, cookies=admin_cookies)
    assert resp.status_code == 400
    assert "requires approval before payment can be recorded" in resp.json()["detail"]
