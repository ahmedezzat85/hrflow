"""
be/tests/test_finance_bill_withholding.py
Withholding tax on a vendor bill (D-024 amendment): a typed amount on the bill; one payment of total - withholding
settles it; the withheld part moves no cash; existing and imported bills stay at 0.
"""
import importlib.util
import os

import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from bill_test_helpers import create_approved, create_draft, make_account, make_vendor, pay, payment_type_id

BASE = "/api/finance/bills"
BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _bill(client, cookies, number, amount=114000.0, withholding=3000.0, **extra):
    vid = make_vendor(client, cookies, f"WHT Vendor {number}")
    return vid, create_approved(client, cookies, vid, number, amount, withholding_amount=withholding, **extra)


def _balance(client, cookies, account_id):
    return client.get(f"/api/finance/accounts/{account_id}", cookies=cookies).json()["current_balance"]


def test_default_is_zero_and_bills_behave_as_before(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Plain Vendor")
    bill = create_approved(app_client, admin_cookies, vid, "WHT-PLAIN", 1000.0)
    assert bill["withholding_amount"] == 0.0 and bill["net_payable"] == 1000.0
    acc = make_account(app_client, admin_cookies, "Plain Bank", number="55100001", balance=5000.0)
    part = pay(app_client, admin_cookies, bill["id"], acc, 400.0)
    assert part.status_code in (200, 201), part.text
    after = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert after["status"] == "partially_paid" and after["remaining_balance"] == 600.0


def test_response_shows_withholding_and_net_payable(app_client, admin_cookies):
    _, bill = _bill(app_client, admin_cookies, "WHT-001")
    assert bill["withholding_amount"] == 3000.0
    assert bill["net_payable"] == 111000.0
    assert bill["total"] == 114000.0


def test_one_payment_of_total_minus_withholding_settles_the_bill(app_client, admin_cookies):
    _, bill = _bill(app_client, admin_cookies, "WHT-002")
    acc = make_account(app_client, admin_cookies, "WHT Bank", number="55100002", balance=200000.0)
    resp = pay(app_client, admin_cookies, bill["id"], acc, 111000.0)
    assert resp.status_code in (200, 201), resp.text
    paid = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert paid["status"] == "paid"
    assert paid["remaining_balance"] == 0.0
    assert paid["amount_paid"] == 114000.0  # settled: cash plus withheld
    assert _balance(app_client, admin_cookies, acc) == 200000.0 - 111000.0  # only the cash moved
    payments = app_client.get(f"{BASE}/{bill['id']}/payments", cookies=admin_cookies).json()
    assert len(payments) == 1 and payments[0]["amount"] == 111000.0


def test_wrong_or_partial_amount_is_refused(app_client, admin_cookies):
    _, bill = _bill(app_client, admin_cookies, "WHT-003")
    acc = make_account(app_client, admin_cookies, "WHT Bank 3", number="55100003", balance=200000.0)
    for amount in (114000.0, 50000.0, 110000.0):
        r = pay(app_client, admin_cookies, bill["id"], acc, amount)
        assert r.status_code == 400 and r.json()["detail"]["code"] == "withholding_payment_mismatch", (amount, r.text)
    assert _balance(app_client, admin_cookies, acc) == 200000.0
    assert app_client.get(f"{BASE}/{bill['id']}/payments", cookies=admin_cookies).json() == []


def test_withholding_cannot_exceed_the_total_or_be_negative(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Over Vendor")
    line = {"description": "Item", "quantity": 1, "unit_price": 1000.0, "line_total": 1000.0}
    over = app_client.post(
        BASE,
        json={"vendor_id": vid, "bill_number": "WHT-OVER", "issue_date": "2026-09-01", "due_date": "2026-09-30",
              "currency": "EGP", "withholding_amount": 1500.0, "lines": [line]},
        cookies=admin_cookies,
    )
    assert over.status_code == 400
    neg = app_client.post(
        BASE,
        json={"vendor_id": vid, "bill_number": "WHT-NEG", "currency": "EGP", "withholding_amount": -1, "lines": [line]},
        cookies=admin_cookies,
    )
    assert neg.status_code == 422


def test_editable_until_a_payment_exists_then_locked_until_reversed(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Lock Vendor")
    bill = create_draft(app_client, admin_cookies, vid, "WHT-LOCK", 1000.0)
    upd = app_client.put(f"{BASE}/{bill['id']}", json={"withholding_amount": 30.0}, cookies=admin_cookies)
    assert upd.status_code == 200, upd.text
    assert upd.json()["withholding_amount"] == 30.0
    too_much = app_client.put(f"{BASE}/{bill['id']}", json={"withholding_amount": 5000.0}, cookies=admin_cookies)
    assert too_much.status_code == 400

    acc = make_account(app_client, admin_cookies, "Lock Bank", number="55100004", balance=5000.0)
    assert pay(app_client, admin_cookies, bill["id"], acc, 970.0).status_code in (200, 201)
    locked = app_client.put(f"{BASE}/{bill['id']}", json={"withholding_amount": 0.0}, cookies=admin_cookies)
    assert locked.status_code == 409

    pid = app_client.get(f"{BASE}/{bill['id']}/payments", cookies=admin_cookies).json()[0]["id"]
    rev = app_client.post(
        f"{BASE}/{bill['id']}/payments/{pid}/reverse", json={"reason": "wrong account used"}, cookies=admin_cookies
    )
    assert rev.status_code == 200, rev.text
    back = app_client.get(f"{BASE}/{bill['id']}", cookies=admin_cookies).json()
    assert back["status"] == "approved" and back["remaining_balance"] == 1000.0
    unlocked = app_client.put(f"{BASE}/{bill['id']}", json={"withholding_amount": 0.0}, cookies=admin_cookies)
    assert unlocked.status_code == 200


def test_create_and_pay_defaults_the_cash_to_net_payable(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Paid Now Vendor")
    acc = make_account(app_client, admin_cookies, "Paid Now Bank", number="55100005", balance=200000.0)
    resp = app_client.post(
        BASE,
        json={"vendor_id": vid, "bill_number": "WHT-NOW", "issue_date": "2026-08-01", "due_date": "2026-08-31",
              "currency": "USD", "withholding_amount": 3000.0, "is_paid_now": True,
              "payment": {"bank_account_id": acc, "payment_type_id": payment_type_id(), "payment_date": "2026-08-05"},
              "lines": [{"description": "Item", "quantity": 1, "unit_price": 114000.0, "line_total": 114000.0}]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "paid"
    assert _balance(app_client, admin_cookies, acc) == 200000.0 - 111000.0


def test_migration_adds_the_column_with_zero(tmp_path):
    path = os.path.join(BE_DIR, "migrations", "versions", "0077_bill_withholding.py")
    spec = importlib.util.spec_from_file_location("mig_0077", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE finance_bills (id INTEGER PRIMARY KEY, total NUMERIC(18,4))"))
        conn.execute(sa.text("INSERT INTO finance_bills VALUES (1, 500)"))
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
    with engine.connect() as conn:
        assert tuple(conn.execute(sa.text("SELECT withholding_amount, total FROM finance_bills")).fetchone()) == (0, 500)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
    assert "withholding_amount" not in {c["name"] for c in sa.inspect(engine).get_columns("finance_bills")}
