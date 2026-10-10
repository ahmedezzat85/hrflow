"""
be/tests/test_finance_payroll_posting.py
Slice F5 of Finance Review Round 2 (D-025): marking a payroll run paid moves net pay only, immediately;
payroll ledger rows are source="payroll"; no hard-coded fallback accounts; leg currency equals the
funding account's currency; and the 0034 data migration.
"""
import importlib.util
import os

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from db import get_db_context
from finance.models import FinanceBankAccountDB, LedgerTransactionDB, PayrollRunDB
from invoice_test_helpers import account_balance
from test_finance_payroll_split_fx import _cleanup_test_payroll_data, _setup_employee_with_plan

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS = "/api/finance/payroll/runs"


def _account(name, currency="USD", account_type="bank", opening=10000.0):
    with get_db_context() as db:
        acc = FinanceBankAccountDB(
            account_name=name, account_type=account_type, currency=currency, bank_name="Test Bank",
            account_number=f"PR-{name}", is_active=True, opening_balance=opening, current_balance=opening,
        )
        db.add(acc)
        db.commit()
        db.refresh(acc)
        return acc.id


def _finalized_run(client, cookies, label, ext_id=None, int_id=None, bank_id=None):
    body = {
        "period_label": label, "period_start": f"{label}-01", "period_end": f"{label}-28", "fx_rate_value": 50.0,
    }
    if ext_id:
        body["external_funding_account_id"] = ext_id
    if int_id:
        body["internal_funding_account_id"] = int_id
    if bank_id:
        body["bank_account_id"] = bank_id
    resp = client.post(f"{RUNS}/generate", json=body, cookies=cookies)
    assert resp.status_code == 201, resp.text
    run_id = resp.json()["id"]
    assert client.post(f"{RUNS}/{run_id}/approve", cookies=cookies).status_code == 200
    assert client.post(f"{RUNS}/{run_id}/finalize", cookies=cookies).status_code == 200
    return run_id


def _payroll_rows(label):
    with get_db_context() as db:
        rows = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.reference.like(f"PAYROLL-{label}%")).all()
        return [
            {"id": r.id, "account_id": r.account_id, "amount": r.amount, "source": r.source, "currency": r.currency,
             "payment_type_code": r.payment_type.code if r.payment_type else None, "running_balance": r.running_balance}
            for r in rows
        ]


