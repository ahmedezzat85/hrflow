"""
be/tests/test_idempotent_money_routes.py
Money-moving routes honour Idempotency-Key (audit 2026-11, finding M-4): the same key sent twice posts once and returns
the first result; a different key is a new request.
"""
import uuid
from datetime import datetime

from finance.models import LedgerTransactionDB

# Every finance route that creates, reverses or settles money. Each must accept an Idempotency-Key.
MONEY_ROUTES = {
    ("POST", "/api/finance/bills"),
    ("POST", "/api/finance/bills/{bill_id}/payments"),
    ("POST", "/api/finance/bills/{bill_id}/payments/{payment_id}/reverse"),
    ("POST", "/api/finance/invoices/{invoice_id}/payments"),
    ("POST", "/api/finance/invoices/{invoice_id}/payments/{payment_id}/reverse"),
    ("POST", "/api/finance/transfers"),
    ("POST", "/api/finance/transfers/{transfer_id}/void"),
    ("POST", "/api/finance/accounts/{account_id}/transactions"),
    ("POST", "/api/finance/cheques"),
    ("POST", "/api/finance/revenue-receipts"),
    ("POST", "/api/finance/revenue-receipts/{receipt_id}/reverse"),
    ("POST", "/api/finance/subscriptions/charges/{charge_id}/settle"),
    ("POST", "/api/finance/statutory-obligations/{obligation_id}/settle"),
    ("POST", "/api/finance/payroll/runs/{run_id}/pay"),
    ("POST", "/api/finance/commissions/settlements"),
    ("POST", "/api/finance/commissions/settlements/{settlement_id}/undo"),
}


def _uses_idempotency(dependant) -> bool:
    for d in dependant.dependencies:
        if getattr(d.call, "__name__", "") == "get_idempotency_key" or _uses_idempotency(d):
            return True
    return False


def test_every_money_route_accepts_an_idempotency_key(app_client):
    import main
    from fastapi.routing import APIRoute
    routes = {(m, r.path): r for r in main.app.routes if isinstance(r, APIRoute) for m in r.methods}
    missing = [k for k in MONEY_ROUTES if k not in routes]
    assert not missing, f"routes not found (renamed?): {missing}"
    without = [k for k in MONEY_ROUTES if not _uses_idempotency(routes[k].dependant)]
    assert not without, f"money-moving routes without Idempotency-Key support: {without}"


def _account(client, cookies):
    res = client.post(
        "/api/finance/accounts",
        json={"account_name": f"Idem {datetime.utcnow().timestamp()}", "bank_name": "HSBC Egypt",
              "account_number": f"IDEM-{datetime.utcnow().timestamp()}", "currency": "USD",
              "opening_balance": 1000.0, "account_type": "bank"},
        cookies=cookies,
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _rows(account_id):
    from db import get_db_context
    with get_db_context() as db:
        return db.query(LedgerTransactionDB).filter(LedgerTransactionDB.account_id == account_id).count()


def test_a_repeated_manual_transaction_posts_once(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies)
    body = {"date": "2026-10-05", "amount": 42.0, "direction": "out", "currency": "USD", "description": "Courier"}
    key = {"Idempotency-Key": str(uuid.uuid4())}
    first = app_client.post(f"/api/finance/accounts/{acc}/transactions", json=body, headers=key, cookies=admin_cookies)
    again = app_client.post(f"/api/finance/accounts/{acc}/transactions", json=body, headers=key, cookies=admin_cookies)
    assert first.status_code == 201 and again.status_code in (200, 201)
    assert again.json()["id"] == first.json()["id"]
    assert _rows(acc) == 1

    other = app_client.post(f"/api/finance/accounts/{acc}/transactions", json=body,
                            headers={"Idempotency-Key": str(uuid.uuid4())}, cookies=admin_cookies)
    assert other.status_code == 201 and other.json()["id"] != first.json()["id"]
    assert _rows(acc) == 2


def test_a_repeated_revenue_receipt_posts_once(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies)
    src = app_client.post("/api/finance/revenue-sources", json={"name": "Idem Consulting", "code": f"IDEM-{uuid.uuid4().hex[:8]}"},
                          cookies=admin_cookies)
    assert src.status_code in (200, 201), src.text
    body = {"account_id": acc, "date": "2026-10-06", "amount": 300.0, "currency": "USD",
            "revenue_source_id": src.json()["id"]}
    key = {"Idempotency-Key": str(uuid.uuid4())}
    first = app_client.post("/api/finance/revenue-receipts", json=body, headers=key, cookies=admin_cookies)
    assert first.status_code == 201, first.text
    again = app_client.post("/api/finance/revenue-receipts", json=body, headers=key, cookies=admin_cookies)
    assert again.json()["id"] == first.json()["id"]
    assert _rows(acc) == 1


def test_a_repeated_transfer_void_returns_the_first_result_instead_of_an_error(app_client, admin_cookies):
    a, b = _account(app_client, admin_cookies), _account(app_client, admin_cookies)
    trf = app_client.post(
        "/api/finance/transfers",
        json={"from_account_id": a, "to_account_id": b, "date": "2026-10-07", "from_amount": 50.0, "from_currency": "USD",
              "to_amount": 50.0, "to_currency": "USD", "transfer_type": "internal", "note": "idem"},
        cookies=admin_cookies,
    ).json()
    key = {"Idempotency-Key": str(uuid.uuid4())}
    first = app_client.post(f"/api/finance/transfers/{trf['id']}/void", json={"reason": "Entered twice"}, headers=key,
                            cookies=admin_cookies)
    again = app_client.post(f"/api/finance/transfers/{trf['id']}/void", json={"reason": "Entered twice"}, headers=key,
                            cookies=admin_cookies)
    assert first.status_code == 200 and again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
