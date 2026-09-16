"""
be/tests/test_finance_bill_category_defaults_fux411.py
Unit and integration tests for Story FUX-411:
Bill category dropdown fix and default category per vendor.

Verifies:
1. Bill creation and update with category_id foreign key, synchronized category string and category_name.
2. Vendor default_category_id persistence and response mapping.
3. Settlement (bills_repository.record_payment) directly uses bill.category_id in ledger transaction.
4. Fallback warning logged when category_id is missing during payment recording.
5. Bill category quality report endpoint (GET /api/finance/bills/category-quality-report).
"""
import logging
import pytest


def test_bill_creation_and_update_with_category_id(app_client, admin_cookies):
    """Verify bills can be created and updated with category_id, properly reflecting category_name."""
    # 1. Fetch categories to get a valid category ID
    cat_resp = app_client.get("/api/finance/categories?is_active=true", cookies=admin_cookies)
    assert cat_resp.status_code == 200
    categories = cat_resp.json()
    assert len(categories) > 0
    test_cat = categories[0]
    cat_id = test_cat["id"]
    cat_name = test_cat["name"]

    # 2. Create vendor
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "FUX-411 Test Vendor 1"},
        cookies=admin_cookies,
    )
    assert vend_resp.status_code == 201
    vendor_id = vend_resp.json()["id"]

    # 3. Create bill with category_id
    bill_payload = {
        "vendor_id": vendor_id,
        "bill_number": "BILL-411-001",
        "category_id": cat_id,
        "issue_date": "2026-09-01",
        "due_date": "2026-09-30",
        "currency": "USD",
        "lines": [{"description": "Cloud Hosting", "quantity": 1, "unit_price": 500.0, "line_total": 500.0}],
    }
    resp = app_client.post("/api/finance/bills", json=bill_payload, cookies=admin_cookies)
    assert resp.status_code == 201
    created_bill = resp.json()
    assert created_bill["category_id"] == cat_id
    assert created_bill["category_name"] == cat_name
    assert created_bill["category"] == cat_name

    bill_id = created_bill["id"]

    # 4. Update bill with another category if available
    if len(categories) > 1:
        new_cat = categories[1]
        update_payload = {
            "category_id": new_cat["id"],
        }
        up_resp = app_client.put(f"/api/finance/bills/{bill_id}", json=update_payload, cookies=admin_cookies)
        assert up_resp.status_code == 200
        updated_bill = up_resp.json()
        assert updated_bill["category_id"] == new_cat["id"]
        assert updated_bill["category_name"] == new_cat["name"]
        assert updated_bill["category"] == new_cat["name"]


def test_vendor_default_category_persistence(app_client, admin_cookies):
    """Verify vendor default_category_id can be set on creation, retrieved, and updated."""
    cat_resp = app_client.get("/api/finance/categories?is_active=true", cookies=admin_cookies)
    assert cat_resp.status_code == 200
    categories = cat_resp.json()
    assert len(categories) >= 2
    cat1 = categories[0]
    cat2 = categories[1]

    # Create vendor with default_category_id
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={
            "name": "FUX-411 Default Cat Vendor",
            "default_category_id": cat1["id"],
        },
        cookies=admin_cookies,
    )
    assert v_resp.status_code == 201
    created_v = v_resp.json()
    assert created_v["default_category_id"] == cat1["id"]
    assert created_v["default_category_name"] == cat1["name"]

    vendor_id = created_v["id"]

    # Update vendor default category
    up_v = app_client.put(
        f"/api/finance/vendors/{vendor_id}",
        json={"default_category_id": cat2["id"]},
        cookies=admin_cookies,
    )
    assert up_v.status_code == 200
    updated_v = up_v.json()
    assert updated_v["default_category_id"] == cat2["id"]
    assert updated_v["default_category_name"] == cat2["name"]


