"""
be/tests/test_finance_closed_period_guard.py
The closed-reconciliation-month lock on every ledger row (audit 2026-11, finding H-3; finance/period_lock.py).
Posting paths that never called assert_period_open (invoice receipts, transfers, bill payments, payroll, ...) are
refused at flush time; changes that do not move money still work in a closed month.
"""
import io
from datetime import datetime

import pytest

from finance.models import LedgerTransactionDB
from finance.period_lock import PeriodClosedError


def _account(client, cookies, name):
    res = client.post(
        "/api/finance/accounts",
        json={"account_name": name, "bank_name": "HSBC Egypt", "account_number": f"{name}-{datetime.utcnow().timestamp()}",
              "currency": "USD", "opening_balance": 10000.0, "account_type": "bank"},
        cookies=cookies,
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _close_month(client, cookies, account_id, month):
    csv_content = "Date,Description,Debit,Credit,Ref\n"
    stmt = client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data={"period_month": month, "opening_balance": 10000.0, "closing_balance": 9500.0},
        files={"file": ("s.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")},
        cookies=cookies,
    )
    assert stmt.status_code == 201, stmt.text
    stmt_id = stmt.json()["id"]
    for line in client.get(f"/api/finance/statements/{stmt_id}/lines", cookies=cookies).json():
        client.post(f"/api/finance/statements/{stmt_id}/lines/{line['id']}/resolve",
                    json={"action": "ignore", "notes": "Handled"}, cookies=cookies)
    closed = client.post(f"/api/finance/statements/{stmt_id}/close",
                         json={"is_exception_override": True, "exception_override_reason": "Test close"}, cookies=cookies)
    assert closed.status_code == 200, closed.text
    return stmt_id


@pytest.fixture
def env(app_client, admin_cookies):
    """Bank A with a manual row in August 2026 and August closed; bank B open."""
    bank_a = _account(app_client, admin_cookies, "GuardA")
    bank_b = _account(app_client, admin_cookies, "GuardB")
    tx = app_client.post(
        f"/api/finance/accounts/{bank_a}/transactions",
        json={"date": "2026-08-10", "amount": 500.0, "direction": "out", "currency": "USD", "description": "August row"},
        cookies=admin_cookies,
    )
    assert tx.status_code == 201, tx.text
    stmt_id = _close_month(app_client, admin_cookies, bank_a, "2026-08")
    return {"bank_a": bank_a, "bank_b": bank_b, "aug_tx": tx.json()["id"], "stmt_id": stmt_id}


def _count(account_id):
    from db import get_db_context
    with get_db_context() as db:
        return db.query(LedgerTransactionDB).filter(LedgerTransactionDB.account_id == account_id).count()


# ---- Flush-time guard, whatever code writes the row ----

def test_inserting_a_row_in_a_closed_month_is_refused(app_client, env):
    from db import get_db_context
    with get_db_context() as db:
        db.add(LedgerTransactionDB(account_id=env["bank_a"], date="2026-08-20", amount=10.0, direction="out",
                                   currency="USD", source="manual"))
        with pytest.raises(PeriodClosedError, match="closed reconciliation period '2026-08'"):
            db.flush()
        db.rollback()
    assert _count(env["bank_a"]) == 1


def test_the_same_row_in_an_open_month_or_another_account_is_accepted(app_client, env):
    from db import get_db_context
    with get_db_context() as db:
        db.add(LedgerTransactionDB(account_id=env["bank_a"], date="2026-09-01", amount=10.0, direction="out",
                                   currency="USD", source="manual"))
        db.add(LedgerTransactionDB(account_id=env["bank_b"], date="2026-08-20", amount=10.0, direction="out",
                                   currency="USD", source="manual"))
        db.commit()
    assert _count(env["bank_a"]) == 2 and _count(env["bank_b"]) == 1


