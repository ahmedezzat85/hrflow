"""
be/tests/test_finance_statutory_rules.py
Slice F4 of Finance Review Round 2: statutory obligations default to EGP and are paid only from an
account in the obligation's currency, with the chosen payment type and reference, balances via
recalculate_account_running_balances.
"""
from invoice_test_helpers import account_balance, make_account

STAT = "/api/finance/statutory-obligations"


def _obligation(client, cookies, amount=1000.0, **extra):
    body = {"obligation_type": "withholding_tax", "period": "2026-09", "amount_accrued": amount}
    body.update(extra)
    resp = client.post(STAT, json=body, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _settle(client, cookies, obl_id, account_id, amount, **extra):
    body = {"amount": amount, "payment_date": "2026-10-05", "bank_account_id": account_id}
    body.update(extra)
    return client.post(f"{STAT}/{obl_id}/settle", json=body, cookies=cookies)


def test_new_obligation_without_currency_is_egp(app_client, admin_cookies):
    assert _obligation(app_client, admin_cookies)["currency"] == "EGP"
    assert _obligation(app_client, admin_cookies, currency="USD")["currency"] == "USD"


def test_egp_obligation_cannot_be_paid_from_usd_account(app_client, admin_cookies):
    obl = _obligation(app_client, admin_cookies, 1000.0)
    usd = make_account(app_client, admin_cookies, currency="USD", balance=5000.0)
    resp = _settle(app_client, admin_cookies, obl["id"], usd, 1000.0)
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "currency_mismatch"
    assert account_balance(app_client, admin_cookies, usd) == 5000.0
    after = app_client.get(f"{STAT}/{obl['id']}", cookies=admin_cookies).json()
    assert after["amount_remitted"] == 0.0 and after["status"] == "accrued"


def test_payment_in_obligation_currency_posts_ledger_row_and_recalculates(app_client, admin_cookies):
    obl = _obligation(app_client, admin_cookies, 1000.0)
    egp = make_account(app_client, admin_cookies, currency="EGP", balance=5000.0)
    types = {t["code"]: t["id"] for t in app_client.get("/api/finance/payment-types", cookies=admin_cookies).json()}

    resp = _settle(app_client, admin_cookies, obl["id"], egp, 400.0, reference="GOV-77", payment_type_id=types["OUTBOUND_TRANS"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "partially_remitted"
    assert account_balance(app_client, admin_cookies, egp) == 4600.0

    rows = app_client.get(f"/api/finance/accounts/{egp}/transactions", cookies=admin_cookies).json()
    rows = rows["items"] if isinstance(rows, dict) else rows
    tx = [r for r in rows if r.get("source") == "statutory_remittance"]
    assert len(tx) == 1
    assert tx[0]["reference"] == "GOV-77" and tx[0]["currency"] == "EGP" and tx[0]["source"] == "statutory_remittance"
    assert tx[0]["payment_type_id"] == types["OUTBOUND_TRANS"] and tx[0]["running_balance"] == 4600.0

    # a backdated remittance keeps every running balance consistent
    back = app_client.post(f"{STAT}/{obl['id']}/settle", json={
        "amount": 100.0, "payment_date": "2026-09-01", "bank_account_id": egp}, cookies=admin_cookies)
    assert back.status_code == 200
    assert account_balance(app_client, admin_cookies, egp) == 4500.0
    rows = app_client.get(f"/api/finance/accounts/{egp}/transactions", cookies=admin_cookies).json()
    rows = rows["items"] if isinstance(rows, dict) else rows
    by_date = sorted((r for r in rows if r.get("source") == "statutory_remittance"), key=lambda r: r["date"])
    assert [r["running_balance"] for r in by_date] == [4900.0, 4500.0]


def test_payment_type_must_fit_the_account_kind(app_client, admin_cookies):
    obl = _obligation(app_client, admin_cookies, 1000.0)
    bank = make_account(app_client, admin_cookies, currency="EGP", balance=5000.0)
    types = {t["code"]: t["id"] for t in app_client.get("/api/finance/payment-types", cookies=admin_cookies).json()}
    resp = _settle(app_client, admin_cookies, obl["id"], bank, 100.0, payment_type_id=types["CASH"])
    assert resp.status_code == 400 and resp.json()["detail"]["code"] == "payment_type_not_allowed"
    assert account_balance(app_client, admin_cookies, bank) == 5000.0

    cash = make_account(app_client, admin_cookies, currency="EGP", balance=500.0, account_type="cash")
    ok = _settle(app_client, admin_cookies, obl["id"], cash, 100.0)
    assert ok.status_code == 200
    assert account_balance(app_client, admin_cookies, cash) == 400.0
