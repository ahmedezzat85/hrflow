"""
be/tests/test_finance_banking_rules.py
Slice B6 of Vendor Bill Workflow v2 (D-020): banking rules.

 - A manual entry is in its account's currency; there is no exchange rate on manual entries.
 - A cash withdrawal (teller or cheque) funds a cash account in the same currency as the bank account.
 - Stopping, voiding, bouncing or replacing a cheque keeps its entries and adds reversing entries;
   the bill payment it made is reversed through the settlement service.
 - Spend is a bill: money out to a vendor without a bill is refused.
"""
from bill_test_helpers import create_approved, make_account, make_vendor

BASE = "/api/finance/bills"


def _cash(client, cookies, name, number, currency, balance=0.0):
    resp = client.post(
        "/api/finance/accounts",
        json={"account_name": name, "account_number": number, "currency": currency,
              "opening_balance": balance, "account_type": "cash"},
        cookies=cookies,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _balance(client, cookies, account_id):
    return client.get(f"/api/finance/accounts/{account_id}", cookies=cookies).json()["current_balance"]


def _tx(client, cookies, account, **extra):
    payload = {"date": "2026-09-05", "amount": 100.0, "direction": "out", "currency": "USD",
               "reference": "T", "description": "d", "entry_type": "money_out"}
    payload.update(extra)
    return client.post(f"/api/finance/accounts/{account}/transactions", json=payload, cookies=cookies)


# ── AC: a USD transaction on an EGP account is refused; no rate field remains ─
def test_manual_entry_must_match_account_currency_and_takes_no_rate(app_client, admin_cookies):
    egp = make_account(app_client, admin_cookies, "B6 EGP", number="66660001", balance=5000.0, currency="EGP")
    usd = make_account(app_client, admin_cookies, "B6 USD", number="66660002", balance=5000.0)

    refused = _tx(app_client, admin_cookies, egp, currency="USD")
    assert refused.status_code == 400 and refused.json()["detail"]["code"] == "currency_mismatch"
    with_rate = _tx(app_client, admin_cookies, egp, currency="USD", fx_rate=50.0)
    assert with_rate.status_code == 422
    assert _tx(app_client, admin_cookies, usd, fx_rate=50.0, base_amount=5000.0).status_code == 422
    assert _balance(app_client, admin_cookies, egp) == 5000.0

    ok = _tx(app_client, admin_cookies, egp, currency="EGP", amount=250.0)
    assert ok.status_code == 201 and ok.json()["fx_rate"] is None
    assert _balance(app_client, admin_cookies, egp) == 4750.0

    # an update cannot add a rate either
    patched = app_client.patch(f"/api/finance/transactions/{ok.json()['id']}", json={"fx_rate": 48.0}, cookies=admin_cookies)
    assert patched.status_code == 422


# ── AC: a USD withdrawal into CASH - EGP is refused, for teller withdrawals and cheques
def test_cash_withdrawals_need_same_currency_cash_account(app_client, admin_cookies):
    usd_bank = make_account(app_client, admin_cookies, "B6 Teller USD", number="66660003", balance=5000.0)
    egp_cash = _cash(app_client, admin_cookies, "CASH - EGP", "66660004", "EGP")
    usd_cash = _cash(app_client, admin_cookies, "CASH - USD", "66660005", "USD")

    teller_bad = _tx(app_client, admin_cookies, usd_bank, destination_cash_account_id=egp_cash, entry_type="money_out")
    assert teller_bad.status_code == 400 and teller_bad.json()["detail"]["code"] == "currency_mismatch"
    assert _balance(app_client, admin_cookies, usd_bank) == 5000.0 and _balance(app_client, admin_cookies, egp_cash) == 0.0

    teller_ok = _tx(app_client, admin_cookies, usd_bank, destination_cash_account_id=usd_cash, amount=200.0)
    assert teller_ok.status_code == 201, teller_ok.text
    assert _balance(app_client, admin_cookies, usd_cash) == 200.0

    def cheque(number, cash_id):
        return app_client.post(
            "/api/finance/cheques",
            json={"account_id": usd_bank, "cheque_number": number, "issue_date": "2026-09-05", "amount": 300.0,
                  "currency": "USD", "payee": "Cash", "purpose_type": "cash_withdrawal", "destination_cash_account_id": cash_id},
            cookies=admin_cookies,
        )

    bad = cheque("990001", egp_cash)
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "currency_mismatch"
    good = cheque("990002", usd_cash)
    assert good.status_code == 201, good.text


# ── AC: stopping a cheque keeps its entries, adds reversing entries, restores the balance
#        and reverses its bill payment
def test_stopping_a_cheque_adds_reversing_entries_and_reverses_the_bill_payment(app_client, admin_cookies):
    from db import get_db_context
    from finance.models import LedgerTransactionDB, PaymentDB

    vid = make_vendor(app_client, admin_cookies, "B6 Cheque Vendor")
    acct = make_account(app_client, admin_cookies, "B6 Cheque Bank", number="66660006", balance=1000.0)
    bill = create_approved(app_client, admin_cookies, vid, "B6-CHQ-1", 300.0, currency="USD")

    issued = app_client.post(
        "/api/finance/cheques",
        json={"account_id": acct, "cheque_number": "770100", "issue_date": "2026-09-05", "amount": 300.0, "currency": "USD",
              "payee": "B6 Cheque Vendor", "purpose_type": "vendor_payment", "linked_bill_id": bill["id"]},
        cookies=admin_cookies,
    )
    assert issued.status_code == 201, issued.text
    cid = issued.json()["id"]
    assert _balance(app_client, admin_cookies, acct) == 700.0
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["status"] == "paid"

    stop = app_client.patch(
        f"/api/finance/cheques/{cid}/status", json={"status": "stopped", "reason": "Lost in the post"}, cookies=admin_cookies
    )
    assert stop.status_code == 200, stop.text

    with get_db_context() as db:
        rows = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.linked_cheque_id == cid).order_by(LedgerTransactionDB.id).all()
        assert [r.source for r in rows] == ["cheque", "cheque_reversal"]
        original, reversal = rows
        assert original.direction == "out" and reversal.direction == "in" and reversal.amount == original.amount
        assert "Lost in the post" in reversal.description and reversal.reason == "Lost in the post"
        assert reversal.reference == f"REV-TX-{original.id}"
        payments = db.query(PaymentDB).filter(PaymentDB.related_bill_id == bill["id"]).all()
        assert len(payments) == 1 and payments[0].is_reversed is True

    assert _balance(app_client, admin_cookies, acct) == 1000.0
    after = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert after["status"] == "approved" and after["amount_paid"] == 0.0

    # stopping again is a no-op transition error and adds nothing
    again = app_client.patch(f"/api/finance/cheques/{cid}/status", json={"status": "stopped", "reason": "again"}, cookies=admin_cookies)
    assert again.status_code in (200, 400)
    with get_db_context() as db:
        assert db.query(LedgerTransactionDB).filter(LedgerTransactionDB.linked_cheque_id == cid).count() == 2