def test_deleting_or_moving_money_on_a_closed_row_is_refused(app_client, env):
    from db import get_db_context
    with get_db_context() as db:
        tx = db.get(LedgerTransactionDB, env["aug_tx"])
        db.delete(tx)
        with pytest.raises(PeriodClosedError):
            db.flush()
        db.rollback()

        tx = db.get(LedgerTransactionDB, env["aug_tx"])
        tx.date = "2026-09-15"  # moving it out of the closed month also changes that month
        with pytest.raises(PeriodClosedError):
            db.flush()
        db.rollback()

        tx = db.get(LedgerTransactionDB, env["aug_tx"])
        tx.amount = 1.0
        with pytest.raises(PeriodClosedError):
            db.flush()
        db.rollback()

        tx = db.get(LedgerTransactionDB, env["aug_tx"])
        assert (tx.date, float(tx.amount)) == ("2026-08-10", 500.0)


def test_changes_that_move_no_money_still_work_in_a_closed_month(app_client, env):
    from db import get_db_context
    with get_db_context() as db:
        tx = db.get(LedgerTransactionDB, env["aug_tx"])
        tx.running_balance = 12345.0  # the balance recalculation rewrites this on every row
        tx.description = "August row, relabelled"
        db.commit()
    with get_db_context() as db:
        assert db.get(LedgerTransactionDB, env["aug_tx"]).description == "August row, relabelled"


# ---- Posting paths that used to skip the lock ----

def test_a_transfer_into_a_closed_month_is_refused(app_client, admin_cookies, env):
    res = app_client.post(
        "/api/finance/transfers",
        json={"from_account_id": env["bank_b"], "to_account_id": env["bank_a"], "date": "2026-08-25",
              "from_amount": 100.0, "from_currency": "USD", "to_amount": 100.0, "to_currency": "USD",
              "transfer_type": "internal", "note": "into a closed month"},
        cookies=admin_cookies,
    )
    assert res.status_code == 400, res.text
    assert "closed reconciliation period" in res.json()["detail"]
    assert _count(env["bank_a"]) == 1 and _count(env["bank_b"]) == 0


def test_an_invoice_receipt_into_a_closed_month_is_refused(app_client, admin_cookies, env):
    cust = app_client.post("/api/finance/customers", json={"name": f"Guard Customer {datetime.utcnow().timestamp()}"},
                           cookies=admin_cookies)
    assert cust.status_code == 201, cust.text
    inv = app_client.post(
        "/api/finance/invoices",
        json={"customer_id": cust.json()["id"], "invoice_number": f"INV-GUARD-{cust.json()['id']}",
              "issue_date": "2026-08-01", "due_date": "2026-08-30", "currency": "USD",
              "expected_bank_account_id": env["bank_a"],
              "lines": [{"description": "Service", "quantity": 1, "unit_price": 1000.0}]},
        cookies=admin_cookies,
    )
    assert inv.status_code == 201, inv.text
    inv_id = inv.json()["id"]
    assert app_client.post(f"/api/finance/invoices/{inv_id}/send", cookies=admin_cookies).status_code == 200

    pay = app_client.post(
        f"/api/finance/invoices/{inv_id}/payments",
        json={"direction": "incoming", "amount": 1000.0, "currency": "USD", "payment_date": "2026-08-20",
              "bank_account_id": env["bank_a"], "method": "bank_transfer", "reference": "LATE-WIRE"},
        cookies=admin_cookies,
    )
    assert pay.status_code == 400, pay.text
    assert "closed reconciliation period" in pay.json()["detail"]
    assert _count(env["bank_a"]) == 1
    assert app_client.get(f"/api/finance/invoices/{inv_id}", cookies=admin_cookies).json()["status"] == "sent"


def test_reopening_the_month_lets_the_transfer_through(app_client, admin_cookies, env):
    reopened = app_client.post(f"/api/finance/statements/{env['stmt_id']}/reopen",
                               json={"reopen_reason": "Late transfer"}, cookies=admin_cookies)
    assert reopened.status_code == 200, reopened.text
    res = app_client.post(
        "/api/finance/transfers",
        json={"from_account_id": env["bank_b"], "to_account_id": env["bank_a"], "date": "2026-08-25",
              "from_amount": 100.0, "from_currency": "USD", "to_amount": 100.0, "to_currency": "USD",
              "transfer_type": "internal", "note": "after reopen"},
        cookies=admin_cookies,
    )
    assert res.status_code == 201, res.text
