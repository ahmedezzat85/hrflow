"""
be/tests/test_finance_settlement_linking.py
Automated backend tests for FUX-406: Unified settlement linking across Bill Payment,
Invoice Payment, and Add Transaction.
"""
import pytest


def test_bill_settlement_linking_via_transaction(app_client, admin_cookies):
    # 1. Create bank account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Settlement Bank USD",
            "bank_name": "Chase",
            "account_number": "1122334455",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    acc_id = acc_res.json()["id"]

    # 2. Create vendor
    vend_res = app_client.post(
        "/api/finance/vendors",
        json={
            "name": "Cloud Infra Vendor",
            "country": "United States",
            "default_currency": "USD",
        },
        cookies=admin_cookies,
    )
    assert vend_res.status_code == 201
    vendor_id = vend_res.json()["id"]

    # 3. Create bill for vendor
    bill_res = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "BILL-CLOUD-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-15",
            "currency": "USD",
            "lines": [
                {
                    "description": "Cloud Servers",
                    "quantity": 1.0,
                    "unit_price": 500.0,
                    "line_total": 500.0,
                }
            ],
            "status": "ready_to_pay",
        },
        cookies=admin_cookies,
    )
    assert bill_res.status_code == 201
    bill_id = bill_res.json()["id"]
    assert bill_res.json()["total"] == 500.0

    # 4. Partial settlement via Add Transaction with linked_bill_id
    tx1_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-10",
            "amount": 200.0,
            "direction": "out",
            "currency": "USD",
            "payee_type": "vendor",
            "payee_id": vendor_id,
            "linked_bill_id": bill_id,
            "description": "Partial payment for cloud servers",
        },
        cookies=admin_cookies,
    )
    assert tx1_res.status_code == 201, tx1_res.text
    tx1 = tx1_res.json()
    assert tx1["linked_bill_id"] == bill_id
    assert tx1["source"] == "bill_payment"

    # Verify bill status transitioned to partially_paid
    b_updated_res = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies)
    assert b_updated_res.status_code == 200
    b_updated = b_updated_res.json()
    assert b_updated["status"] == "partially_paid"
    assert b_updated["amount_paid"] == 200.0

    # 5. Overpayment prevention
    tx_over_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-11",
            "amount": 350.0,  # Only 300 remaining
            "direction": "out",
            "currency": "USD",
            "payee_type": "vendor",
            "payee_id": vendor_id,
            "linked_bill_id": bill_id,
        },
        cookies=admin_cookies,
    )
    assert tx_over_res.status_code == 400
    assert "exceeds remaining balance" in tx_over_res.text

    # 6. Settle remaining 300.0 in full
    tx2_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-12",
            "amount": 300.0,
            "direction": "out",
            "currency": "USD",
            "payee_type": "vendor",
            "payee_id": vendor_id,
            "linked_bill_id": bill_id,
            "description": "Final settlement for cloud servers",
        },
        cookies=admin_cookies,
    )
    assert tx2_res.status_code == 201
    tx2 = tx2_res.json()
    assert tx2["linked_bill_id"] == bill_id

    # Verify bill is now paid in full
    b_paid_res = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies)
    assert b_paid_res.status_code == 200
    b_paid = b_paid_res.json()
    assert b_paid["status"] == "paid"
    assert b_paid["amount_paid"] == 500.0


def test_invoice_settlement_linking_via_transaction(app_client, admin_cookies):
    # 1. Create bank account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Inbound Settlement Bank USD",
            "bank_name": "JPMorgan Chase",
            "account_number": "5566778899",
            "currency": "USD",
            "opening_balance": 5000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    acc_id = acc_res.json()["id"]

    # 2. Create customer
    cust_res = app_client.post(
        "/api/finance/customers",
        json={
            "name": "Acme Global Client",
            "contact_email": "billing@acmeglobal.com",
            "default_currency": "USD",
        },
        cookies=admin_cookies,
    )
    assert cust_res.status_code == 201
    customer_id = cust_res.json()["id"]

    # 3. Create sales invoice
    inv_res = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-ACME-9001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-20",
            "currency": "USD",
            "subtotal": 1200.0,
            "tax_amount": 0.0,
            "total": 1200.0,
            "lines": [
                {
                    "description": "Consulting Services",
                    "quantity": 10.0,
                    "unit_price": 120.0,
                    "line_total": 1200.0,
                }
            ],
        },
        cookies=admin_cookies,
    )
    assert inv_res.status_code == 201
    invoice_id = inv_res.json()["id"]

    # 4. Settle invoice partially via incoming transaction
    tx_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-05",
            "amount": 500.0,
            "direction": "in",
            "currency": "USD",
            "entry_type": "money_in",
            "payee_type": "customer",
            "payee_id": customer_id,
            "linked_invoice_id": invoice_id,
            "description": "Deposit from Acme Client",
        },
        cookies=admin_cookies,
    )
    assert tx_res.status_code == 201, tx_res.text
    tx = tx_res.json()
    assert tx["linked_invoice_id"] == invoice_id
    assert tx["source"] == "invoice_payment"
    assert tx["payee_type"] == "customer"
    assert tx["payee_id"] == customer_id

    # 5. Settle remaining balance in full
    tx_final_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-10",
            "amount": 700.0,
            "direction": "in",
            "currency": "USD",
            "entry_type": "money_in",
            "payee_type": "customer",
            "payee_id": customer_id,
            "linked_invoice_id": invoice_id,
            "description": "Final balance for INV-ACME-9001",
        },
        cookies=admin_cookies,
    )
    assert tx_final_res.status_code == 201

    # Verify invoice status is paid
    inv_paid_res = app_client.get(f"/api/finance/invoices/{invoice_id}", cookies=admin_cookies)
    assert inv_paid_res.status_code == 200
    assert inv_paid_res.json()["status"] == "paid"


def test_duplicate_settlement_check_endpoint(app_client, admin_cookies):
    # Create vendor
    vend_res = app_client.post(
        "/api/finance/vendors",
        json={"name": "Software Licensor", "default_currency": "USD"},
        cookies=admin_cookies,
    )
    assert vend_res.status_code == 201
    vendor_id = vend_res.json()["id"]

    # Create open bill
    bill_res = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "BILL-SOFT-888",
            "issue_date": "2026-09-10",
            "due_date": "2026-09-24",
            "currency": "USD",
            "lines": [
                {
                    "description": "Software License",
                    "quantity": 1.0,
                    "unit_price": 750.0,
                    "line_total": 750.0,
                }
            ],
            "status": "ready_to_pay",
        },
        cookies=admin_cookies,
    )
    assert bill_res.status_code == 201
    bill_id = bill_res.json()["id"]
    assert bill_res.json()["total"] == 750.0

    # Duplicate check for matching amount and date
    chk_res = app_client.get(
        f"/api/finance/transactions/duplicate-settlement-check?payee_type=vendor&payee_id={vendor_id}&amount=750.0&date=2026-09-15",
        cookies=admin_cookies,
    )
    assert chk_res.status_code == 200, chk_res.text
    chk = chk_res.json()
    assert chk["has_match"] is True
    assert chk["match_type"] == "bill"
    assert chk["document_id"] == bill_id
    assert chk["document_number"] == "BILL-SOFT-888"

    # Duplicate check with completely non-matching amount
    chk_no_res = app_client.get(
        f"/api/finance/transactions/duplicate-settlement-check?payee_type=vendor&payee_id={vendor_id}&amount=15.0&date=2026-09-15",
        cookies=admin_cookies,
    )
    assert chk_no_res.status_code == 200
    assert chk_no_res.json()["has_match"] is False
