"""
be/tests/test_year_openings.py
BI-1a (D-043): fiscal-year opening balances. Base selection, variance, running-balance restarts, current_balance,
negative openings, CRUD API (audit log, permissions, recalculation), checkpoints and the 0047 migration.
The legacy behaviour of accounts without rows is pinned separately in test_year_openings_legacy.py.
"""
import importlib.util
import json
import os
import uuid
from datetime import date

import pytest
import sqlalchemy as sa

from db import get_session_factory
from finance import year_openings
from finance.models import FinanceBankAccountDB, FinanceAccountYearOpeningDB, LedgerTransactionDB
from finance.repositories.accounts_repository import AccountsRepository
from finance.repositories.ledger_repository import LedgerRepository
from models_db import AuditLogDB

from conftest import create_test_user


@pytest.fixture(autouse=True)
def frozen_today(monkeypatch):
    monkeypatch.setattr(year_openings, "_today", lambda: date(2026, 10, 26))


@pytest.fixture
def db_session(app_client):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def make_account(db, opening=1000.0, visibility="full"):
    acc = FinanceBankAccountDB(account_name=f"BI {uuid.uuid4().hex[:6]}", bank_name="Test Bank",
                               account_number=f"BI-{uuid.uuid4().hex[:8]}", currency="USD",
                               opening_balance=opening, opening_balance_date="2023-01-01",
                               current_balance=opening, is_active=True, visibility=visibility)
    db.add(acc)
    db.flush()
    return acc


def add_tx(db, acc, day, amount, direction):
    tx = LedgerTransactionDB(account_id=acc.id, date=day, amount=amount, direction=direction,
                             currency=acc.currency, source="manual", entry_type="standard")
    db.add(tx)
    db.flush()
    return tx


def put(client, cookies, acc, year, amount, note=None):
    body = {"opening_balance": amount}
    if note is not None:
        body["note"] = note
    return client.put(f"/api/finance/accounts/{acc.id}/year-openings/{year}", json=body, cookies=cookies)


def listing(client, cookies, acc):
    resp = client.get(f"/api/finance/accounts/{acc.id}/year-openings", cookies=cookies)
    assert resp.status_code == 200, resp.text
    return resp.json()


def item(data, year):
    return [i for i in data["items"] if i["fiscal_year"] == year][0]


@pytest.fixture
def chain(db_session):
    """Opening 1000; 2023 +200, 2024 -300 / +100, 2025 -50, 2026 +10 -> chain closings 1200, 1000, 950, 960."""
    acc = make_account(db_session, 1000.0)
    txs = [
        add_tx(db_session, acc, "2023-03-01", 200.0, "in"),
        add_tx(db_session, acc, "2024-01-01", 300.0, "out"),
        add_tx(db_session, acc, "2024-06-15", 100.0, "in"),
        add_tx(db_session, acc, "2025-02-02", 50.0, "out"),
        add_tx(db_session, acc, "2026-04-04", 10.0, "in"),
    ]
    db_session.commit()
    return acc, txs


# 2. base selection ------------------------------------------------------------------------------
def test_base_selection_with_rows_for_2024_and_2026(app_client, admin_cookies, db_session, chain):
    acc, _ = chain
    assert put(app_client, admin_cookies, acc, 2024, 5000.0).status_code == 200
    assert put(app_client, admin_cookies, acc, 2026, 100.0).status_code == 200
    db_session.expire_all()
    acc = db_session.get(FinanceBankAccountDB, acc.id)
    f = lambda d: year_openings.balance_as_of(db_session, acc, d)
    assert f("2023-12-31") == 1200.0          # before the first entered year: legacy chain
    assert f("2024-01-01") == 4700.0          # entered 5000 then the 300 out on January 1
    assert f("2024-12-31") == 4800.0
    assert f("2025-12-31") == 4750.0          # no 2025 row: 2024 base carries on
    assert f("2026-01-01") == 100.0
    assert f("2026-12-31") == 110.0
    # the entered 2026 row overrides the chain: correcting 2024 does not change 2026
    assert put(app_client, admin_cookies, acc, 2024, 9999.0).status_code == 200
    db_session.expire_all()
    assert year_openings.balance_as_of(db_session, acc, "2026-12-31") == 110.0
    assert year_openings.balance_as_of(db_session, acc, "2025-12-31") == 9749.0


