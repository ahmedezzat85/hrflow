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
