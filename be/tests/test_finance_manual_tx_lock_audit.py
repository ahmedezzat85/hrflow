"""
be/tests/test_finance_manual_tx_lock_audit.py
Editing and deleting a manual ledger transaction (audit 2026-11, finding H-2):
- the closed-reconciliation-month lock applies to the row's month and to the month an edit moves it to;
- every successful edit or delete writes an audit row (actor, before/after or the removed row, the reason)
  in the same database transaction; a refused change writes nothing.
"""
import io
import json
from datetime import datetime

import pytest

from models_db import AuditLogDB
from finance.models import LedgerTransactionDB


def _audits(action, tx_id):
    from db import get_db_context
    with get_db_context() as db:
        rows = db.query(AuditLogDB).filter(AuditLogDB.action == action, AuditLogDB.target_id == str(tx_id)).all()
        return [(r.actor_email, r.target_type, json.loads(r.details)) for r in rows]


def _tx(tx_id):
    from db import get_db_context
    with get_db_context() as db:
        tx = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.id == tx_id).first()
        return None if tx is None else {"date": tx.date, "amount": float(tx.amount), "description": tx.description}


def _post_tx(client, cookies, account_id, date, amount, description):
    res = client.post(
        f"/api/finance/accounts/{account_id}/transactions",
        json={"date": date, "amount": amount, "direction": "out", "currency": "USD", "description": description},
        cookies=cookies,
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


@pytest.fixture
def env(app_client, admin_cookies):
    """An account with a manual row in August 2026 (closed) and one in September 2026 (open)."""
    acc = app_client.post(
        "/api/finance/accounts",
        json={"account_name": "Lock Test Bank", "bank_name": "HSBC Egypt",
              "account_number": f"LOCK-{datetime.utcnow().timestamp()}", "currency": "USD",
              "opening_balance": 10000.0, "account_type": "bank"},
        cookies=admin_cookies,
    )
    assert acc.status_code == 201, acc.text
    account_id = acc.json()["id"]

    aug_tx = _post_tx(app_client, admin_cookies, account_id, "2026-08-10", 500.0, "August hosting")
    sep_tx = _post_tx(app_client, admin_cookies, account_id, "2026-09-10", 200.0, "September hosting")

    csv_content = "Date,Description,Debit,Credit,Ref\n2026-08-10,AWS Cloud Hosting,500.00,,TX-0801\n"
    stmt = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data={"period_month": "2026-08", "opening_balance": 10000.0, "closing_balance": 9500.0},
        files={"file": ("aug.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")},
        cookies=admin_cookies,
    )
    assert stmt.status_code == 201, stmt.text
    stmt_id = stmt.json()["id"]
    for line in app_client.get(f"/api/finance/statements/{stmt_id}/lines", cookies=admin_cookies).json():
        app_client.post(f"/api/finance/statements/{stmt_id}/lines/{line['id']}/resolve",
                        json={"action": "ignore", "notes": "Handled"}, cookies=admin_cookies)
    closed = app_client.post(
        f"/api/finance/statements/{stmt_id}/close",
        json={"is_exception_override": True, "exception_override_reason": "Test close"},
        cookies=admin_cookies,
    )
    assert closed.status_code == 200, closed.text
    return {"account_id": account_id, "aug_tx": aug_tx, "sep_tx": sep_tx, "stmt_id": stmt_id}


def test_a_row_in_a_closed_month_cannot_be_edited(app_client, admin_cookies, env):
    res = app_client.patch(f"/api/finance/transactions/{env['aug_tx']}", json={"amount": 999.0}, cookies=admin_cookies)
    assert res.status_code == 400
    assert "closed reconciliation period" in res.json()["detail"]
    assert _tx(env["aug_tx"])["amount"] == 500.0
    assert _audits("finance.transaction.updated", env["aug_tx"]) == []


def test_a_row_cannot_be_moved_into_a_closed_month(app_client, admin_cookies, env):
    res = app_client.patch(f"/api/finance/transactions/{env['sep_tx']}", json={"date": "2026-08-20"}, cookies=admin_cookies)
    assert res.status_code == 400
    assert "closed reconciliation period" in res.json()["detail"]
    assert _tx(env["sep_tx"])["date"] == "2026-09-10"
    assert _audits("finance.transaction.updated", env["sep_tx"]) == []


def test_a_row_in_a_closed_month_cannot_be_deleted(app_client, admin_cookies, env):
    res = app_client.delete(f"/api/finance/transactions/{env['aug_tx']}?reason=oops", cookies=admin_cookies)
    assert res.status_code == 400
    assert "closed reconciliation period" in res.json()["detail"]
    assert _tx(env["aug_tx"]) is not None
    assert _audits("finance.transaction.deleted", env["aug_tx"]) == []


def test_an_edit_in_an_open_month_is_audited_with_actor_and_changes(app_client, admin_cookies, env):
    res = app_client.patch(
        f"/api/finance/transactions/{env['sep_tx']}",
        json={"amount": 250.0, "description": "September hosting, corrected"},
        cookies=admin_cookies,
    )
    assert res.status_code == 200, res.text
    assert res.json()["amount"] == 250.0

    audits = _audits("finance.transaction.updated", env["sep_tx"])
    assert len(audits) == 1
    actor, target_type, details = audits[0]
    assert actor == "admin@hrflow.test"
    assert target_type == "ledger_transaction"
    assert details["changes"]["amount"] == {"from": 200.0, "to": 250.0}
    assert details["changes"]["description"]["to"] == "September hosting, corrected"
    assert "date" not in details["changes"]


def test_a_delete_in_an_open_month_records_the_reason_and_the_removed_row(app_client, admin_cookies, env):
    res = app_client.delete(f"/api/finance/transactions/{env['sep_tx']}?reason=Entered twice", cookies=admin_cookies)
    assert res.status_code == 200, res.text
    assert _tx(env["sep_tx"]) is None

    audits = _audits("finance.transaction.deleted", env["sep_tx"])
    assert len(audits) == 1
    actor, _, details = audits[0]
    assert actor == "admin@hrflow.test"
    assert details["reason"] == "Entered twice"
    assert details["removed"]["amount"] == 200.0
    assert details["removed"]["date"] == "2026-09-10"
    assert details["removed"]["account_id"] == env["account_id"]


def test_reopening_the_month_allows_the_edit_again(app_client, admin_cookies, env):
    reopened = app_client.post(
        f"/api/finance/statements/{env['stmt_id']}/reopen",
        json={"reopen_reason": "Correction needed"},
        cookies=admin_cookies,
    )
    assert reopened.status_code == 200, reopened.text
    res = app_client.patch(f"/api/finance/transactions/{env['aug_tx']}", json={"amount": 450.0}, cookies=admin_cookies)
    assert res.status_code == 200, res.text
    assert len(_audits("finance.transaction.updated", env["aug_tx"])) == 1