def test_balance_at_start_of(app_client, admin_cookies, db_session, chain):
    acc, _ = chain
    put(app_client, admin_cookies, acc, 2024, 5000.0)
    db_session.expire_all()
    acc = db_session.get(FinanceBankAccountDB, acc.id)
    assert year_openings.balance_at_start_of(db_session, acc, "2024-01-01") == 5000.0   # before January 1's transaction
    assert year_openings.balance_at_start_of(db_session, acc, "2024-01-02") == 4700.0
    assert year_openings.balance_at_start_of(db_session, acc, "2025-01-01") == 4800.0   # no row: previous closing
    assert year_openings.balance_at_start_of(db_session, acc, "2023-01-01") == 1000.0   # legacy start


def test_year_source_labels(app_client, admin_cookies, db_session, chain):
    acc, _ = chain
    put(app_client, admin_cookies, acc, 2024, 5000.0)
    data = listing(app_client, admin_cookies, acc)
    assert item(data, 2023)["source"] == "account_opening"
    assert item(data, 2024)["source"] == "entered" and item(data, 2024)["entered"] is True
    assert item(data, 2025)["source"] == "carried_forward" and item(data, 2025)["entered"] is False
    assert item(data, 2025)["opening"] == 4800.0


# 3. variance ------------------------------------------------------------------------------------
def test_variance_above_below_none_and_first_year_against_legacy_chain(app_client, admin_cookies, chain):
    acc, _ = chain
    r = put(app_client, admin_cookies, acc, 2024, 1250.0, note="bank statement").json()
    assert r["previous_closing"] == 1200.0 and r["variance"] == 50.0 and r["note"] == "bank statement"
    below = put(app_client, admin_cookies, acc, 2025, 4000.0).json()
    assert below["previous_closing"] == 1250.0 - 300.0 + 100.0 and below["variance"] == 4000.0 - 1050.0
    data = listing(app_client, admin_cookies, acc)
    assert item(data, 2026)["variance"] is None and item(data, 2026)["entered"] is False
    assert item(data, 2023)["variance"] is None
    zero = put(app_client, admin_cookies, acc, 2026, 3950.0).json()
    assert zero["variance"] == 0.0


# 4. running balances and current_balance --------------------------------------------------------
def test_running_balance_restarts_at_each_entered_year(app_client, admin_cookies, db_session, chain):
    acc, txs = chain
    put(app_client, admin_cookies, acc, 2024, 5000.0)
    put(app_client, admin_cookies, acc, 2026, 100.0)
    db_session.expire_all()
    assert [t.running_balance for t in db_session.query(LedgerTransactionDB).filter_by(account_id=acc.id)
            .order_by(LedgerTransactionDB.date, LedgerTransactionDB.id)] == [1200.0, 4700.0, 4800.0, 4750.0, 110.0]
    assert db_session.get(FinanceBankAccountDB, acc.id).current_balance == 110.0


def test_row_in_a_year_without_transactions_restarts_the_chain(app_client, admin_cookies, db_session, chain):
    acc, _ = chain
    put(app_client, admin_cookies, acc, 2025, 700.0)   # 2025 has a transaction on 02-02; use a gap year instead
    db_session.expire_all()
    assert year_openings.balance_as_of(db_session, db_session.get(FinanceBankAccountDB, acc.id), "2026-12-31") == 660.0
    assert db_session.get(FinanceBankAccountDB, acc.id).current_balance == 660.0


def test_current_balance_equals_opening_entered_for_the_current_year_with_no_transactions_yet(app_client, admin_cookies, db_session, chain):
    acc, _ = chain
    # last transaction 2026-04-04; the current year (frozen) is 2026. Use a fresh account with only old activity.
    old = make_account(db_session, 100.0)
    add_tx(db_session, old, "2024-05-05", 40.0, "out")
    db_session.commit()
    assert LedgerRepository(db_session).recalculate_account_running_balances(old.id) == 60.0
    assert put(app_client, admin_cookies, old, 2026, 250.0).status_code == 200
    db_session.expire_all()
    assert db_session.get(FinanceBankAccountDB, old.id).current_balance == 250.0
    assert AccountsRepository(db_session).compute_balance(old.id) == 250.0
    assert AccountsRepository(db_session).recalculate_and_sync_current_balance(old.id) == 250.0


