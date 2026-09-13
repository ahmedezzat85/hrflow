"""
be/tests/test_finance_subscriptions.py
Unit and integration tests for Phase 6: Subscription Charges & Finance Attachments.
"""
import io
import pytest


def test_create_and_list_subscriptions(app_client, admin_cookies):
    # 1. Create a vendor
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Cloud Host Provider", "category": "Infrastructure"},
        cookies=admin_cookies,
    )
    assert v_resp.status_code == 201
    vendor_id = v_resp.json()["id"]

    # 2. Create subscription
    sub_resp = app_client.post(
        "/api/finance/subscriptions",
        json={
            "vendor_id": vendor_id,
            "name": "AWS Production Cluster",
            "amount": 2500.0,
            "currency": "USD",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-10-01",
            "auto_generate_bill": True,
            "is_active": True,
        },
        cookies=admin_cookies,
    )
    assert sub_resp.status_code == 201
    sub_data = sub_resp.json()
    assert sub_data["name"] == "AWS Production Cluster"
    assert sub_data["vendor_name"] == "Cloud Host Provider"
    assert sub_data["charges_count"] == 0
    sub_id = sub_data["id"]

    # 3. List subscriptions
    list_resp = app_client.get("/api/finance/subscriptions", cookies=admin_cookies)
    assert list_resp.status_code == 200
    subs = list_resp.json()
    assert any(s["id"] == sub_id for s in subs)


def test_update_subscription(app_client, admin_cookies):
    # Setup vendor and sub
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "SaaS Comms", "category": "SaaS"},
        cookies=admin_cookies,
    )
    vendor_id = v_resp.json()["id"]

    sub_resp = app_client.post(
        "/api/finance/subscriptions",
        json={
            "vendor_id": vendor_id,
            "name": "Slack Enterprise Grid",
            "amount": 400.0,
            "currency": "USD",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-09-20",
        },
        cookies=admin_cookies,
    )
    sub_id = sub_resp.json()["id"]

    # Update amount and renewal
    update_resp = app_client.patch(
        f"/api/finance/subscriptions/{sub_id}",
        json={"amount": 450.0, "next_renewal_date": "2026-10-20"},
        cookies=admin_cookies,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["amount"] == 450.0
    assert update_resp.json()["next_renewal_date"] == "2026-10-20"


def test_log_subscription_charge_with_ledger_and_attachment(app_client, admin_cookies):
    # 1. Setup vendor, subscription, and bank account
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Dev Tools Inc", "category": "Software"},
        cookies=admin_cookies,
    )
    vendor_id = v_resp.json()["id"]

    sub_resp = app_client.post(
        "/api/finance/subscriptions",
        json={
            "vendor_id": vendor_id,
            "name": "Figma Enterprise",
            "amount": 300.0,
            "currency": "USD",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-09-25",
        },
        cookies=admin_cookies,
    )
    sub_id = sub_resp.json()["id"]

    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "US Card Account",
            "bank_name": "Silicon Valley Bank",
            "account_number": "SUB-CARD-991",
            "currency": "USD",
            "account_type": "bank",
            "opening_balance": 50000.0,
        },
        cookies=admin_cookies,
    )
    acc_id = acc_resp.json()["id"]

    # 2. Log charge with attachment file and bank account
    fake_pdf = io.BytesIO(b"%PDF-1.4 Mock Receipt Content for Figma Charge")
    charge_resp = app_client.post(
        f"/api/finance/subscriptions/{sub_id}/charges",
        data={
            "amount": 325.50,  # variable amount test
            "billing_date": "2026-09-11",
            "currency": "USD",
            "note": "September seats + editor add-on",
            "bank_account_id": acc_id,
        },
        files={"file": ("figma_invoice_sept.pdf", fake_pdf, "application/pdf")},
        cookies=admin_cookies,
    )
    assert charge_resp.status_code == 201
    charge_data = charge_resp.json()
    assert charge_data["amount"] == 325.50
    assert charge_data["linked_transaction_id"] is not None
    assert len(charge_data["attachments"]) == 1
    att = charge_data["attachments"][0]
    assert att["file_name"] == "figma_invoice_sept.pdf"
    att_id = att["id"]

    # 3. Verify ledger transaction exists
    tx_resp = app_client.get(f"/api/finance/accounts/{acc_id}/transactions", cookies=admin_cookies)
    assert tx_resp.status_code == 200
    txs = tx_resp.json()
    sub_tx = next((t for t in txs if t["id"] == charge_data["linked_transaction_id"]), None)
    assert sub_tx is not None
    assert sub_tx["direction"] == "out"
    assert sub_tx["amount"] == 325.50
    assert sub_tx["source"] == "subscription_charge"

    # 4. Download attachment
    dl_resp = app_client.get(f"/api/finance/attachments/{att_id}/download", cookies=admin_cookies)
    assert dl_resp.status_code == 200
    assert b"Mock Receipt Content" in dl_resp.content

    # 5. Verify subscription detail now has charges_count == 1 and last_charge_amount == 325.50
    sub_detail_resp = app_client.get(f"/api/finance/subscriptions/{sub_id}", cookies=admin_cookies)
    assert sub_detail_resp.status_code == 200
    assert sub_detail_resp.json()["charges_count"] == 1
    assert sub_detail_resp.json()["last_charge_amount"] == 325.50
