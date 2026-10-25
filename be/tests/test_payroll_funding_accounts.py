"""
be/tests/test_payroll_funding_accounts.py
Payroll funding accounts are owned by Payroll Settings (docs/finance-module/payroll-funding-account-settings-plan.md):
set once in Settings, followed by runs until finalize, frozen at finalize, and payment stops until they are set.
"""
import importlib.util
import os

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from db import get_db_context
from finance.models import FinanceBankAccountDB, PayrollRunDB
from invoice_test_helpers import account_balance
from payroll_test_helpers import set_funding_accounts
from test_finance_payroll_posting import RUNS, _account, _finalized_run, _payroll_rows
from test_finance_payroll_split_fx import _cleanup_test_payroll_data, _setup_employee_with_plan
from test_rbac import _create_test_user_with_roles, _make_user_cookies

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS = "/api/finance/payroll/settings"


def _cookies(system_key):
    with get_db_context() as db:
        user = _create_test_user_with_roles(
            db,
            email=f"fund_{system_key or 'norole'}@voyance.health",
            system_keys=[system_key] if system_key else [],
            employee_id=2 if system_key == "employee" else None,
        )
    return _make_user_cookies(user)


def _run(client, cookies, label, **extra):
    body = {"period_label": label, "period_start": f"{label}-01", "period_end": f"{label}-28", "fx_rate_value": 50.0, **extra}
    return client.post(f"{RUNS}/generate", json=body, cookies=cookies)


