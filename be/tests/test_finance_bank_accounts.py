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


def test_bank_account_reveal_and_audit(app_client, admin_cookies, employee_cookies, monkeypatch):
    # 1. Create account
    create_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Reveal Security Test Account",
            "bank_name": "Citibank",
            "account_number": "CITI-US-9988776655",
            "currency": "USD",
            "opening_balance": 50000.0,
        },
        cookies=admin_cookies,
    )
    assert create_resp.status_code == 201
    acc_id = create_resp.json()["id"]

    # 2. Normal GET is masked by default
    get_masked = app_client.get(f"/api/finance/accounts/{acc_id}", cookies=admin_cookies)
    assert get_masked.status_code == 200
    assert get_masked.json()["account_number"] == "**************6655"

    # 3. GET with reveal=true as admin returns unmasked account identifier
    get_revealed = app_client.get(f"/api/finance/accounts/{acc_id}?reveal=true", cookies=admin_cookies)
    assert get_revealed.status_code == 200
    assert get_revealed.json()["account_number"] == "CITI-US-9988776655"

    # 4. GET with reveal=true for employee without finance.bank_account.reveal gets 403
    from core import permissions as perm_module
    def mock_employee_perms(request, current_user, db):
        return {"finance.account.read"}

    monkeypatch.setattr(perm_module, "get_current_user_permissions", mock_employee_perms)
    unauthorized_reveal = app_client.get(f"/api/finance/accounts/{acc_id}?reveal=true", cookies=employee_cookies)
    assert unauthorized_reveal.status_code == 403
    assert "finance.bank_account.reveal" in unauthorized_reveal.json()["detail"]


def test_bank_account_balance_separation_metrics(app_client, admin_cookies):
    # 1. Create account with opening balance 25,000 USD
    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Balance Separation Test Account",
            "bank_name": "Barclays",
            "account_number": "BARC-UK-001122",
            "currency": "USD",
            "opening_balance": 25000.0,
            "opening_balance_date": "2026-09-01",
        },
        cookies=admin_cookies,
    )
    assert acc_resp.status_code == 201
    acc_id = acc_resp.json()["id"]
    data = acc_resp.json()

    # Verify Story 5.1 separated balances
    assert data["book_balance"] == 25000.0
    assert data["available_balance"] == 25000.0
    assert data["opening_balance_date"] == "2026-09-01"
    assert data["balance_definitions"] is not None
    assert "book_balance" in data["balance_definitions"]
    assert "available_balance" in data["balance_definitions"]
    assert data["has_postings"] is False

    # 2. Issue a cheque of 3,000 USD on this account
    chq_resp = app_client.post(
        "/api/finance/cheques",
        json={
            "account_id": acc_id,
            "cheque_number": "009988",
            "issue_date": "2026-09-10",
            "amount": 3000.0,
            "currency": "USD",
            "payee": "Vendor Supplier",
            "purpose_type": "vendor_payment",
            "status": "issued",
        },
        cookies=admin_cookies,
    )
    assert chq_resp.status_code == 201

    # 3. Query account again: book balance is 22,000 (cheque written), bank balance is 25,000 (uncleared by bank)!
    acc_refreshed = app_client.get(f"/api/finance/accounts/{acc_id}", cookies=admin_cookies).json()
    assert acc_refreshed["book_balance"] == 22000.0
    assert acc_refreshed["bank_balance"] == 25000.0
    assert acc_refreshed["available_balance"] == 22000.0


def test_currency_change_prevented_after_postings(app_client, admin_cookies):
    # 1. Create USD account
    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Currency Lock Test Account",
            "bank_name": "JPMorgan",
            "account_number": "JPM-LOCK-77",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_resp.status_code == 201
    acc_id = acc_resp.json()["id"]

    # 2. Update currency to EUR before any postings -> Allowed!
    upd_resp1 = app_client.put(
        f"/api/finance/accounts/{acc_id}",
        json={"currency": "EUR"},
        cookies=admin_cookies,
    )
    assert upd_resp1.status_code == 200
    assert upd_resp1.json()["currency"] == "EUR"

    # 3. Post a transaction to the account
    tx_resp = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-12",
            "amount": 500.0,
            "direction": "in",
            "currency": "EUR",
            "reference": "POSTING-01",
            "description": "Initial Euro Deposit",
        },
        cookies=admin_cookies,
    )
    assert tx_resp.status_code == 201

    # 4. Attempting to change currency to USD after postings -> MUST BE PREVENTED (400 Bad Request)
    upd_resp2 = app_client.put(
        f"/api/finance/accounts/{acc_id}",
        json={"currency": "USD"},
        cookies=admin_cookies,
    )
    assert upd_resp2.status_code == 400
    assert "Currency cannot be modified after transactions have been posted" in upd_resp2.json()["detail"]