def test_replacing_a_cheque_reverses_the_old_entries_without_deleting_them(app_client, admin_cookies):
    from db import get_db_context
    from finance.models import LedgerTransactionDB

    acct = make_account(app_client, admin_cookies, "B6 Replace Bank", number="66660007", balance=1000.0)
    issued = app_client.post(
        "/api/finance/cheques",
        json={"account_id": acct, "cheque_number": "770200", "issue_date": "2026-09-05", "amount": 150.0, "currency": "USD",
              "payee": "Someone", "purpose_type": "other"},
        cookies=admin_cookies,
    )
    assert issued.status_code == 201, issued.text
    cid = issued.json()["id"]
    assert _balance(app_client, admin_cookies, acct) == 850.0

    replaced = app_client.post(
        f"/api/finance/cheques/{cid}/replace",
        json={"new_cheque_number": "770201", "new_issue_date": "2026-09-06", "reason": "Printed wrong payee"},
        cookies=admin_cookies,
    )
    assert replaced.status_code == 201, replaced.text
    with get_db_context() as db:
        old_rows = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.linked_cheque_id == cid).all()
        assert sorted(r.source for r in old_rows) == ["cheque", "cheque_reversal"]
        assert any("Printed wrong payee" in r.description for r in old_rows if r.source == "cheque_reversal")
    # the old cheque is reversed; only the replacement is outstanding
    assert _balance(app_client, admin_cookies, acct) == 850.0


# ── AC: a vendor money-out without a bill is refused ─────────────────────────
def test_vendor_money_out_without_a_bill_is_refused(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "B6 Spend Vendor")
    acct = make_account(app_client, admin_cookies, "B6 Spend Bank", number="66660008", balance=1000.0)

    refused = _tx(app_client, admin_cookies, acct, payee_type="vendor", payee_id=vid)
    assert refused.status_code == 400
    assert refused.json()["detail"]["code"] == "vendor_payment_needs_bill"
    assert "bill" in refused.json()["detail"]["message"].lower()
    assert _balance(app_client, admin_cookies, acct) == 1000.0

    # plain transactions stay available for bank fees, withdrawals and money in
    assert _tx(app_client, admin_cookies, acct, entry_type="bank_fee", amount=5.0).status_code == 201
    assert _tx(app_client, admin_cookies, acct, direction="in", entry_type="money_in", payee_type="vendor", payee_id=vid).status_code == 201

    # paying the vendor's bill is the way
    bill = create_approved(app_client, admin_cookies, vid, "B6-SPEND-1", 100.0, currency="USD")
    linked = _tx(app_client, admin_cookies, acct, payee_type="vendor", payee_id=vid, linked_bill_id=bill["id"])
    assert linked.status_code == 201, linked.text