def test_migration_adds_and_drops_funding_columns(tmp_path):
    path = os.path.join(BE_DIR, "migrations", "versions", "0045_payroll_funding_accounts.py")
    spec = importlib.util.spec_from_file_location("mig_0045", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE finance_bank_accounts (id INTEGER PRIMARY KEY)"))
        conn.execute(sa.text("CREATE TABLE finance_payroll_settings (id INTEGER PRIMARY KEY, employee_rate FLOAT, employer_rate FLOAT)"))
        conn.execute(sa.text("INSERT INTO finance_payroll_settings VALUES (1, 0.11, 0.18)"))

    def run(fn):
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                fn()

    def cols():
        return {c["name"] for c in sa.inspect(engine).get_columns("finance_payroll_settings")}

    run(mod.upgrade)
    assert {"external_funding_account_id", "internal_funding_account_id"} <= cols()
    run(mod.upgrade)  # idempotent
    with engine.connect() as conn:
        row = conn.execute(sa.text("SELECT employee_rate, external_funding_account_id FROM finance_payroll_settings")).one()
        assert tuple(row) == (0.11, None)  # existing data kept, accounts start unset
    run(mod.downgrade)
    assert not ({"external_funding_account_id", "internal_funding_account_id"} & cols())


def test_settings_put_validates_replaces_and_never_clears(app_client, admin_cookies):
    a = _account("FA One")
    b = _account("FA Two")
    with get_db_context() as db:
        inactive = FinanceBankAccountDB(account_name="FA Off", account_type="bank", currency="USD", bank_name="B",
                                        account_number="FA-OFF", is_active=False)
        db.add(inactive)
        db.commit()
        inactive_id = inactive.id

    ok = app_client.put(SETTINGS, json={"external_funding_account_id": a, "internal_funding_account_id": b}, cookies=admin_cookies)
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["external_funding_account"] == {"id": a, "name": "FA One", "currency": "USD", "type": "bank"}
    assert "PR-FA" not in str(body)  # no account numbers in the summary

    for bad in (inactive_id, 999999):
        resp = app_client.put(SETTINGS, json={"external_funding_account_id": bad}, cookies=admin_cookies)
        assert resp.status_code == 400 and resp.json()["detail"]["code"] == "funding_account_invalid"

    # replace one leg; null or omitted never clears the other
    replaced = app_client.put(SETTINGS, json={"external_funding_account_id": b, "internal_funding_account_id": None}, cookies=admin_cookies)
    assert replaced.status_code == 200
    got = app_client.get(SETTINGS, cookies=admin_cookies).json()
    assert got["external_funding_account_id"] == b and got["internal_funding_account_id"] == b


ROLES = {  # role -> (can read Settings, can write Settings)
    "super_admin": (True, True),
    "financial_admin": (True, True),
    "payroll_maker": (True, False),
    "hr_admin": (False, False),
    "employee": (False, False),
    None: (False, False),
}


@pytest.mark.parametrize("system_key", list(ROLES))
def test_settings_permission_matrix(app_client, system_key):
    can_read, can_write = ROLES[system_key]
    acc = _account("FA Matrix")
    cookies = _cookies(system_key)
    assert (app_client.get(SETTINGS, cookies=cookies).status_code != 403) == can_read
    put = app_client.put(SETTINGS, json={"external_funding_account_id": acc}, cookies=cookies)
    assert (put.status_code != 403) == can_write, f"{system_key} PUT -> {put.status_code}"


def test_run_with_settings_unset_has_no_accounts_and_client_ids_are_rejected(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    decoy = _account("FA Decoy")
    _setup_employee_with_plan("Unset Emp", "unset.emp@hrflow.test", ext_amount=1000.0)

    resp = _run(app_client, admin_cookies, "2027-05")
    assert resp.status_code == 201, resp.text
    run = resp.json()
    assert run["external_funding_account_id"] is None and run["internal_funding_account_id"] is None

    # A per-run choice that is not the Settings account is refused (here Settings is empty)
    resp = _run(app_client, admin_cookies, "2027-06", external_funding_account_id=decoy, bank_account_id=decoy)
    assert resp.status_code == 400 and resp.json()["detail"]["code"] == "funding_accounts_come_from_settings"


def test_payment_and_journal_stop_until_settings_are_set(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    _setup_employee_with_plan("Stop Emp", "stop.emp@hrflow.test", ext_amount=1000.0, int_amount=500.0)
    run_id = _finalized_run(app_client, admin_cookies, "2027-07")

    pay = app_client.post(f"{RUNS}/{run_id}/pay", json={}, cookies=admin_cookies)
    assert pay.status_code == 409
    detail = pay.json()["detail"]
    assert detail["code"] == "funding_accounts_not_set" and set(detail["missing"]) == {"external", "internal"}
    assert _payroll_rows("2027-07") == []
    journal = app_client.post(f"{RUNS}/{run_id}/post-journal", cookies=admin_cookies)
    assert journal.status_code == 409 and journal.json()["detail"]["code"] == "funding_accounts_not_set"
    with get_db_context() as db:
        run = db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        assert run.status == "finalized"  # nothing was marked paid

    # Setting the accounts (as the Pay step does) unblocks the run: unset legs take the Settings accounts
    bank = _account("FA Late Bank", opening=20000.0)
    cash = _account("FA Late Cash", account_type="cash", opening=5000.0)
    set_funding_accounts(bank, cash)
    pay = app_client.post(f"{RUNS}/{run_id}/pay", json={}, cookies=admin_cookies)
    assert pay.status_code == 200, pay.text
    assert {r["account_id"] for r in _payroll_rows("2027-07")} == {bank, cash}


def test_runs_follow_settings_until_finalize_then_freeze(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    first = _account("FA First", opening=20000.0)
    second = _account("FA Second", opening=20000.0)
    _setup_employee_with_plan("Freeze Emp", "freeze.emp@hrflow.test", ext_amount=1000.0)

    set_funding_accounts(first)
    resp = _run(app_client, admin_cookies, "2027-08")
    assert resp.status_code == 201, resp.text
    run_id = resp.json()["id"]
    assert resp.json()["external_funding_account_id"] == first

    # Settings change before finalize: the draft follows it
    set_funding_accounts(second)
    shown = app_client.get(f"{RUNS}/{run_id}", cookies=admin_cookies).json()
    assert shown["external_funding_account_id"] == second and shown["internal_funding_account_id"] == second

    assert app_client.post(f"{RUNS}/{run_id}/approve", cookies=admin_cookies).status_code == 200
    assert app_client.post(f"{RUNS}/{run_id}/finalize", cookies=admin_cookies).status_code == 200

    # Settings change after finalize: the run keeps its frozen accounts and pays from them
    set_funding_accounts(first)
    frozen = app_client.get(f"{RUNS}/{run_id}", cookies=admin_cookies).json()
    assert frozen["external_funding_account_id"] == second

    other = app_client.post(f"{RUNS}/{run_id}/pay", json={"bank_account_id": first}, cookies=admin_cookies)
    assert other.status_code == 400 and other.json()["detail"]["code"] == "funding_accounts_come_from_settings"

    pay = app_client.post(f"{RUNS}/{run_id}/pay", json={}, cookies=admin_cookies)
    assert pay.status_code == 200, pay.text
    assert {r["account_id"] for r in _payroll_rows("2027-08")} == {second}
    assert account_balance(app_client, admin_cookies, first) == 20000.0


def _payroll_obligation(client, cookies):
    resp = client.post(
        "/api/finance/statutory-obligations",
        json={"obligation_type": "withholding_tax", "period": "2027-09", "amount_accrued": 1000.0,
              "due_date": "2027-10-10", "currency": "USD", "notes": "payroll statutory"},
        cookies=cookies,
    )
    assert resp.status_code == 201, resp.text
    obl_id = resp.json()["id"]
    with get_db_context() as db:
        from finance.models import StatutoryObligationDB
        obl = db.query(StatutoryObligationDB).filter(StatutoryObligationDB.id == obl_id).first()
        obl.source_type = "payroll_run"
        db.commit()
    return obl_id


def test_payroll_statutory_payment_follows_settings_with_no_fallback(app_client, admin_cookies):
    configured = _account("FA Statutory", opening=50000.0)
    other = _account("FA Other", opening=50000.0)
    obl_id = _payroll_obligation(app_client, admin_cookies)
    url = f"/api/finance/statutory-obligations/{obl_id}/settle"
    body = {"amount": 400.0, "payment_date": "2027-09-16", "currency": "USD", "reference": "SI-1", "method": "bank_transfer"}

    # Settings unset: blocked, even when the client names an account
    blocked = app_client.post(url, json={**body, "bank_account_id": other}, cookies=admin_cookies)
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "funding_accounts_not_set"

    set_funding_accounts(configured)
    # A different account is refused
    wrong = app_client.post(url, json={**body, "bank_account_id": other}, cookies=admin_cookies)
    assert wrong.status_code == 400 and wrong.json()["detail"]["code"] == "funding_accounts_come_from_settings"
    assert account_balance(app_client, admin_cookies, other) == 50000.0

    # Omitting the account pays from the configured one
    ok = app_client.post(url, json=body, cookies=admin_cookies)
    assert ok.status_code == 200, ok.text
    assert account_balance(app_client, admin_cookies, configured) == 49600.0
