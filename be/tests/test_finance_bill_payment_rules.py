"""
be/tests/test_finance_bill_payment_rules.py
Slice B3 of Vendor Bill Workflow v2 (D-018): payment fields, same-currency and balance checks.

Every route that pays a bill goes through settlement_service.settle_bill:
 - the Pay dialog, create-and-pay ("Already paid"), a manual transaction with linked_bill_id,
   and a cheque with linked_bill_id.
"""
import pytest

from bill_test_helpers import (
    create_approved,
    make_account,
    make_maker,
    make_user,
    make_vendor,
    pay,
    payment_type_id,
)

BASE = "/api/finance/bills"


def _make_cash_account(client, cookies, name, number, balance=5000.0, currency="USD"):
    resp = client.post(
        "/api/finance/accounts",
        json={
            "account_name": name,
            "account_number": number,
            "currency": currency,
            "opening_balance": balance,
            "account_type": "cash",
        },
        cookies=cookies,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _balance(client, cookies, account_id):
    return client.get(f"/api/finance/accounts/{account_id}", cookies=cookies).json()["current_balance"]


# ── AC: USD bill from an EGP account fails with currency_mismatch, nothing changed
def test_currency_mismatch_refused_and_nothing_changes(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Currency Vendor")
    egp = make_account(app_client, admin_cookies, "EGP Bank", number="11110001", balance=50000.0, currency="EGP")
    bill = create_approved(app_client, admin_cookies, vid, "CUR-001", 1000.0, currency="USD")

    resp = pay(app_client, admin_cookies, bill["id"], egp, 1000.0)
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "currency_mismatch"
    assert _balance(app_client, admin_cookies, egp) == 50000.0
    after = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert after["status"] == "approved" and after["amount_paid"] == 0.0
    assert app_client.get(f"{BASE}/{bill['id']}/payments", cookies=admin_cookies).json() == []


# ── AC: payment above the account balance fails with insufficient_balance
def test_insufficient_balance_refused_for_bank_and_cash_accounts(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Balance Vendor")
    bank = make_account(app_client, admin_cookies, "Thin Bank", number="11110002", balance=300.0)
    cash = _make_cash_account(app_client, admin_cookies, "Thin Cash", "11110003", balance=200.0)
    bill = create_approved(app_client, admin_cookies, vid, "BAL-001", 1000.0, currency="USD")

    r1 = pay(app_client, admin_cookies, bill["id"], bank, 500.0)
    assert r1.status_code == 400 and r1.json()["detail"]["code"] == "insufficient_balance"
    r2 = pay(app_client, admin_cookies, bill["id"], cash, 250.0, type_code="CASH")
    assert r2.status_code == 400 and r2.json()["detail"]["code"] == "insufficient_balance"
    assert _balance(app_client, admin_cookies, bank) == 300.0
    assert _balance(app_client, admin_cookies, cash) == 200.0
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["amount_paid"] == 0.0

    # exactly the balance is allowed (no overdraft, but no false refusal)
    ok = pay(app_client, admin_cookies, bill["id"], bank, 300.0)
    assert ok.status_code == 201 and _balance(app_client, admin_cookies, bank) == 0.0


# ── AC: Cash payment from a bank account, or Outgoing transfer from a cash account, fails
@pytest.mark.parametrize(
    "account_kind,type_code",
    [
        ("bank", "CASH"),
        ("cash", "OUTBOUND_TRANS"),
        ("bank", "INBOUND_TRANS"),
        ("bank", "INTTRANS"),
        ("bank", "USDTOEGP"),
        ("bank", "CASHWITHDRAW"),
        ("bank", "BANK_FEES"),
        ("cash", "CHK"),
    ],
)
def test_payment_type_not_allowed_for_account_type(app_client, admin_cookies, account_kind, type_code):
    vid = make_vendor(app_client, admin_cookies, f"Type Vendor {account_kind}{type_code}")
    num = f"2{sum(ord(c) for c in account_kind + type_code):07d}"
    if account_kind == "bank":
        acct = make_account(app_client, admin_cookies, f"T-{account_kind}-{type_code}", number=num, balance=9000.0)
    else:
        acct = _make_cash_account(app_client, admin_cookies, f"T-{account_kind}-{type_code}", num, balance=9000.0)
    bill = create_approved(app_client, admin_cookies, vid, f"TYP-{account_kind}-{type_code}", 100.0, currency="USD")
    resp = pay(app_client, admin_cookies, bill["id"], acct, 100.0, type_code=type_code, cheque_number="C-1")
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "payment_type_not_allowed"
    assert _balance(app_client, admin_cookies, acct) == 9000.0


def test_allowed_types_per_account_type_and_listing_endpoint(app_client, admin_cookies):
    maker = make_maker()
    bank_types = app_client.get(
        "/api/finance/payment-types", params={"usage": "bill_payment", "account_type": "bank"}, cookies=maker
    )
    assert bank_types.status_code == 200
    assert {t["code"] for t in bank_types.json()} == {"OUTBOUND_TRANS", "CHK", "DEBIT_CARD"}
    cash_types = app_client.get(
        "/api/finance/payment-types", params={"usage": "bill_payment", "account_type": "cash"}, cookies=admin_cookies
    )
    assert {t["code"] for t in cash_types.json()} == {"CASH"}
    # a bill user without finance.account.read cannot list every payment type
    bill_only = make_user("bill-only@hrflow.test", ["finance.bill.read", "finance.bill.write"])
    assert app_client.get("/api/finance/payment-types", cookies=bill_only).status_code == 403
    assert app_client.get("/api/finance/payment-types", params={"usage": "bill_payment"}, cookies=bill_only).status_code == 200


def test_cheque_payment_needs_cheque_number_and_other_types_do_not(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Cheque No Vendor")
    acct = make_account(app_client, admin_cookies, "Cheque No Bank", number="11110004", balance=9000.0)
    bill = create_approved(app_client, admin_cookies, vid, "CHQN-001", 400.0, currency="USD")
    missing = pay(app_client, admin_cookies, bill["id"], acct, 100.0, type_code="CHK")
    assert missing.status_code == 400 and missing.json()["detail"]["code"] == "cheque_number_required"
    ok = pay(app_client, admin_cookies, bill["id"], acct, 100.0, type_code="CHK", cheque_number="445566")
    assert ok.status_code == 201
    card = pay(app_client, admin_cookies, bill["id"], acct, 100.0, type_code="DEBIT_CARD")
    assert card.status_code == 201


# ── AC: over-payment beyond the remaining balance stays refused
def test_overpayment_still_refused(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Overpay Vendor")
    acct = make_account(app_client, admin_cookies, "Overpay Bank", number="11110005", balance=9000.0)
    bill = create_approved(app_client, admin_cookies, vid, "OVR-001", 100.0, currency="USD")
    resp = pay(app_client, admin_cookies, bill["id"], acct, 150.0)
    assert resp.status_code == 400 and "exceeds remaining" in resp.json()["detail"].lower()


# ── AC: ledger row carries the entered type, reference, details, cheque number, vendor payee and creator
def test_ledger_row_carries_entered_fields(app_client, admin_cookies):
    from db import get_db_context
    from finance.models import LedgerTransactionDB, PaymentTypeDB

    vid = make_vendor(app_client, admin_cookies, "Ledger Fields Vendor")
    acct = make_account(app_client, admin_cookies, "Ledger Fields Bank", number="11110006", balance=9000.0)
    bill = create_approved(app_client, admin_cookies, vid, "LED-001", 600.0, currency="USD")

    resp = pay(
        app_client, admin_cookies, bill["id"], acct, 250.0, type_code="CHK", reference="REF-77",
        cheque_number="991122", details="September hosting", date="2026-09-10",
    )
    assert resp.status_code == 201, resp.text
    # reference is optional and may be empty; details default to the vendor name
    resp2 = pay(app_client, admin_cookies, bill["id"], acct, 50.0, type_code="DEBIT_CARD", reference="", date="2026-09-11")
    assert resp2.status_code == 201

    with get_db_context() as db:
        rows = (
            db.query(LedgerTransactionDB)
            .filter(LedgerTransactionDB.linked_bill_id == bill["id"], LedgerTransactionDB.source == "bill_payment")
            .order_by(LedgerTransactionDB.id)
            .all()
        )
        assert len(rows) == 2
        first, second = rows
        chk = db.query(PaymentTypeDB).filter(PaymentTypeDB.code == "CHK").one()
        card = db.query(PaymentTypeDB).filter(PaymentTypeDB.code == "DEBIT_CARD").one()
        assert first.payment_type_id == chk.id
        assert first.reference == "REF-77"
        assert first.description == "September hosting"
        assert first.cheque_number == "991122"
        assert first.payee_type == "vendor" and first.payee_id == vid and first.payee_name == "Ledger Fields Vendor"
        assert first.created_by == "admin@hrflow.test"
        assert first.direction == "out" and first.amount == 250.0 and first.currency == "USD"
        assert second.payment_type_id == card.id
        assert second.reference == ""
        assert second.description == "Ledger Fields Vendor"
        assert second.cheque_number is None
    assert _balance(app_client, admin_cookies, acct) == 8700.0


def test_backdated_payment_keeps_running_balances_correct(app_client, admin_cookies):
    from db import get_db_context
    from finance.models import LedgerTransactionDB

    vid = make_vendor(app_client, admin_cookies, "Backdate Vendor")
    acct = make_account(app_client, admin_cookies, "Backdate Bank", number="11110007", balance=1000.0)
    bill = create_approved(app_client, admin_cookies, vid, "BKD-001", 500.0, currency="USD")
    assert pay(app_client, admin_cookies, bill["id"], acct, 200.0, date="2026-09-20").status_code == 201
    assert pay(app_client, admin_cookies, bill["id"], acct, 100.0, date="2026-09-05").status_code == 201
    assert _balance(app_client, admin_cookies, acct) == 700.0

    with get_db_context() as db:
        rows = (
            db.query(LedgerTransactionDB)
            .filter(LedgerTransactionDB.account_id == acct)
            .order_by(LedgerTransactionDB.date, LedgerTransactionDB.id)
            .all()
        )
        assert [r.running_balance for r in rows] == [900.0, 700.0]


# ── AC: a failed "Already paid" save leaves no bill behind; a good one is one transaction
def test_already_paid_is_atomic(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Atomic Vendor")
    egp = make_account(app_client, admin_cookies, "Atomic EGP Bank", number="11110008", balance=9000.0, currency="EGP")
    usd = make_account(app_client, admin_cookies, "Atomic USD Bank", number="11110009", balance=9000.0)

    payload = {
        "vendor_id": vid,
        "bill_number": "ATOM-001",
        "issue_date": "2026-09-01",
        "due_date": "2026-09-30",
        "currency": "USD",
        "lines": [{"description": "Thing", "quantity": 1, "unit_price": 300.0, "line_total": 300.0}],
        "is_paid_now": True,
        "payment": {
            "bank_account_id": egp,
            "payment_type_id": payment_type_id("OUTBOUND_TRANS"),
            "payment_date": "2026-09-02",
            "amount": 300.0,
        },
    }
    bad = app_client.post(BASE, json=payload, cookies=admin_cookies)
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "currency_mismatch"
    assert app_client.get(BASE, params={"search": "ATOM-001"}, cookies=admin_cookies).json() == []
    assert _balance(app_client, admin_cookies, egp) == 9000.0

    good = app_client.post(
        BASE,
        json={**payload, "payment": {**payload["payment"], "bank_account_id": usd, "reference": "WIRE-1"}},
        cookies=admin_cookies,
    )
    assert good.status_code == 201, good.text
    body = good.json()
    assert body["status"] == "paid" and body["amount_paid"] == 300.0
    assert _balance(app_client, admin_cookies, usd) == 8700.0
    assert len(app_client.get(f"{BASE}/{body['id']}/payments", cookies=admin_cookies).json()) == 1

    # insufficient balance rolls everything back too
    poor = make_account(app_client, admin_cookies, "Atomic Poor Bank", number="11110010", balance=10.0)
    bad2 = app_client.post(
        BASE,
        json={
            **payload,
            "bill_number": "ATOM-002",
            "lines": [{"description": "Other thing", "quantity": 1, "unit_price": 310.0, "line_total": 310.0}],
            "payment": {**payload["payment"], "bank_account_id": poor, "amount": 310.0},
        },
        cookies=admin_cookies,
    )
    assert bad2.status_code == 400 and bad2.json()["detail"]["code"] == "insufficient_balance"
    assert app_client.get(BASE, params={"search": "ATOM-002"}, cookies=admin_cookies).json() == []


def test_new_bills_default_to_egp(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Default Currency Vendor")
    resp = app_client.post(
        BASE,
        json={"vendor_id": vid, "bill_number": "EGP-DEFAULT", "issue_date": "2026-09-01", "due_date": "2026-09-30", "lines": []},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201 and resp.json()["currency"] == "EGP"


# ── AC: a cheque or manual transaction linked to a bill creates a payment record and obeys the same rules
def test_linked_manual_transaction_creates_payment_and_obeys_rules(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Linked Tx Vendor")
    usd = make_account(app_client, admin_cookies, "Linked Tx USD", number="11110011", balance=1000.0)
    egp = make_account(app_client, admin_cookies, "Linked Tx EGP", number="11110012", balance=1000.0, currency="EGP")
    poor = make_account(app_client, admin_cookies, "Linked Tx Poor", number="11110013", balance=20.0)
    bill = create_approved(app_client, admin_cookies, vid, "LTX-001", 400.0, currency="USD")

    def tx(account, amount, currency="USD", **extra):
        return app_client.post(
            f"/api/finance/accounts/{account}/transactions",
            json={
                "date": "2026-09-05", "amount": amount, "direction": "out", "currency": currency,
                "reference": "TX", "description": "pay", "linked_bill_id": bill["id"], **extra,
            },
            cookies=admin_cookies,
        )

    assert tx(egp, 100.0, currency="EGP").json()["detail"]["code"] == "currency_mismatch"
    assert tx(poor, 100.0).json()["detail"]["code"] == "insufficient_balance"
    assert tx(usd, 100.0, payment_type_id=payment_type_id("INBOUND_TRANS")).json()["detail"]["code"] == "payment_type_not_allowed"
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["amount_paid"] == 0.0

    ok = tx(usd, 150.0)
    assert ok.status_code in (200, 201), ok.text
    after = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert after["amount_paid"] == 150.0 and after["status"] == "partially_paid"
    assert len(app_client.get(f"{BASE}/{bill['id']}/payments", cookies=admin_cookies).json()) == 1
    assert _balance(app_client, admin_cookies, usd) == 850.0


def test_linked_cheque_creates_payment_obeys_rules_and_reverses(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Linked Cheque Vendor")
    usd = make_account(app_client, admin_cookies, "Linked Chq USD", number="11110014", balance=1000.0)
    egp = make_account(app_client, admin_cookies, "Linked Chq EGP", number="11110015", balance=1000.0, currency="EGP")
    poor = make_account(app_client, admin_cookies, "Linked Chq Poor", number="11110016", balance=10.0)
    bill = create_approved(app_client, admin_cookies, vid, "LCQ-001", 300.0, currency="USD")

    def cheque(account, number, amount, currency="USD"):
        return app_client.post(
            "/api/finance/cheques",
            json={
                "account_id": account, "cheque_number": number, "issue_date": "2026-09-05", "amount": amount,
                "currency": currency, "payee": "Linked Cheque Vendor", "purpose_type": "vendor_payment",
                "linked_bill_id": bill["id"],
            },
            cookies=admin_cookies,
        )

    r1 = cheque(egp, "880001", 100.0, "EGP")
    assert r1.status_code == 400 and r1.json()["detail"]["code"] == "currency_mismatch"
    r2 = cheque(poor, "880002", 100.0)
    assert r2.status_code == 400 and r2.json()["detail"]["code"] == "insufficient_balance"
    assert app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()["amount_paid"] == 0.0

    ok = cheque(usd, "880003", 120.0)
    assert ok.status_code == 201, ok.text
    cid = ok.json()["id"]
    bill_now = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert bill_now["amount_paid"] == 120.0 and bill_now["status"] == "partially_paid"
    payments = app_client.get(f"{BASE}/{bill['id']}/payments", cookies=admin_cookies).json()
    assert len(payments) == 1 and payments[0]["method"] == "cheque" and payments[0]["amount"] == 120.0

    # stopping the cheque reverses the payment it made
    stop = app_client.patch(
        f"/api/finance/cheques/{cid}/status", json={"status": "stopped", "reason": "Lost in transit"}, cookies=admin_cookies
    )
    assert stop.status_code == 200, stop.text
    reverted = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert reverted["amount_paid"] == 0.0 and reverted["status"] == "approved"
    assert _balance(app_client, admin_cookies, usd) == 1000.0
