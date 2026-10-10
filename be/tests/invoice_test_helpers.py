"""
be/tests/invoice_test_helpers.py
Shared helpers for sales-invoice tests (D-022): invoices are created as drafts and move
through actions only, so tests build "sent" invoices with create + /send.
"""
import itertools

BASE = "/api/finance/invoices"
_seq = itertools.count(1)


def make_customer(client, cookies, name=None):
    resp = client.post("/api/finance/customers", json={"name": name or f"Cust {next(_seq)}"}, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def make_account(client, cookies, currency="USD", balance=100000.0, account_type="bank", name=None):
    n = next(_seq)
    resp = client.post(
        "/api/finance/accounts",
        json={
            "account_name": name or f"Inv Acc {n}",
            "bank_name": "Test Bank",
            "account_number": f"55{n:06d}",
            "currency": currency,
            "opening_balance": balance,
            "account_type": account_type,
        },
        cookies=cookies,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def account_balance(client, cookies, account_id):
    resp = client.get(f"/api/finance/accounts/{account_id}", cookies=cookies)
    assert resp.status_code == 200, resp.text
    return resp.json()["current_balance"]


def create_invoice(client, cookies, customer_id, number=None, amount=2000.0, currency="USD",
                   issue_date="2026-09-01", due_date="2026-09-30", send=False, **extra):
    payload = {
        "customer_id": customer_id,
        "invoice_number": number or f"INV-T-{next(_seq):05d}",
        "issue_date": issue_date,
        "due_date": due_date,
        "currency": currency,
        "lines": [{"description": "Service", "quantity": 1.0, "unit_price": amount, "line_total": amount}],
    }
    payload.update(extra)
    resp = client.post(BASE, json=payload, cookies=cookies)
    assert resp.status_code == 201, resp.text
    inv = resp.json()
    if send:
        sent = client.post(f"{BASE}/{inv['id']}/send", cookies=cookies)
        assert sent.status_code == 200, sent.text
        inv = sent.json()
    return inv


def receipt(client, cookies, invoice_id, account_id, amount, currency="USD", reference="", date="2026-09-15", **extra):
    payload = {
        "direction": "incoming",
        "amount": amount,
        "currency": currency,
        "payment_date": date,
        "bank_account_id": account_id,
        "method": "bank_transfer",
        "reference": reference,
    }
    payload.update(extra)
    return client.post(f"{BASE}/{invoice_id}/payments", json=payload, cookies=cookies)


def get_invoice(client, cookies, invoice_id):
    resp = client.get(f"{BASE}/{invoice_id}", cookies=cookies)
    assert resp.status_code == 200, resp.text
    return resp.json()
