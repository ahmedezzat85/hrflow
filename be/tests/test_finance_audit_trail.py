"""
be/tests/test_finance_audit_trail.py
The automatic audit trail of finance records (audit 2026-11, finding H-4; finance/audit_trail.py).
"""
import json
from datetime import datetime

from models_db import AuditLogDB
from finance.models import CustomerDB


def _rows(action=None, target_type=None, target_id=None):
    from db import get_db_context
    with get_db_context() as db:
        q = db.query(AuditLogDB)
        if action:
            q = q.filter(AuditLogDB.action == action)
        if target_type:
            q = q.filter(AuditLogDB.target_type == target_type)
        if target_id is not None:
            q = q.filter(AuditLogDB.target_id == str(target_id))
        return [(r.action, r.actor_email, json.loads(r.details) if r.details else {}) for r in q.order_by(AuditLogDB.id).all()]


def _account(client, cookies, number="EG-1234567890"):
    res = client.post(
        "/api/finance/accounts",
        json={"account_name": f"Trail Bank {datetime.utcnow().timestamp()}", "bank_name": "HSBC Egypt",
              "account_number": number, "currency": "USD", "opening_balance": 1000.0, "account_type": "bank"},
        cookies=cookies,
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_creating_and_changing_a_customer_is_recorded_with_the_signed_in_user(app_client, admin_cookies):
    res = app_client.post("/api/finance/customers", json={"name": "Trail Clinic", "payment_terms_days": 30},
                          cookies=admin_cookies)
    assert res.status_code == 201, res.text
    cid = res.json()["id"]

    created = _rows("finance.customers.created", "finance_customers", cid)
    assert len(created) == 1
    _, actor, details = created[0]
    assert actor == "admin@hrflow.test"
    assert details["values"]["name"] == "Trail Clinic"

    upd = app_client.put(f"/api/finance/customers/{cid}", json={"name": "Trail Clinic Cairo", "payment_terms_days": 45},
                         cookies=admin_cookies)
    assert upd.status_code == 200, upd.text
    updated = _rows("finance.customers.updated", "finance_customers", cid)
    assert len(updated) == 1
    changes = updated[0][2]["changes"]
    assert changes["name"] == {"from": "Trail Clinic", "to": "Trail Clinic Cairo"}
    assert changes["payment_terms_days"] == {"from": 30, "to": 45}


def test_bank_account_numbers_are_masked(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, number="EG-1234567890")
    _, _, details = _rows("finance.bank_accounts.created", "finance_bank_accounts", acc)[0]
    assert details["values"]["account_number"] == "****7890"


def test_a_transfer_records_the_transfer_and_its_ledger_rows_but_not_balance_recalculation(app_client, admin_cookies):
    a = _account(app_client, admin_cookies, number="A-0001")
    b = _account(app_client, admin_cookies, number="B-0002")
    res = app_client.post(
        "/api/finance/transfers",
        json={"from_account_id": a, "to_account_id": b, "date": "2026-09-06", "from_amount": 250.0,
              "from_currency": "USD", "to_amount": 250.0, "to_currency": "USD", "transfer_type": "internal",
              "note": "trail"},
        cookies=admin_cookies,
    )
    assert res.status_code == 201, res.text
    trf_id = res.json()["id"]

    transfer_rows = _rows("finance.account_transfers.created", target_id=trf_id)
    assert len(transfer_rows) == 1 and transfer_rows[0][1] == "admin@hrflow.test"
    ledger_created = [r for r in _rows("finance.ledger_transactions.created")
                      if r[2]["values"].get("linked_transfer_id") == trf_id]
    assert len(ledger_created) == 2
    # The balances the system recomputes after every posting are not "changes" anyone made
    for _, _, details in _rows("finance.ledger_transactions.updated") + _rows("finance.bank_accounts.updated"):
        assert "running_balance" not in details["changes"]
        assert "current_balance" not in details["changes"]


def test_deleting_a_manual_transaction_records_what_was_removed(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, number="C-0003")
    tx = app_client.post(
        f"/api/finance/accounts/{acc}/transactions",
        json={"date": "2026-09-10", "amount": 75.0, "direction": "out", "currency": "USD", "description": "Courier"},
        cookies=admin_cookies,
    )
    assert tx.status_code == 201, tx.text
    tx_id = tx.json()["id"]
    assert app_client.delete(f"/api/finance/transactions/{tx_id}?reason=duplicate", cookies=admin_cookies).status_code == 200

    removed = _rows("finance.ledger_transactions.deleted", "finance_ledger_transactions", tx_id)
    assert len(removed) == 1
    _, actor, details = removed[0]
    assert actor == "admin@hrflow.test"
    assert details["removed"]["amount"] == 75.0 and details["removed"]["description"] == "Courier"


def test_a_rolled_back_change_leaves_no_audit_row(app_client):
    from db import get_db_context
    with get_db_context() as db:
        db.add(CustomerDB(name="Never Saved Clinic"))
        db.flush()
        db.rollback()
    assert not [r for r in _rows("finance.customers.created") if r[2]["values"].get("name") == "Never Saved Clinic"]


def test_a_write_outside_a_request_has_no_invented_actor(app_client):
    from db import get_db_context
    with get_db_context() as db:
        db.add(CustomerDB(name="Script Clinic"))
        db.commit()
    rows = [r for r in _rows("finance.customers.created") if r[2]["values"].get("name") == "Script Clinic"]
    assert len(rows) == 1 and rows[0][1] == ""
