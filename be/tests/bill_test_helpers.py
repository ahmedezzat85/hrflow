"""
be/tests/bill_test_helpers.py
Shared helpers for vendor-bill tests under the v2 status model (D-016).

Status is server-owned: a bill is created as Draft and reaches Approved only through
submit -> approve. The creator must differ from the approver (segregation of duties),
so helpers stamp a different `created_by` on the bill.
"""

import itertools
from datetime import date, timedelta

CREATOR = "creator@hrflow.test"
_seq = itertools.count()


def _unique_issue_date():
    """Distinct issue dates keep same-vendor / same-amount helper bills from tripping duplicate detection."""
    return (date(2024, 1, 1) + timedelta(days=next(_seq))).strftime("%Y-%m-%d")


def make_vendor(client, cookies, name="Helper Vendor Co"):
    resp = client.post("/api/finance/vendors", json={"name": name, "category": "Operations"}, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def make_account(client, cookies, name="Helper Account", number="99887766", balance=100000.0, currency="USD"):
    resp = client.post(
        "/api/finance/accounts",
        json={
            "account_name": name,
            "bank_name": "Test Bank",
            "account_number": number,
            "currency": currency,
            "opening_balance": balance,
        },
        cookies=cookies,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def create_draft(client, cookies, vendor_id, bill_number, amount=1000.0, **extra):
    payload = {
        "vendor_id": vendor_id,
        "bill_number": bill_number,
        "issue_date": _unique_issue_date(),
        "due_date": "2026-09-30",
        "currency": "USD",
        "created_by": CREATOR,
        "lines": [{"description": "Item", "quantity": 1, "unit_price": amount, "line_total": amount}],
    }
    payload.update(extra)
    resp = client.post("/api/finance/bills", json=payload, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()


def create_approved(client, cookies, vendor_id, bill_number, amount=1000.0, **extra):
    bill = create_draft(client, cookies, vendor_id, bill_number, amount, **extra)
    sub = client.post(f"/api/finance/bills/{bill['id']}/submit", cookies=cookies)
    assert sub.status_code == 200, sub.text
    appr = client.post(
        f"/api/finance/bills/{bill['id']}/approve", json={"decision": "approve"}, cookies=cookies
    )
    assert appr.status_code == 200, appr.text
    assert appr.json()["status"] == "approved"
    return appr.json()


def pay(client, cookies, bill_id, account_id, amount, date="2026-09-15", reference="PAY-REF"):
    return client.post(
        f"/api/finance/bills/{bill_id}/payments",
        json={
            "direction": "outgoing",
            "amount": amount,
            "currency": "USD",
            "payment_date": date,
            "bank_account_id": account_id,
            "method": "bank_transfer",
            "reference": reference,
        },
        cookies=cookies,
    )


def approve_existing(client, cookies, bill_id):
    """Submit and approve a Draft created with created_by=CREATOR (a different user than the approver)."""
    assert client.post(f"/api/finance/bills/{bill_id}/submit", cookies=cookies).status_code == 200
    resp = client.post(f"/api/finance/bills/{bill_id}/approve", json={"decision": "approve"}, cookies=cookies)
    assert resp.status_code == 200, resp.text
    return resp.json()
