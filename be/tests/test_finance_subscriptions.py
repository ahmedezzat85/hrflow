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


def test_subscription_governance_and_monthly_equivalent(app_client, admin_cookies):
    from datetime import datetime, timedelta

    # 1. Create vendor
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Salesforce Corp", "category": "CRM"},
        cookies=admin_cookies,
    )
    assert v_resp.status_code == 201
    vendor_id = v_resp.json()["id"]

    # 2. Create yearly subscription with governance attributes
    sub_resp = app_client.post(
        "/api/finance/subscriptions",
        json={
            "vendor_id": vendor_id,
            "name": "Salesforce CRM Enterprise",
            "amount": 24000.0,
            "currency": "USD",
            "billing_cycle": "yearly",
            "next_renewal_date": "2026-12-31",
            "owner": "Alex Morgan",
            "department": "Operations",
            "notice_period_days": 60,
            "seats_count": 80,
            "contract_start_date": "2026-01-01",
            "contract_end_date": "2026-12-31",
            "auto_generate_bill": True,
        },
        cookies=admin_cookies,
    )
    assert sub_resp.status_code == 201
    sub = sub_resp.json()
    assert sub["monthly_equivalent_amount"] == 2000.0  # 24000 / 12
    assert sub["owner"] == "Alex Morgan"
    assert sub["department"] == "Operations"
    assert sub["notice_period_days"] == 60
    assert sub["seats_count"] == 80
    assert sub["notice_deadline_date"] == "2026-11-01"  # 2026-12-31 - 60 days
    assert sub["is_renewal_imminent"] is False


def test_subscription_charge_variance_and_bill_creation(app_client, admin_cookies):
    # 1. Setup vendor and subscription
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Snowflake Cloud", "category": "Data"},
        cookies=admin_cookies,
    )
    assert v_resp.status_code == 201
    vendor_id = v_resp.json()["id"]

    sub_resp = app_client.post(
        "/api/finance/subscriptions",
        json={
            "vendor_id": vendor_id,
            "name": "Snowflake Analytics Warehouse",
            "amount": 1000.0,
            "currency": "USD",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-10-15",
            "owner": "Data Engineering Team",
        },
        cookies=admin_cookies,
    )
    assert sub_resp.status_code == 201
    sub_id = sub_resp.json()["id"]

    # 2. Log charge with variance and create_bill=True
    charge_resp = app_client.post(
        f"/api/finance/subscriptions/{sub_id}/charges",
        data={
            "amount": 1250.0,  # $250 variance over base $1000
            "billing_date": "2026-09-14",
            "currency": "USD",
            "note": "Quarter-end heavy indexing queries",
            "create_bill": "true",
            "variance_reason": "Query compute overage above tier limits",
        },
        cookies=admin_cookies,
    )
    assert charge_resp.status_code == 201
    charge = charge_resp.json()
    assert charge["amount"] == 1250.0
    assert charge["variance_amount"] == 250.0
    assert charge["variance_reason"] == "Query compute overage above tier limits"
    assert charge["linked_bill_id"] is not None

    # 3. Verify the generated bill in Accounts Payable
    bill_id = charge["linked_bill_id"]
    bill_resp = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies)
    assert bill_resp.status_code == 200
    bill = bill_resp.json()
    assert bill["vendor_id"] == vendor_id
    assert bill["total"] == 1250.0
    assert "Snowflake Analytics Warehouse" in bill["notes"]

    # 4. Fetch charge history and verify variance and linked bill are returned
    history_resp = app_client.get(f"/api/finance/subscriptions/{sub_id}/charges", cookies=admin_cookies)
    assert history_resp.status_code == 200
    history = history_resp.json()
    assert len(history) == 1
    assert history[0]["variance_amount"] == 250.0
    assert history[0]["variance_reason"] == "Query compute overage above tier limits"
    assert history[0]["linked_bill_id"] == bill_id


def test_subscription_attention_queue_alerts(app_client, admin_cookies):
    from datetime import datetime, timedelta

    # 1. Setup vendor
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Alerts SaaS Ltd", "category": "Security"},
        cookies=admin_cookies,
    )
    vendor_id = v_resp.json()["id"]

    today = datetime.utcnow().date()
    # Subscription renewing in 10 days with 30-day notice period => notice deadline was 20 days ago!
    imminent_renewal = (today + timedelta(days=10)).strftime("%Y-%m-%d")

    # Subscription with imminent renewal notice deadline
    app_client.post(
        "/api/finance/subscriptions",
        json={
            "vendor_id": vendor_id,
            "name": "Imminent Renewal SaaS",
            "amount": 800.0,
            "currency": "USD",
            "billing_cycle": "monthly",
            "next_renewal_date": imminent_renewal,
            "notice_period_days": 30,
            "owner": "Security Team Lead",
        },
        cookies=admin_cookies,
    )

    # Subscription missing owner
    app_client.post(
        "/api/finance/subscriptions",
        json={
            "vendor_id": vendor_id,
            "name": "Orphaned Tool Without Owner",
            "amount": 150.0,
            "currency": "USD",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-11-01",
            "owner": None,
        },
        cookies=admin_cookies,
    )

    # 2. Query attention queue
    queue_resp = app_client.get("/api/finance/reports/attention-queue", cookies=admin_cookies)
    assert queue_resp.status_code == 200
    queue_data = queue_resp.json()
    items = queue_data["items"]

    # Check for renewal alert
    ren_item = next((i for i in items if i["type"] == "subscription_renewal" and "Imminent Renewal SaaS" in i["title"]), None)
    assert ren_item is not None
    assert ren_item["target_route"] == "a-finance-subscriptions"
    assert ren_item["severity"] in ["urgent", "warning"]

    # Check for missing owner alert
    gov_item = next((i for i in items if i["type"] == "subscription_governance" and "Orphaned Tool" in i["title"]), None)
    assert gov_item is not None
    assert gov_item["target_route"] == "a-finance-subscriptions"

