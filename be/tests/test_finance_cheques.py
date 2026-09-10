"""
be/tests/test_finance_cheques.py
Unit and integration tests for Phase 5: Cheque & Teller Withdrawal Module.
"""
import pytest


def test_issue_vendor_payment_cheque(app_client, admin_cookies):
    """Admin issues a cheque linked to a vendor bill; verifies single ledger outflow and bill marked paid."""
    # 1. Setup vendor and bill
    v_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Cheque Vendor Corp", "category": "Equipment"},
        cookies=admin_cookies,
    )
    assert v_resp.status_code == 201
    vendor_id = v_resp.json()["id"]

    bill_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "BILL-CHK-001",
            "category": "Equipment",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "currency": "USD",
            "lines": [
                {"description": "Server hardware", "quantity": 1.0, "unit_price": 3000.0, "line_total": 3000.0}
            ],
        },
        cookies=admin_cookies,
    )
    assert bill_resp.status_code == 201
    bill_id = bill_resp.json()["id"]
    assert bill_resp.json()["status"] == "unpaid"

    # 2. Setup bank account
    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Operating Checking USD",
            "bank_name": "JPMorgan Chase",
            "account_number": "CHK-ACC-111",
            "currency": "USD",
            "opening_balance": 100000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert acc_resp.status_code == 201
    account_id = acc_resp.json()["id"]

    # 3. Issue Cheque linked to bill
    cheque_payload = {
        "account_id": account_id,
        "cheque_number": "001001",
        "issue_date": "2026-09-05",
        "amount": 3000.0,
        "currency": "USD",
        "payee": "Cheque Vendor Corp",
        "purpose_type": "vendor_payment",
        "linked_bill_id": bill_id,
        "notes": "Payment for server hardware",
    }
    c_resp = app_client.post("/api/finance/cheques", json=cheque_payload, cookies=admin_cookies)
    assert c_resp.status_code == 201
    cheque = c_resp.json()
    assert cheque["cheque_number"] == "001001"
    assert cheque["status"] == "issued"
    assert cheque["account_name"] == "Operating Checking USD"
    assert cheque["linked_transaction_id"] is not None
    assert cheque["linked_cash_transaction_id"] is None
    assert cheque["fiscal_year"] == 2026

    # 4. Verify bank account balance reduced by 3000
    acc_check = app_client.get(f"/api/finance/accounts/{account_id}", cookies=admin_cookies).json()
    assert abs(acc_check["current_balance"] - 97000.0) < 0.01

    # 5. Verify linked bill is now paid
    bill_check = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies).json()
    assert bill_check["status"] == "paid"

    # 6. Verify ledger transaction recorded on bank account
    tx_resp = app_client.get(f"/api/finance/accounts/{account_id}/transactions", cookies=admin_cookies)
    assert tx_resp.status_code == 200
    txs = tx_resp.json()
    assert any(t["cheque_number"] == "001001" and t["direction"] == "out" and t["amount"] == 3000.0 for t in txs)


def test_issue_cash_withdrawal_cheque_dual_legs(app_client, admin_cookies):
    """Cheque with purpose cash_withdrawal atomically creates both bank outflow and cash inflow ledger legs."""
    # 1. Setup bank account
    bank_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Vault Bank EGP",
            "bank_name": "CIB Egypt",
            "account_number": "CIB-EGP-999",
            "currency": "EGP",
            "opening_balance": 500000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert bank_resp.status_code == 201
    bank_id = bank_resp.json()["id"]

    # 2. Setup cash account
    cash_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Office Petty Cash EGP",
            "account_number": "PETTY-CASH-EGP",
            "currency": "EGP",
            "opening_balance": 10000.0,
            "account_type": "cash",
        },
        cookies=admin_cookies,
    )
    assert cash_resp.status_code == 201
    cash_id = cash_resp.json()["id"]

    # 3. Issue Cash Withdrawal Cheque
    cheque_payload = {
        "account_id": bank_id,
        "cheque_number": "CHK-CW-01",
        "issue_date": "2026-09-08",
        "amount": 50000.0,
        "currency": "EGP",
        "payee": "Voyance Health (Cash Drawer)",
        "purpose_type": "cash_withdrawal",
        "destination_cash_account_id": cash_id,
        "notes": "Office petty spend replenishment",
    }
    create_resp = app_client.post("/api/finance/cheques", json=cheque_payload, cookies=admin_cookies)
    assert create_resp.status_code == 201
    cheque = create_resp.json()
    assert cheque["linked_transaction_id"] is not None
    assert cheque["linked_cash_transaction_id"] is not None
    assert cheque["destination_cash_account_name"] == "Office Petty Cash EGP"

    # 4. Verify balances updated on both accounts
    bank_check = app_client.get(f"/api/finance/accounts/{bank_id}", cookies=admin_cookies).json()
    assert abs(bank_check["current_balance"] - 450000.0) < 0.01

    cash_check = app_client.get(f"/api/finance/accounts/{cash_id}", cookies=admin_cookies).json()
    assert abs(cash_check["current_balance"] - 60000.0) < 0.01

    # 5. Verify continuous ledger legs on both accounts
    bank_txs = app_client.get(f"/api/finance/accounts/{bank_id}/transactions", cookies=admin_cookies).json()
    assert any(t["id"] == cheque["linked_transaction_id"] and t["direction"] == "out" and t["amount"] == 50000.0 for t in bank_txs)

    cash_txs = app_client.get(f"/api/finance/accounts/{cash_id}/transactions", cookies=admin_cookies).json()
    assert any(t["id"] == cheque["linked_cash_transaction_id"] and t["direction"] == "in" and t["amount"] == 50000.0 for t in cash_txs)


