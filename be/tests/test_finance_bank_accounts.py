"""
be/tests/test_finance_bank_accounts.py
Comprehensive tests for Company Bank Accounts CRUD, masking, and RBAC permissions.
"""
import pytest


def test_bank_accounts_crud_and_masking(app_client, admin_cookies):
    # 1. Initially list can be queried
    resp = app_client.get("/api/finance/accounts", cookies=admin_cookies)
    assert resp.status_code == 200
    initial_count = len(resp.json())

    # 2. Create bank account
    payload = {
        "account_name": "Operating Chase USD",
        "bank_name": "JPMorgan Chase",
        "account_number": "12345678904821",
        "currency": "USD",
        "opening_balance": 100000.0,
    }
    create_resp = app_client.post("/api/finance/accounts", json=payload, cookies=admin_cookies)
    assert create_resp.status_code == 201
    created_data = create_resp.json()
    assert created_data["id"] is not None
    assert created_data["account_name"] == "Operating Chase USD"
    assert created_data["current_balance"] == 100000.0
    assert created_data["account_number"] == "**********4821"  # Masked!
    assert created_data["is_active"] is True
    acc_id = created_data["id"]

    # 3. Duplicate name rejected
    dup_resp = app_client.post("/api/finance/accounts", json=payload, cookies=admin_cookies)
    assert dup_resp.status_code == 400

    # 4. Get by ID
    get_resp = app_client.get(f"/api/finance/accounts/{acc_id}", cookies=admin_cookies)
    assert get_resp.status_code == 200
    assert get_resp.json()["account_number"] == "**********4821"

    # 5. Update bank account
    update_payload = {"account_name": "Operating Chase Primary", "currency": "USD"}
    put_resp = app_client.put(f"/api/finance/accounts/{acc_id}", json=update_payload, cookies=admin_cookies)
    assert put_resp.status_code == 200
    assert put_resp.json()["account_name"] == "Operating Chase Primary"

    # 6. Soft delete / deactivate
    del_resp = app_client.delete(f"/api/finance/accounts/{acc_id}", cookies=admin_cookies)
    assert del_resp.status_code == 200
    assert del_resp.json()["is_active"] is False

    # 7. Filter by is_active query param
    active_resp = app_client.get("/api/finance/accounts?is_active=true", cookies=admin_cookies)
    assert not any(a["id"] == acc_id for a in active_resp.json())

    inactive_resp = app_client.get("/api/finance/accounts?is_active=false", cookies=admin_cookies)
    assert any(a["id"] == acc_id for a in inactive_resp.json())


def test_bank_accounts_rbac_permissions(app_client, employee_cookies):
    # Read should be forbidden (403) for standard employee
    resp = app_client.get("/api/finance/accounts", cookies=employee_cookies)
    assert resp.status_code == 403

    # Write should be forbidden (403)
    create_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Hacker Account",
            "bank_name": "Offshore",
            "account_number": "999999",
        },
        cookies=employee_cookies,
    )
    assert create_resp.status_code == 403


def test_account_transactions_and_petty_summary_api(app_client, admin_cookies, employee_cookies):
    """
    Tests REST endpoints for listing, creating, patching, deleting manual transactions,
    and querying petty spend rollups.
    """
    # 1. Create a bank account
    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "API Ledger Test Account",
            "bank_name": "HSBC",
            "account_number": "HSBC-TX-001",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_resp.status_code == 201
    acc_id = acc_resp.json()["id"]

    # 2. Query categories to pick one
    cats_resp = app_client.get("/api/finance/categories", cookies=admin_cookies)
    assert cats_resp.status_code == 200
    categories = cats_resp.json()
    cat_id = categories[0]["id"] if categories else None

    # Query payment types to pick one
    pts_resp = app_client.get("/api/finance/payment-types", cookies=admin_cookies)
    assert pts_resp.status_code == 200
    payment_types = pts_resp.json()
    pt_id = payment_types[0]["id"] if payment_types else None

    # 3. Create a manual transaction
    tx_payload = {
        "date": "2026-09-01",
        "amount": 2500.0,
        "direction": "in",
        "currency": "USD",
        "category_id": cat_id,
        "payment_type_id": pt_id,
        "reference": "INV-REF-999",
        "description": "API Test Manual Deposit",
        "fx_rate": 48.5,
    }
    tx_resp = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json=tx_payload,
        cookies=admin_cookies,
    )
    assert tx_resp.status_code == 201
    tx_data = tx_resp.json()
    assert tx_data["id"] is not None
    assert tx_data["running_balance"] == 12500.0
    assert tx_data["fx_equivalent"] == round(2500.0 * 48.5, 4)
    tx_id = tx_data["id"]

    # 4. List transactions for this account
    list_resp = app_client.get(f"/api/finance/accounts/{acc_id}/transactions", cookies=admin_cookies)
    assert list_resp.status_code == 200
    tx_list = list_resp.json()
    assert len(tx_list) >= 1
    assert any(t["id"] == tx_id for t in tx_list)

    # 5. Fetch transaction by ID
    get_tx_resp = app_client.get(f"/api/finance/transactions/{tx_id}", cookies=admin_cookies)
    assert get_tx_resp.status_code == 200
    assert get_tx_resp.json()["id"] == tx_id

    # 6. Update manual transaction
    patch_resp = app_client.patch(
        f"/api/finance/transactions/{tx_id}",
        json={"amount": 3000.0, "description": "Updated deposit description"},
        cookies=admin_cookies,
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["amount"] == 3000.0
    assert patch_resp.json()["running_balance"] == 13000.0

    # 7. Check account current_balance updated to 13000.0
    acc_check = app_client.get(f"/api/finance/accounts/{acc_id}", cookies=admin_cookies)
    assert acc_check.json()["current_balance"] == 13000.0

    # 8. Query petty summary endpoint
    petty_resp = app_client.get(f"/api/finance/accounts/{acc_id}/transactions/petty-summary", cookies=admin_cookies)
    assert petty_resp.status_code == 200
    assert "total_in" in petty_resp.json()
    assert "by_category" in petty_resp.json()

    # 9. Delete manual transaction
    del_resp = app_client.delete(f"/api/finance/transactions/{tx_id}", cookies=admin_cookies)
    assert del_resp.status_code == 200

    # Account current_balance returns to opening balance 10000.0
    acc_check2 = app_client.get(f"/api/finance/accounts/{acc_id}", cookies=admin_cookies)
    assert acc_check2.json()["current_balance"] == 10000.0

    # 10. Non-admin RBAC verification
    forbidden_resp = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json=tx_payload,
        cookies=employee_cookies,
    )
    assert forbidden_resp.status_code == 403

