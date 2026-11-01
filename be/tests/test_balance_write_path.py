"""
be/tests/test_balance_write_path.py
Database redesign Stage 2b-4: the stored balance copies (bank-account current_balance, ledger running_balance) have one
writer, LedgerRepository.recalculate_account_running_balances, and finance/balances.py finds any drift.
"""
import os
import re

from sqlalchemy import text

from db import get_db_context
from finance import balances
from finance.repositories.ledger_repository import LedgerRepository

from bill_test_helpers import make_account

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {"tests", "migrations", "scripts", "__pycache__", "uploads", "logs", "node_modules"}
# Files that may assign a stored balance: the single writer, and the model that declares the column.
WRITERS = {os.path.join("finance", "repositories", "ledger_repository.py")}
ASSIGN = re.compile(r"\.(current_balance|running_balance)\s*=(?!=)")


def _python_files():
    for root, dirs, files in os.walk(BE_DIR):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in files:
            if name.endswith(".py"):
                yield os.path.join(root, name)


def test_only_the_ledger_repository_assigns_stored_balances():
    offenders = []
    for path in _python_files():
        rel = os.path.relpath(path, BE_DIR)
        if rel in WRITERS:
            continue
        for number, line in enumerate(open(path, encoding="utf-8", errors="replace"), 1):
            if ASSIGN.search(line) and not line.lstrip().startswith("#"):
                offenders.append(f"{rel}:{number}: {line.strip()}")
    assert not offenders, "Stored balances must only be written by LedgerRepository.recalculate_account_running_balances:\n  " + "\n  ".join(offenders)


def _tx(client, cookies, acc, amount, direction, date):
    resp = client.post(f"/api/finance/accounts/{acc}/transactions",
                       json={"date": date, "amount": amount, "direction": direction, "currency": "USD", "description": "t"},
                       cookies=cookies)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _drift(account_id):
    with get_db_context() as db:
        return balances.find_drift(db, [account_id])


def test_balances_stay_consistent_through_ledger_edits_and_opening_changes(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, "Bal Acc 1", number="BAL-0001", balance=1000.0)
    _tx(app_client, admin_cookies, acc, 100.0, "out", "2026-03-01")
    _tx(app_client, admin_cookies, acc, 250.0, "in", "2026-02-01")  # backdated: later rows shift
    assert _drift(acc) == []
    # Changing the opening balance of an account that already has transactions used to leave both copies stale
    resp = app_client.put(f"/api/finance/accounts/{acc}", json={"opening_balance": 2000.0}, cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    assert _drift(acc) == []
    assert app_client.get(f"/api/finance/accounts/{acc}", cookies=admin_cookies).json()["current_balance"] == 2150.0


def test_year_opening_changes_keep_balances_consistent(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, "Bal Acc 2", number="BAL-0002", balance=500.0)
    _tx(app_client, admin_cookies, acc, 50.0, "out", "2026-04-01")
    assert app_client.put(f"/api/finance/accounts/{acc}/year-openings/2026",
                          json={"opening_balance": 900.0, "note": "audited"}, cookies=admin_cookies).status_code == 200
    assert _drift(acc) == []
    assert app_client.delete(f"/api/finance/accounts/{acc}/year-openings/2026", cookies=admin_cookies).status_code == 200
    assert _drift(acc) == []


def test_find_drift_reports_tampering_and_a_ledger_write_repairs_it(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, "Bal Acc 3", number="BAL-0003", balance=300.0)
    _tx(app_client, admin_cookies, acc, 40.0, "out", "2026-05-01")
    with get_db_context() as db:
        db.execute(text("UPDATE finance_bank_accounts SET current_balance = 1 WHERE id = :i"), {"i": acc})
        db.execute(text("UPDATE finance_ledger_transactions SET running_balance = 7 WHERE account_id = :i"), {"i": acc})
        db.commit()
    drift = _drift(acc)
    assert len(drift) == 1 and drift[0]["account_id"] == acc
    assert drift[0]["current_balance"] == {"stored": 1.0, "computed": 260.0}
    assert drift[0]["running_balance_rows"] == 1
    with get_db_context() as db:
        LedgerRepository(db).recalculate_account_running_balances(acc)
    assert _drift(acc) == []