def test_marking_run_paid_drops_funding_balances_by_net_pay_at_once(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    bank = _account("PR Bank A", "USD", "bank", 10000.0)
    cash = _account("PR Cash A", "USD", "cash", 5000.0)
    _setup_employee_with_plan("Posting Emp", "posting.emp@hrflow.test", ext_amount=3500.0, int_amount=1500.0)
    run_id = _finalized_run(app_client, admin_cookies, "2027-01", ext_id=bank, int_id=cash, bank_id=bank)

    assert app_client.post(f"{RUNS}/{run_id}/pay", json={}, cookies=admin_cookies).status_code == 200
    # no separate post-journal call: balances already dropped by the net pay only
    assert account_balance(app_client, admin_cookies, bank) == 10000.0 - 3500.0
    assert account_balance(app_client, admin_cookies, cash) == 5000.0 - 1500.0

    rows = {r["account_id"]: r for r in _payroll_rows("2027-01")}
    assert set(rows) == {bank, cash}
    assert rows[bank]["source"] == "payroll" and rows[bank]["payment_type_code"] == "OUTBOUND_TRANS"
    assert rows[cash]["source"] == "payroll" and rows[cash]["payment_type_code"] == "CASH"
    assert rows[bank]["running_balance"] == 6500.0 and rows[cash]["running_balance"] == 3500.0

    # posting the journal afterwards is idempotent: nothing is posted twice
    again = app_client.post(f"{RUNS}/{run_id}/post-journal", cookies=admin_cookies)
    assert again.status_code == 200 and again.json()["is_already_posted"] is True
    assert again.json()["amount"] == 5000.0
    assert account_balance(app_client, admin_cookies, bank) == 6500.0
    assert len(_payroll_rows("2027-01")) == 2


def test_payroll_rows_cannot_be_edited_or_deleted_as_hand_entries(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    bank = _account("PR Bank B", "USD", "bank", 10000.0)
    _setup_employee_with_plan("Locked Emp", "locked.emp@hrflow.test", ext_amount=1000.0)
    run_id = _finalized_run(app_client, admin_cookies, "2027-02", ext_id=bank, int_id=bank, bank_id=bank)
    assert app_client.post(f"{RUNS}/{run_id}/pay", json={}, cookies=admin_cookies).status_code == 200
    tx_id = _payroll_rows("2027-02")[0]["id"]

    put = app_client.put(f"/api/finance/transactions/{tx_id}", json={"description": "tampered"}, cookies=admin_cookies)
    assert put.status_code == 400
    assert app_client.delete(f"/api/finance/transactions/{tx_id}", cookies=admin_cookies).status_code == 400
    assert account_balance(app_client, admin_cookies, bank) == 9000.0


def test_posting_without_funding_accounts_is_refused_never_to_account_1(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    decoy = _account("PR Decoy", "USD", "bank", 777.0)   # an account that a hard-coded fallback could hit
    _setup_employee_with_plan("Unfunded Emp", "unfunded.emp@hrflow.test", ext_amount=1000.0)
    run_id = _finalized_run(app_client, admin_cookies, "2027-03")   # no funding accounts at all
    with get_db_context() as db:
        run = db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        run.bank_account_id = run.external_funding_account_id = run.internal_funding_account_id = None
        db.commit()

    pay = app_client.post(f"{RUNS}/{run_id}/pay", json={}, cookies=admin_cookies)
    assert pay.status_code == 400 and pay.json()["detail"]["code"] == "funding_account_required"
    assert _payroll_rows("2027-03") == []
    assert account_balance(app_client, admin_cookies, decoy) == 777.0
    with get_db_context() as db:
        assert db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first().status == "finalized"

    journal = app_client.post(f"{RUNS}/{run_id}/post-journal", cookies=admin_cookies)
    assert journal.status_code == 400 and journal.json()["detail"]["code"] == "funding_account_required"


def test_usd_run_cannot_post_to_egp_funding_account(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    egp = _account("PR EGP", "EGP", "bank", 50000.0)
    _setup_employee_with_plan("Currency Emp", "currency.emp@hrflow.test", ext_amount=1000.0)
    run_id = _finalized_run(app_client, admin_cookies, "2027-04", ext_id=egp, int_id=egp, bank_id=egp)

    pay = app_client.post(f"{RUNS}/{run_id}/pay", json={}, cookies=admin_cookies)
    assert pay.status_code == 400 and pay.json()["detail"]["code"] == "currency_mismatch"
    assert _payroll_rows("2027-04") == []
    assert account_balance(app_client, admin_cookies, egp) == 50000.0


def test_migration_marks_payroll_rows_and_recalculates_balances(tmp_path):
    path = os.path.join(BE_DIR, "migrations", "versions", "0034_payroll_ledger_source.py")
    spec = importlib.util.spec_from_file_location("mig_0034", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE finance_bank_accounts (id INTEGER PRIMARY KEY, opening_balance FLOAT, current_balance FLOAT)"))
        conn.execute(sa.text(
            "CREATE TABLE finance_ledger_transactions (id INTEGER PRIMARY KEY, account_id INTEGER, date VARCHAR(20), "
            "amount FLOAT, direction VARCHAR(5), reference VARCHAR(100), source VARCHAR(30), running_balance FLOAT)"
        ))
        conn.execute(sa.text("INSERT INTO finance_bank_accounts VALUES (1, 1000, 1000), (2, 500, 500)"))
        # account 1: a real manual entry plus a payroll row saved as manual (balance never recalculated)
        conn.execute(sa.text("INSERT INTO finance_ledger_transactions VALUES "
                             "(1, 1, '2026-09-01', 100, 'in', 'DEP-1', 'manual', 1100), "
                             "(2, 1, '2026-09-28', 300, 'out', 'PAYROLL-2026-09-EXT', 'manual', 0), "
                             "(3, 1, '2026-09-29', 50, 'out', 'FEE-1', 'manual', 0), "
                             "(4, 2, '2026-09-10', 20, 'out', 'OTHER-1', 'manual', 480)"))
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
    with engine.connect() as conn:
        src = {r[0]: r[1] for r in conn.execute(sa.text("SELECT id, source FROM finance_ledger_transactions"))}
        assert src == {1: "manual", 2: "payroll", 3: "manual", 4: "manual"}
        bal = {r[0]: r[1] for r in conn.execute(sa.text("SELECT id, current_balance FROM finance_bank_accounts"))}
        assert bal == {1: 1000 + 100 - 300 - 50, 2: 500}      # only the affected account is recalculated
        running = {r[0]: r[1] for r in conn.execute(sa.text("SELECT id, running_balance FROM finance_ledger_transactions"))}
        assert running[1] == 1100 and running[2] == 800 and running[3] == 750 and running[4] == 480

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
    with engine.connect() as conn:
        assert conn.execute(sa.text("SELECT source FROM finance_ledger_transactions WHERE id = 2")).scalar() == "manual"
