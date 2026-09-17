"""
be/tests/test_finance_guided_transactions.py
Tests for Story 5.2: Guided transaction entry, progressive types, currency mismatch prevention,
authorization on adjustments, and plain-language financial preview.
"""
import pytest


def test_guided_transaction_entry_and_preview(app_client, admin_cookies):
    # 1. Create a bank account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Guided Test USD",
            "bank_name": "JPMorgan Chase",
            "account_number": "12345678904821",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    acc_id = acc_res.json()["id"]

    # 2. Preview Money Out
    preview_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions/preview",
        json={
            "account_id": acc_id,
            "entry_type": "money_out",
            "direction": "out",
            "amount": 2500.0,
            "currency": "USD",
        },
        cookies=admin_cookies,
    )
    assert preview_res.status_code == 200, preview_res.text
    p_data = preview_res.json()
    assert p_data["current_book_balance"] == 10000.0
    assert p_data["projected_book_balance"] == 7500.0
    assert "decrease the Book Balance" in p_data["plain_description"]
    assert len(p_data["journal_preview"]) == 2

    # 3. Record Money Out with Counterparty and Tax
    create_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 2500.0,
            "direction": "out",
            "currency": "USD",
            "entry_type": "money_out",
            "counterparty": "CloudFlare Inc",
            "tax_amount": 250.0,
            "reference": "CF-INV-99",
            "description": "DNS & CDN Enterprise subscription",
        },
        cookies=admin_cookies,
    )
    assert create_res.status_code == 201, create_res.text
    tx = create_res.json()
    assert tx["counterparty"] == "CloudFlare Inc"
    assert tx["tax_amount"] == 250.0
    assert tx["entry_type"] == "money_out"
    assert tx["running_balance"] == 7500.0


def test_bank_fee_guided_entry(app_client, admin_cookies):
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Fee Test USD",
            "bank_name": "JPMorgan Chase",
            "account_number": "12345678909999",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    acc_id = acc_res.json()["id"]

    # Bank fee automatically defaults direction to 'out'
    res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 35.0,
            "direction": "in",  # Even if client erroneously sent 'in', bank_fee enforces 'out'
            "currency": "USD",
            "entry_type": "bank_fee",
            "reference": "FEE-SEP26",
            "description": "International Outgoing Wire Fee",
        },
        cookies=admin_cookies,
    )
    assert res.status_code == 201, res.text
    tx = res.json()
    assert tx["direction"] == "out"
    assert tx["entry_type"] == "bank_fee"
    assert tx["running_balance"] == 9965.0


def test_currency_and_account_mismatch_prevented(app_client, admin_cookies):
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "FX Test USD",
            "bank_name": "JPMorgan Chase",
            "account_number": "12345678908888",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    acc_id = acc_res.json()["id"]

    # Attempt to post EGP without fx_rate
    err_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 5000.0,
            "direction": "out",
            "currency": "EGP",
            "entry_type": "money_out",
        },
        cookies=admin_cookies,
    )
    assert err_res.status_code == 400
    assert "Currency mismatch" in err_res.json()["detail"]
    assert "exchange rate" in err_res.json()["detail"].lower()

    # Post with valid fx_rate
    ok_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 50000.0,
            "direction": "out",
            "currency": "EGP",
            "fx_rate": 50.0,
            "entry_type": "money_out",
            "reference": "EGP-DISBURSE",
        },
        cookies=admin_cookies,
    )
    assert ok_res.status_code == 201, ok_res.text
    tx = ok_res.json()
    assert tx["currency"] == "EGP"
    assert tx["fx_rate"] == 50.0
    assert tx["base_amount"] == 1000.0


def test_adjustment_requires_authorization_and_reason(app_client, admin_cookies, employee_cookies):
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Adj Test USD",
            "bank_name": "JPMorgan Chase",
            "account_number": "12345678907777",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    acc_id = acc_res.json()["id"]

    # 1. Non-admin operator without finance.adjustment.manage permission
    denied = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 100.0,
            "direction": "in",
            "currency": "USD",
            "entry_type": "adjustment",
            "reason": "Quarter-end bank interest reconciliation variance",
        },
        cookies=employee_cookies,
    )
    # employee role doesn't have write on accounts or adjustments
    assert denied.status_code in (401, 403)

    # 2. Authorized user but missing mandatory reason
    no_reason = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 100.0,
            "direction": "in",
            "currency": "USD",
            "entry_type": "adjustment",
            "reason": "",
        },
        cookies=admin_cookies,
    )
    assert no_reason.status_code == 400
    assert "specific reason is required" in no_reason.json()["detail"].lower()

    # 3. Authorized user with valid reason
    success = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 150.0,
            "direction": "in",
            "currency": "USD",
            "entry_type": "adjustment",
            "reason": "Bank interest credited at statement close not auto-ingested",
            "reference": "ADJ-INT-0926",
        },
        cookies=admin_cookies,
    )
    assert success.status_code == 201, success.text
    tx = success.json()
    assert tx["entry_type"] == "adjustment"
    assert tx["reason"] == "Bank interest credited at statement close not auto-ingested"
    assert tx["running_balance"] == 10150.0
