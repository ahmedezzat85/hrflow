"""
be/tests/test_activity_timelines_stored_facts.py
Activity timelines show only stored facts (audit 2026-11, finding H-1): no invented people, no invented clock times,
no events that were never recorded. Invoices were fixed in #170; this covers bills, transfers, cheques, ledger
transactions, customers and vendors.
"""
import re
from datetime import datetime

ME = "admin@hrflow.test"
FIXED_TIMES = re.compile(r" (09:00:00|09:30:00|10:00:00|10:05:00|12:00:00|14:00:00|16:00:00)$")


def _account(client, cookies, name):
    res = client.post(
        "/api/finance/accounts",
        json={"account_name": f"{name} {datetime.utcnow().timestamp()}", "bank_name": "HSBC Egypt",
              "account_number": f"{name}-{datetime.utcnow().timestamp()}", "currency": "USD",
              "opening_balance": 10000.0, "account_type": "bank"},
        cookies=cookies,
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _timeline(client, cookies, kind, entity_id):
    res = client.get(f"/api/finance/activity/{kind}/{entity_id}", cookies=cookies)
    assert res.status_code == 200, res.text
    return res.json()


def _assert_only_real_actors(timeline):
    for e in timeline:
        assert e["actor"] in (ME, ""), e
        assert not FIXED_TIMES.search(e["timestamp"] or ""), e


def test_transfer_timeline_has_the_real_creator_and_void(app_client, admin_cookies):
    a = _account(app_client, admin_cookies, "TA")
    b = _account(app_client, admin_cookies, "TB")
    trf = app_client.post(
        "/api/finance/transfers",
        json={"from_account_id": a, "to_account_id": b, "date": "2026-09-06", "from_amount": 100.0, "from_currency": "USD",
              "to_amount": 100.0, "to_currency": "USD", "transfer_type": "internal", "note": "rebalance"},
        cookies=admin_cookies,
    ).json()
    assert app_client.post(f"/api/finance/transfers/{trf['id']}/void", json={"reason": "Entered twice"},
                           cookies=admin_cookies).status_code == 200

    data = _timeline(app_client, admin_cookies, "transfer", trf["id"])
    events = {e["event"]: e for e in data["timeline"]}
    assert events["created"]["actor"] == ME
    assert events["voided"]["actor"] == ME and "Entered twice" in events["voided"]["plain_text"]
    assert "legs_settled" not in events  # never recorded, no longer invented
    assert data["status"] == "voided" and data["summary"]["status"] == "voided"
    _assert_only_real_actors(data["timeline"])


def test_cheque_status_change_shows_who_and_when(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "CQ")
    chq = app_client.post(
        "/api/finance/cheques",
        json={"account_id": acc, "cheque_number": "CHQ-H1-01", "payee": "Office Landlord", "amount": 400.0,
              "currency": "USD", "issue_date": "2026-09-20", "status": "issued", "purpose": "vendor_payment"},
        cookies=admin_cookies,
    )
    assert chq.status_code in (200, 201), chq.text
    cid = chq.json()["id"]
    res = app_client.patch(f"/api/finance/cheques/{cid}/status", json={"status": "stopped", "reason": "Lost in the post"},
                           cookies=admin_cookies)
    assert res.status_code == 200, res.text

    data = _timeline(app_client, admin_cookies, "cheque", cid)
    issued = next(e for e in data["timeline"] if e["event"] == "issued")
    assert issued["actor"] == ME
    change = next(e for e in data["timeline"] if e["state_transition"] and e["state_transition"]["to_state"] == "stopped")
    assert change["actor"] == ME and change["state_transition"]["from_state"] == "issued"
    _assert_only_real_actors(data["timeline"])


def test_transaction_edit_appears_with_the_changed_amount(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "TX")
    tx = app_client.post(
        f"/api/finance/accounts/{acc}/transactions",
        json={"date": "2026-09-10", "amount": 75.0, "direction": "out", "currency": "USD", "description": "Courier"},
        cookies=admin_cookies,
    ).json()
    assert app_client.patch(f"/api/finance/transactions/{tx['id']}", json={"amount": 80.0},
                            cookies=admin_cookies).status_code == 200

    data = _timeline(app_client, admin_cookies, "transaction", tx["id"])
    assert data["timeline"][0]["actor"] == ME
    edit = next(e for e in data["timeline"] if e["event"] == "updated")
    assert edit["actor"] == ME and re.search(r"amount: 75(\.0)? → 80(\.0)?", edit["plain_text"])
    _assert_only_real_actors(data["timeline"])


def test_customer_and_vendor_timelines_name_only_real_people(app_client, admin_cookies):
    bank = _account(app_client, admin_cookies, "CU")
    cust = app_client.post("/api/finance/customers", json={"name": f"H1 Clinic {datetime.utcnow().timestamp()}"},
                           cookies=admin_cookies).json()
    inv = app_client.post(
        "/api/finance/invoices",
        json={"customer_id": cust["id"], "invoice_number": f"INV-H1-{cust['id']}", "issue_date": "2026-09-01",
              "due_date": "2026-09-30", "currency": "USD", "expected_bank_account_id": bank,
              "lines": [{"description": "Service", "quantity": 1, "unit_price": 500.0}]},
        cookies=admin_cookies,
    ).json()
    assert app_client.post(f"/api/finance/invoices/{inv['id']}/send", cookies=admin_cookies).status_code == 200
    pay = app_client.post(
        f"/api/finance/invoices/{inv['id']}/payments",
        json={"direction": "incoming", "amount": 500.0, "currency": "USD", "payment_date": "2026-09-10",
              "bank_account_id": bank, "method": "bank_transfer", "reference": "WIRE-H1"},
        cookies=admin_cookies,
    )
    assert pay.status_code == 201, pay.text

    data = _timeline(app_client, admin_cookies, "customer", cust["id"])
    kinds = {e["event"] for e in data["timeline"]}
    assert {"invoice_issued", "payment_recorded"} <= kinds
    assert all(e["actor"] == ME for e in data["timeline"])
    _assert_only_real_actors(data["timeline"])

    vendor = app_client.post("/api/finance/vendors", json={"name": f"H1 Vendor {datetime.utcnow().timestamp()}"},
                             cookies=admin_cookies)
    assert vendor.status_code == 201, vendor.text
    from bill_test_helpers import create_draft
    create_draft(app_client, admin_cookies, vendor.json()["id"], "H1-BILL-1", 90.0)
    vdata = _timeline(app_client, admin_cookies, "vendor", vendor.json()["id"])
    assert vdata["timeline"] and vdata["timeline"][0]["actor"] == ME
    _assert_only_real_actors(vdata["timeline"])


def test_a_record_with_no_stored_author_shows_no_author(app_client, admin_cookies):
    """Rows imported or entered before the author was stored show an empty actor and the date only."""
    acc = _account(app_client, admin_cookies, "LG")
    from db import get_db_context
    from finance.models import LedgerTransactionDB
    with get_db_context() as db:
        tx = LedgerTransactionDB(account_id=acc, date="2025-01-15", amount=12.0, direction="out", currency="USD",
                                 source="import", created_at=None, created_by=None)
        db.add(tx)
        db.commit()
        tx.created_at = None  # the column default filled it in; legacy rows have none
        db.commit()
        tx_id = tx.id
    data = _timeline(app_client, admin_cookies, "transaction", tx_id)
    first = data["timeline"][0]
    assert first["actor"] == "" and first["timestamp"] == "2025-01-15"