def test_record_payment_directly_uses_category_id(app_client, admin_cookies):
    """Payment settlement must use bill.category_id directly in the resulting ledger transaction."""
    # 1. Get bank account
    ba_resp = app_client.get("/api/finance/accounts", cookies=admin_cookies)
    assert ba_resp.status_code == 200
    accounts = ba_resp.json()
    bank_account_id = accounts[0]["id"] if accounts else None
    if not bank_account_id:
        create_ba = app_client.post(
            "/api/finance/accounts",
            json={
                "account_name": "Operating Bank",
                "bank_name": "Chase",
                "account_number": "1234567890",
                "currency": "USD",
                "opening_balance": 10000.0,
            },
            cookies=admin_cookies,
        )
        assert create_ba.status_code == 201
        bank_account_id = create_ba.json()["id"]

    # 2. Get category
    cat_resp = app_client.get("/api/finance/categories?is_active=true", cookies=admin_cookies)
    assert cat_resp.status_code == 200
    test_cat = cat_resp.json()[0]
    cat_id = test_cat["id"]

    # 3. Create vendor and bill
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "FUX-411 Payment Test Vendor"},
        cookies=admin_cookies,
    )
    assert vend_resp.status_code == 201
    vendor_id = vend_resp.json()["id"]

    bill_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "BILL-411-PAY-001",
            "category_id": cat_id,
            "issue_date": "2026-09-02",
            "due_date": "2026-09-20",
            "status": "ready_to_pay",
            "is_reviewed": True,
            "currency": "USD",
            "lines": [{"description": "Monthly Subscription", "quantity": 1, "unit_price": 250.0, "line_total": 250.0}],
        },
        cookies=admin_cookies,
    )
    assert bill_resp.status_code == 201
    bill_id = bill_resp.json()["id"]

    # 4. Record payment
    pay_resp = app_client.post(
        f"/api/finance/bills/{bill_id}/payments",
        json={
            "direction": "outgoing",
            "bank_account_id": bank_account_id,
            "payment_date": "2026-09-05",
            "amount": 250.0,
            "method": "bank_transfer",
            "reference": "REF-FUX-411-001",
        },
        cookies=admin_cookies,
    )
    assert pay_resp.status_code == 201
    payment = pay_resp.json()
    assert payment["id"] is not None

    # 5. Fetch ledger transactions for the account and verify exact category_id match
    tx_resp = app_client.get(f"/api/finance/accounts/{bank_account_id}/transactions", cookies=admin_cookies)
    assert tx_resp.status_code == 200
    txs = [t for t in tx_resp.json() if t.get("linked_bill_id") == bill_id]
    assert len(txs) == 1
    assert txs[0]["category_id"] == cat_id


def test_record_payment_fallback_warning_when_category_id_missing(app_client, admin_cookies, caplog):
    """When a bill has no category_id, record_payment must log a warning and fall back to Other."""
    # 1. Get bank account
    ba_resp = app_client.get("/api/finance/accounts", cookies=admin_cookies)
    assert ba_resp.status_code == 200
    accounts = ba_resp.json()
    if accounts:
        bank_account_id = accounts[0]["id"]
    else:
        create_ba = app_client.post(
            "/api/finance/accounts",
            json={
                "account_name": "Operating Bank 2",
                "bank_name": "Chase",
                "account_number": "1234567891",
                "currency": "USD",
                "opening_balance": 10000.0,
            },
            cookies=admin_cookies,
        )
        assert create_ba.status_code == 201
        bank_account_id = create_ba.json()["id"]

    # 2. Create vendor and bill with NO category_id and unmapped category string
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "FUX-411 Unmapped Vendor"},
        cookies=admin_cookies,
    )
    vendor_id = vend_resp.json()["id"]

    bill_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "BILL-411-UNMAPPED-01",
            "category": "UnmappedExoticCategory99",
            "issue_date": "2026-09-02",
            "due_date": "2026-09-20",
            "status": "ready_to_pay",
            "is_reviewed": True,
            "currency": "USD",
            "lines": [{"description": "Uncategorized Item", "quantity": 1, "unit_price": 100.0, "line_total": 100.0}],
        },
        cookies=admin_cookies,
    )
    assert bill_resp.status_code == 201
    bill_id = bill_resp.json()["id"]

    # 3. Record payment and check warning logged
    with caplog.at_level(logging.WARNING):
        pay_resp = app_client.post(
            f"/api/finance/bills/{bill_id}/payments",
            json={
                "direction": "outgoing",
                "bank_account_id": bank_account_id,
                "payment_date": "2026-09-05",
                "amount": 100.0,
                "method": "bank_transfer",
            },
            cookies=admin_cookies,
        )
        assert pay_resp.status_code == 201

    assert any("has missing or invalid category_id" in record.message for record in caplog.records)


def test_bill_category_quality_report_endpoint(app_client, admin_cookies):
    """Verify GET /api/finance/bills/category-quality-report returns report with unmatched counts and items."""
    report_resp = app_client.get("/api/finance/bills/category-quality-report", cookies=admin_cookies)
    assert report_resp.status_code == 200
    data = report_resp.json()
    assert "unmatched_count" in data
    assert "unmatched_bills" in data
    assert isinstance(data["unmatched_bills"], list)
    assert data["unmatched_count"] == len(data["unmatched_bills"])