def test_cheque_status_lifecycle_and_reversals(app_client, admin_cookies):
    """Test cleared, bounced (with dual-leg reversal), and voided (with bill restore) transitions."""
    # 1. Setup accounts
    bank_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Lifecycle Bank USD",
            "bank_name": "HSBC",
            "account_number": "HSBC-LC-01",
            "currency": "USD",
            "opening_balance": 80000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    bank_id = bank_resp.json()["id"]

    cash_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Lifecycle Cash USD",
            "account_number": "CASH-LC-01",
            "currency": "USD",
            "opening_balance": 5000.0,
            "account_type": "cash",
        },
        cookies=admin_cookies,
    )
    cash_id = cash_resp.json()["id"]

    # 2. Issue Cheque 1 -> Clear it
    c1_resp = app_client.post(
        "/api/finance/cheques",
        json={
            "account_id": bank_id,
            "cheque_number": "CHK-CLEAR-01",
            "issue_date": "2026-09-01",
            "amount": 2000.0,
            "currency": "USD",
            "payee": "Vendor Cleared",
            "purpose_type": "other",
        },
        cookies=admin_cookies,
    )
    c1_id = c1_resp.json()["id"]
    assert c1_resp.json()["status"] == "issued"

    # Update status to cleared
    clear_resp = app_client.patch(
        f"/api/finance/cheques/{c1_id}/status",
        json={"status": "cleared", "clear_date": "2026-09-04"},
        cookies=admin_cookies,
    )
    assert clear_resp.status_code == 200
    assert clear_resp.json()["status"] == "cleared"
    assert clear_resp.json()["clear_date"] == "2026-09-04"

    # 3. Issue Cheque 2 (cash withdrawal) -> Bounce it (reverses dual legs)
    c2_resp = app_client.post(
        "/api/finance/cheques",
        json={
            "account_id": bank_id,
            "cheque_number": "CHK-BOUNCE-01",
            "issue_date": "2026-09-05",
            "amount": 10000.0,
            "currency": "USD",
            "payee": "Cash Drawer",
            "purpose_type": "cash_withdrawal",
            "destination_cash_account_id": cash_id,
        },
        cookies=admin_cookies,
    )
    c2_id = c2_resp.json()["id"]
    # Check bank is debited (80000 - 2000 - 10000 = 68000) and cash is credited (5000 + 10000 = 15000)
    assert abs(app_client.get(f"/api/finance/accounts/{bank_id}", cookies=admin_cookies).json()["current_balance"] - 68000.0) < 0.01
    assert abs(app_client.get(f"/api/finance/accounts/{cash_id}", cookies=admin_cookies).json()["current_balance"] - 15000.0) < 0.01

    # Now bounce cheque 2
    bounce_resp = app_client.patch(
        f"/api/finance/cheques/{c2_id}/status",
        json={"status": "bounced"},
        cookies=admin_cookies,
    )
    assert bounce_resp.status_code == 200
    assert bounce_resp.json()["status"] == "bounced"

    # Balances restored!
    assert abs(app_client.get(f"/api/finance/accounts/{bank_id}", cookies=admin_cookies).json()["current_balance"] - 78000.0) < 0.01
    assert abs(app_client.get(f"/api/finance/accounts/{cash_id}", cookies=admin_cookies).json()["current_balance"] - 5000.0) < 0.01