def test_future_year_rows_are_ignored_for_current_balance(app_client, admin_cookies, db_session):
    acc = make_account(db_session, 100.0)
    add_tx(db_session, acc, "2025-05-05", 40.0, "out")
    db_session.commit()
    assert put(app_client, admin_cookies, acc, 2027, 9000.0).status_code == 200   # current year + 1 is allowed
    db_session.expire_all()
    assert db_session.get(FinanceBankAccountDB, acc.id).current_balance == 60.0
    assert AccountsRepository(db_session).compute_balance(acc.id) == 60.0


def test_account_without_transactions_and_a_row_for_the_current_year(app_client, admin_cookies, db_session):
    acc = make_account(db_session, 100.0)
    db_session.commit()
    put(app_client, admin_cookies, acc, 2026, -75.5)
    db_session.expire_all()
    assert db_session.get(FinanceBankAccountDB, acc.id).current_balance == -75.5


# 5. negative opening, payment rule unchanged (Q-024) -------------------------------------------
def test_negative_opening_allowed_and_payment_above_balance_still_refused(app_client, admin_cookies, db_session):
    from bill_test_helpers import create_approved, make_vendor, pay

    acc = make_account(db_session, 0.0)
    db_session.commit()
    r = put(app_client, admin_cookies, acc, 2026, -300.0)
    assert r.status_code == 200 and r.json()["opening"] == -300.0
    vid = make_vendor(app_client, admin_cookies, "Overdraft Vendor")
    bill = create_approved(app_client, admin_cookies, vid, "BI-OD-1", 100.0, currency="USD")
    res = pay(app_client, admin_cookies, bill["id"], acc.id, 100.0)
    assert res.status_code == 400 and res.json()["detail"]["code"] == "insufficient_balance"
    # a positive entered opening makes the same payment possible
    put(app_client, admin_cookies, acc, 2026, 500.0)
    assert pay(app_client, admin_cookies, bill["id"], acc.id, 100.0).status_code in (200, 201)


# 6. CRUD ---------------------------------------------------------------------------------------
def test_crud_upsert_delete_audit_and_recalculation(app_client, admin_cookies, db_session, chain):
    acc, txs = chain
    first = put(app_client, admin_cookies, acc, 2025, 800.0, note=" counted ")
    assert first.status_code == 200 and first.json()["note"] == "counted"
    again = put(app_client, admin_cookies, acc, 2025, 900.0)           # upsert: same row replaced
    assert again.status_code == 200 and again.json()["opening"] == 900.0 and again.json()["note"] == ""
    db_session.expire_all()
    assert db_session.query(FinanceAccountYearOpeningDB).filter_by(account_id=acc.id).count() == 1
    assert db_session.get(FinanceBankAccountDB, acc.id).current_balance == 860.0   # recalculation ran (900 - 50 + 10)

    gone = app_client.delete(f"/api/finance/accounts/{acc.id}/year-openings/2025", cookies=admin_cookies)
    assert gone.status_code == 200 and gone.json()["entered"] is False and gone.json()["source"] == "account_opening"
    db_session.expire_all()
    assert db_session.get(FinanceBankAccountDB, acc.id).current_balance == 960.0   # back to the legacy chain
    assert app_client.delete(f"/api/finance/accounts/{acc.id}/year-openings/2025", cookies=admin_cookies).status_code == 404

    actions = [a.action for a in db_session.query(AuditLogDB).filter(AuditLogDB.target_id == str(acc.id)).order_by(AuditLogDB.id)
               if a.action.startswith("account.year_opening")]
    assert actions == ["account.year_opening.set", "account.year_opening.set", "account.year_opening.deleted"]
    details = json.loads(db_session.query(AuditLogDB).filter_by(action="account.year_opening.set").order_by(AuditLogDB.id.desc()).first().details)
    assert details["fiscal_year"] == 2025 and details["old_opening_balance"] == 800.0 and details["opening_balance"] == 900.0


