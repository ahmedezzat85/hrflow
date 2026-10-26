"""
be/tests/test_year_openings_legacy.py
BI-1 (D-043) golden tests: accounts with NO entered yearly openings keep today's balance behaviour bit for bit
(running balances, current_balance, compute_balance, point-in-time balances, yearly summary). Written before the
recalculation was changed; they must stay green unchanged.
"""
import uuid
import pytest

from db import get_session_factory
from finance.models import FinanceBankAccountDB, LedgerTransactionDB
from finance.repositories.accounts_repository import AccountsRepository
from finance.repositories.ledger_repository import LedgerRepository


@pytest.fixture
def db_session(app_client):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def make_account(db, opening=1000.0, opening_date="2023-01-01", currency="USD"):
    acc = FinanceBankAccountDB(account_name=f"Legacy {uuid.uuid4().hex[:6]}", bank_name="Test Bank",
                               account_number=f"LG-{uuid.uuid4().hex[:8]}", currency=currency,
                               opening_balance=opening, opening_balance_date=opening_date,
                               current_balance=opening, is_active=True)
    db.add(acc)
    db.flush()
    return acc


def add_tx(db, acc, date, amount, direction):
    tx = LedgerTransactionDB(account_id=acc.id, date=date, amount=amount, direction=direction,
                             currency=acc.currency, source="manual", entry_type="standard")
    db.add(tx)
    db.flush()
    return tx


@pytest.fixture
def legacy(db_session):
    acc = make_account(db_session, opening=1000.0)
    txs = [
        add_tx(db_session, acc, "2023-03-01", 200.0, "in"),
        add_tx(db_session, acc, "2023-12-31", 50.5, "out"),
        add_tx(db_session, acc, "2024-01-01", 300.0, "out"),
        add_tx(db_session, acc, "2024-06-15", 125.25, "in"),
        add_tx(db_session, acc, "2025-02-02", 80.0, "out"),
    ]
    db_session.commit()
    return acc, txs


def test_running_balances_and_current_balance_are_one_chain_from_the_account_opening(db_session, legacy):
    acc, txs = legacy
    LedgerRepository(db_session).recalculate_account_running_balances(acc.id)
    db_session.expire_all()
    assert [t.running_balance for t in txs] == [1200.0, 1149.5, 849.5, 974.75, 894.75]
    assert db_session.get(FinanceBankAccountDB, acc.id).current_balance == 894.75


def test_account_without_transactions_keeps_its_opening(db_session):
    acc = make_account(db_session, opening=321.5)
    db_session.commit()
    assert LedgerRepository(db_session).recalculate_account_running_balances(acc.id) == 321.5
    assert AccountsRepository(db_session).compute_balance(acc.id) == 321.5


def test_compute_balance_as_of_is_inclusive_and_chained(db_session, legacy):
    acc, _ = legacy
    repo = AccountsRepository(db_session)
    assert repo.compute_balance(acc.id) == 894.75
    assert repo.compute_balance(acc.id, "2022-12-31") == 1000.0
    assert repo.compute_balance(acc.id, "2023-03-01") == 1200.0
    assert repo.compute_balance(acc.id, "2023-12-31") == 1149.5
    assert repo.compute_balance(acc.id, "2024-01-01") == 849.5
    assert repo.compute_balance(acc.id, "2024-12-31") == 974.75
    assert repo.recalculate_and_sync_current_balance(acc.id) == 894.75


def test_negative_balances_are_not_clamped(db_session):
    acc = make_account(db_session, opening=100.0)
    add_tx(db_session, acc, "2024-05-05", 450.0, "out")
    db_session.commit()
    assert LedgerRepository(db_session).recalculate_account_running_balances(acc.id) == -350.0


def test_point_in_time_balances_and_yearly_summary_follow_the_legacy_chain(app_client, admin_cookies, db_session, legacy):
    acc, _ = legacy
    rows = app_client.get("/api/finance/reports/balances", params={"as_of_date": "2024-12-31"}, cookies=admin_cookies).json()["accounts"]
    row = [r for r in rows if r["account_id"] == acc.id][0]
    assert row["balance_as_of_date"] == 974.75
    assert row["opening_balance"] == 1000.0

    resp = app_client.get("/api/finance/reports/fiscal-year-summary", params={"year": 2024}, cookies=admin_cookies)
    assert resp.status_code == 200
    accounts = resp.json()["accounts"]
    mine = [a for a in accounts if a["account_id"] == acc.id][0]
    assert mine["opening"] == 1149.5
    assert mine["closing"] == 974.75
    assert mine["money_in"] == 125.25
    assert mine["money_out"] == 300.0