def test_direct_teller_withdrawal_auto_funding(app_client, admin_cookies):
    """Direct teller withdrawal (payment_type=CASHWITHDRAW, no cheque #) auto-funds destination cash account."""
    # 1. Setup accounts
    bank_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Teller Source Bank",
            "bank_name": "QNB",
            "account_number": "QNB-TELLER-01",
            "currency": "EGP",
            "opening_balance": 100000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    bank_id = bank_resp.json()["id"]

    cash_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Teller Target Cash",
            "account_number": "CASH-TARGET-01",
            "currency": "EGP",
            "opening_balance": 2000.0,
            "account_type": "cash",
        },
        cookies=admin_cookies,
    )
    cash_id = cash_resp.json()["id"]

    # 2. Record manual bank outflow transaction with destination_cash_account_id
    tx_payload = {
        "date": "2026-09-09",
        "amount": 15000.0,
        "direction": "out",
        "currency": "EGP",
        "reference": "TELLER-SLIP-8842",
        "description": "Counter withdrawal for urgent courier petty cash",
        "destination_cash_account_id": cash_id,
    }
    tx_resp = app_client.post(
        f"/api/finance/accounts/{bank_id}/transactions",
        json=tx_payload,
        cookies=admin_cookies,
    )
    assert tx_resp.status_code == 201

    # 3. Verify both balances updated
    bank_bal = app_client.get(f"/api/finance/accounts/{bank_id}", cookies=admin_cookies).json()["current_balance"]
    assert abs(bank_bal - 85000.0) < 0.01

    cash_bal = app_client.get(f"/api/finance/accounts/{cash_id}", cookies=admin_cookies).json()["current_balance"]
    assert abs(cash_bal - 17000.0) < 0.01

    # 4. Verify paired cash inflow transaction was automatically created
    cash_txs = app_client.get(f"/api/finance/accounts/{cash_id}/transactions", cookies=admin_cookies).json()
    assert any(t["direction"] == "in" and t["amount"] == 15000.0 and "Teller cash withdrawal" in t["description"] for t in cash_txs)


def test_cheque_validations(app_client, admin_cookies):
    """Validates unique cheque numbers per account, rejects cash account source, and checks cash withdrawal constraints."""
    # 1. Setup bank account
    bank_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Validation Bank USD",
            "bank_name": "Wells Fargo",
            "account_number": "WF-VAL-01",
            "currency": "USD",
            "opening_balance": 50000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    bank_id = bank_resp.json()["id"]

    cash_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Validation Cash USD",
            "account_number": "CASH-VAL-01",
            "currency": "USD",
            "opening_balance": 1000.0,
            "account_type": "cash",
        },
        cookies=admin_cookies,
    )
    cash_id = cash_resp.json()["id"]

    # 2. Cannot issue cheque from a cash account
    bad_source = {
        "account_id": cash_id,
        "cheque_number": "CHK-BAD-01",
        "issue_date": "2026-09-01",
        "amount": 500.0,
        "currency": "USD",
        "payee": "Someone",
        "purpose_type": "other",
    }
    bad_source_resp = app_client.post("/api/finance/cheques", json=bad_source, cookies=admin_cookies)
    assert bad_source_resp.status_code == 400
    assert "must be drawn from a bank account" in bad_source_resp.json()["detail"]

    # 3. Cannot issue cash_withdrawal without destination_cash_account_id
    bad_dest = {
        "account_id": bank_id,
        "cheque_number": "CHK-NODEST-01",
        "issue_date": "2026-09-01",
        "amount": 500.0,
        "currency": "USD",
        "payee": "Cash Drawer",
        "purpose_type": "cash_withdrawal",
    }
    bad_dest_resp = app_client.post("/api/finance/cheques", json=bad_dest, cookies=admin_cookies)
    assert bad_dest_resp.status_code == 400

    # 4. Successful first issue
    valid_payload = {
        "account_id": bank_id,
        "cheque_number": "CHK-DUP-01",
        "issue_date": "2026-09-01",
        "amount": 500.0,
        "currency": "USD",
        "payee": "Valid Payee",
        "purpose_type": "other",
    }
    ok_resp = app_client.post("/api/finance/cheques", json=valid_payload, cookies=admin_cookies)
    assert ok_resp.status_code == 201

    # 5. Duplicate cheque number on same account rejected (400)
    dup_resp = app_client.post("/api/finance/cheques", json=valid_payload, cookies=admin_cookies)
    assert dup_resp.status_code == 400
    assert "already been issued" in dup_resp.json()["detail"]

    # 6. Listing and filter by fiscal_year
    list_resp = app_client.get("/api/finance/cheques?fiscal_year=2026", cookies=admin_cookies)
    assert list_resp.status_code == 200
    assert any(c["cheque_number"] == "CHK-DUP-01" for c in list_resp.json())