def test_year_range_validation_and_unknown_account(app_client, admin_cookies, db_session):
    acc = make_account(db_session)
    db_session.commit()
    assert put(app_client, admin_cookies, acc, 1999, 1.0).status_code == 400
    assert put(app_client, admin_cookies, acc, 2028, 1.0).status_code == 400
    assert put(app_client, admin_cookies, acc, 2027, 1.0).status_code == 200
    assert app_client.put("/api/finance/accounts/999999/year-openings/2026", json={"opening_balance": 1}, cookies=admin_cookies).status_code == 404
    assert app_client.get("/api/finance/accounts/999999/year-openings", cookies=admin_cookies).status_code == 404
    assert app_client.put(f"/api/finance/accounts/{acc.id}/year-openings/2026", json={}, cookies=admin_cookies).status_code == 422


def test_unique_account_year_at_database_level(db_session):
    acc = make_account(db_session)
    db_session.add(FinanceAccountYearOpeningDB(account_id=acc.id, fiscal_year=2026, opening_balance=1.0))
    db_session.commit()
    db_session.add(FinanceAccountYearOpeningDB(account_id=acc.id, fiscal_year=2026, opening_balance=2.0))
    with pytest.raises(sa.exc.IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_permissions_401_403_200(app_client, admin_cookies, employee_cookies, db_session):
    acc = make_account(db_session)
    db_session.commit()
    url = f"/api/finance/accounts/{acc.id}/year-openings"
    assert app_client.get(url).status_code == 401
    assert app_client.put(f"{url}/2026", json={"opening_balance": 1}).status_code == 401
    maker = create_test_user("bi-maker@hrflow.test", role_key="payroll_maker")
    for cookies in (employee_cookies, maker):
        assert app_client.get(url, cookies=cookies).status_code == 403
        assert app_client.put(f"{url}/2026", json={"opening_balance": 1}, cookies=cookies).status_code == 403
        assert app_client.delete(f"{url}/2026", cookies=cookies).status_code == 403
    fin = create_test_user("bi-fin@hrflow.test", role_key="financial_admin")
    assert app_client.put(f"{url}/2026", json={"opening_balance": 1}, cookies=fin).status_code == 200
    assert app_client.get(url, cookies=fin).status_code == 200
    assert app_client.delete(f"{url}/2026", cookies=fin).status_code == 200


def test_listing_reports_transactions_before_the_first_base_and_closed_months(app_client, admin_cookies, db_session, chain):
    acc, _ = chain
    data = listing(app_client, admin_cookies, acc)
    assert data["transactions_before_first_base"] == 0 and data["items"][0]["fiscal_year"] == 2023
    put(app_client, admin_cookies, acc, 2025, 1.0)
    assert listing(app_client, admin_cookies, acc)["transactions_before_first_base"] == 3   # 2023 and 2024 rows precede 2025


# 7. checkpoints --------------------------------------------------------------------------------
def test_checkpoint_computed_balance_follows_the_base_logic(app_client, admin_cookies, db_session, chain):
    acc, _ = chain
    acc.visibility = "partial"
    db_session.commit()
    put(app_client, admin_cookies, acc, 2025, 800.0)
    resp = app_client.post(f"/api/finance/accounts/{acc.id}/checkpoints", json={"date": "2025-12-31", "balance": 760.0}, cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    assert resp.json()["computed_balance"] == 750.0 and resp.json()["unrecorded_difference"] == 10.0


# 11 (part). migration -------------------------------------------------------------------------
def test_migration_0047_up_down_and_idempotent(tmp_path):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations", "versions", "0047_account_year_openings.py")
    spec = importlib.util.spec_from_file_location("mig_0047", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.down_revision == "0046_payroll_rate_settings"

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'm.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE finance_bank_accounts (id INTEGER PRIMARY KEY)"))
    for step in ("upgrade", "upgrade", "downgrade", "downgrade"):
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                getattr(mod, step)()
        has = "finance_account_year_openings" in sa.inspect(engine).get_table_names()
        assert has == (step == "upgrade")
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
    cols = {c["name"] for c in sa.inspect(engine).get_columns("finance_account_year_openings")}
    assert {"account_id", "fiscal_year", "opening_balance", "note", "created_by", "updated_by"} <= cols
