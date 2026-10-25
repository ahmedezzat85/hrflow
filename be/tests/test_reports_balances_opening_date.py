"""
be/tests/test_reports_balances_opening_date.py
FY-1 discovery: pins how GET /api/finance/reports/balances (ReportsService.get_point_in_time_balances) treats
`opening_balance_date` and transactions dated before it. These tests document CURRENT behaviour, they do not
endorse it:
- `opening_balance_date` is not read at all; the balance is opening_balance + all inflows - all outflows
  dated on or before as_of_date, whatever the opening date is.
- so transactions dated BEFORE the opening date are added on top of the opening balance, and an as_of_date
  BEFORE the opening date still shows the opening balance.
Also pinned: the as_of_date is inclusive, inactive accounts are left out, a negative balance is returned as is.
"""
import uuid
import pytest

from db import get_session_factory
from finance.models import FinanceBankAccountDB, LedgerTransactionDB

URL = "/api/finance/reports/balances"


@pytest.fixture
def db_session(app_client):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def _account(db, name, currency="USD", opening=1000.0, opening_date="2025-01-01", active=True):
    acc = FinanceBankAccountDB(account_name=f"{name} {uuid.uuid4().hex[:6]}", bank_name="Test Bank",
                               account_number=f"FY-{uuid.uuid4().hex[:8]}", currency=currency,
                               opening_balance=opening, opening_balance_date=opening_date,
                               current_balance=opening, is_active=active)
    db.add(acc)
    db.flush()
    return acc


def _tx(db, acc, date, amount, direction):
    db.add(LedgerTransactionDB(account_id=acc.id, date=date, amount=amount, direction=direction,
                               currency=acc.currency, source="manual", entry_type="standard"))


def _balance(app_client, cookies, acc, as_of):
    rows = app_client.get(URL, params={"as_of_date": as_of}, cookies=cookies).json()["accounts"]
    match = [r for r in rows if r["account_id"] == acc.id]
    return match[0]["balance_as_of_date"] if match else None


def test_opening_balance_date_is_ignored_by_point_in_time_balances(app_client, admin_cookies, db_session):
    acc = _account(db_session, "Opening Jan 2025", opening=1000.0, opening_date="2025-01-01")
    _tx(db_session, acc, "2024-06-15", 200.0, "in")    # BEFORE the opening date
    _tx(db_session, acc, "2025-03-01", 100.0, "out")
    db_session.commit()

    # the pre-opening transaction is added on top of the opening balance
    assert _balance(app_client, admin_cookies, acc, "2025-12-31") == 1100.0
    # an as-of date before the opening date still shows the opening balance (plus earlier flows)
    assert _balance(app_client, admin_cookies, acc, "2023-01-01") == 1000.0
    assert _balance(app_client, admin_cookies, acc, "2024-06-15") == 1200.0


def test_as_of_date_is_inclusive_and_flows_roll_forward(app_client, admin_cookies, db_session):
    acc = _account(db_session, "Roll forward", opening=500.0, opening_date="2025-01-01")
    _tx(db_session, acc, "2025-02-10", 300.0, "in")
    _tx(db_session, acc, "2025-02-11", 50.0, "out")
    db_session.commit()

    assert _balance(app_client, admin_cookies, acc, "2025-02-09") == 500.0
    assert _balance(app_client, admin_cookies, acc, "2025-02-10") == 800.0     # same day counts
    assert _balance(app_client, admin_cookies, acc, "2025-02-11") == 750.0
    # closing of one day is the opening of the next: the day after adds nothing
    assert _balance(app_client, admin_cookies, acc, "2025-02-12") == 750.0


def test_inactive_accounts_are_left_out_and_negative_balances_are_returned(app_client, admin_cookies, db_session):
    gone = _account(db_session, "Closed", opening=100.0, active=False)
    overdrawn = _account(db_session, "Overdrawn", opening=100.0)
    _tx(db_session, overdrawn, "2025-04-01", 450.0, "out")
    db_session.commit()

    assert _balance(app_client, admin_cookies, gone, "2025-12-31") is None
    assert _balance(app_client, admin_cookies, overdrawn, "2025-12-31") == -350.0


def test_currency_totals_are_kept_per_currency(app_client, admin_cookies, db_session):
    usd = _account(db_session, "USD acct", currency="USD", opening=100.0)
    egp = _account(db_session, "EGP acct", currency="EGP", opening=5000.0)
    _tx(db_session, usd, "2025-05-01", 25.0, "in")
    _tx(db_session, egp, "2025-05-01", 1000.0, "out")
    db_session.commit()

    data = app_client.get(URL, params={"as_of_date": "2025-12-31"}, cookies=admin_cookies).json()
    by_id = {r["account_id"]: r for r in data["accounts"]}
    assert by_id[usd.id]["balance_as_of_date"] == 125.0 and by_id[egp.id]["balance_as_of_date"] == 4000.0
    # totals are per currency, never summed across currencies
    assert set(data["currency_totals"]) >= {"USD", "EGP"}
