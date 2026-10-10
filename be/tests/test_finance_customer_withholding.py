"""
be/tests/test_finance_customer_withholding.py
Slice F3 of Finance Review Round 2 (D-024): customer withholding tax at invoice preparation,
received-plus-withheld settlement, and the credits report.
"""
import importlib.util
import os

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from invoice_test_helpers import (
    BASE, account_balance, create_invoice, get_invoice, make_account, make_customer, receipt,
)

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT = "/api/finance/reports/withholding-credits"


def _customer(client, cookies, rate=None, name="WHT Customer"):
    body = {"name": name}
    if rate is not None:
        body["withholding_tax_rate"] = rate
    resp = client.post("/api/finance/customers", json=body, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _rows(client, cookies, acc):
    rows = client.get(f"/api/finance/accounts/{acc}/transactions", cookies=cookies).json()
    return rows["items"] if isinstance(rows, dict) else rows


def test_zero_rate_is_the_default_and_receipts_behave_as_before(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv = create_invoice(app_client, admin_cookies, cust, amount=1000.0, send=True)
    assert inv["withholding_tax_rate"] == 0.0 and inv["withholding_amount"] == 0.0
    assert inv["expected_to_receive"] == 1000.0

    # withheld tax cannot be claimed when no withholding is expected
    bad = receipt(app_client, admin_cookies, inv["id"], acc, 900.0, reference="Z-1", withheld_amount=100.0)
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "withheld_exceeds_expected"
    assert account_balance(app_client, admin_cookies, acc) == 0.0

    ok = receipt(app_client, admin_cookies, inv["id"], acc, 1000.0, reference="Z-2")
    assert ok.status_code == 201 and ok.json()["withheld_amount"] == 0.0
    done = get_invoice(app_client, admin_cookies, inv["id"])
    assert done["status"] == "paid" and done["balance"] == 0.0 and done["withheld_total"] == 0.0


def test_invoice_rate_defaults_from_customer_and_is_editable_on_draft(app_client, admin_cookies):
    cust = _customer(app_client, admin_cookies, rate=1.0)
    assert cust["withholding_tax_rate"] == 1.0
    inv = create_invoice(app_client, admin_cookies, cust["id"], amount=100000.0)
    assert inv["withholding_tax_rate"] == 1.0
    assert inv["withholding_amount"] == 1000.0 and inv["expected_to_receive"] == 99000.0

    upd = app_client.put(f"{BASE}/{inv['id']}", json={"withholding_tax_rate": 3}, cookies=admin_cookies)
    assert upd.status_code == 200 and upd.json()["withholding_amount"] == 3000.0

    explicit = create_invoice(app_client, admin_cookies, cust["id"], amount=100.0, withholding_tax_rate=0)
    assert explicit["withholding_tax_rate"] == 0.0

    upd_c = app_client.put(f"/api/finance/customers/{cust['id']}", json={"withholding_tax_rate": 2.5}, cookies=admin_cookies)
    assert upd_c.status_code == 200 and upd_c.json()["withholding_tax_rate"] == 2.5
    assert app_client.put(f"/api/finance/customers/{cust['id']}", json={"withholding_tax_rate": 101}, cookies=admin_cookies).status_code == 422


def test_withholding_computed_on_net_subtotal_with_vat(app_client, admin_cookies):
    cust = _customer(app_client, admin_cookies, rate=1.0, name="EGP WHT")
    inv = create_invoice(app_client, admin_cookies, cust["id"], amount=100000.0, currency="EGP")
    assert inv["tax_amount"] == 14000.0 and inv["total"] == 114000.0
    assert inv["withholding_amount"] == 1000.0          # 1% of the net 100,000, not of the total
    assert inv["expected_to_receive"] == 113000.0


def test_rate_locked_once_sent(app_client, admin_cookies):
    cust = _customer(app_client, admin_cookies, rate=1.0, name="Locked WHT")
    inv = create_invoice(app_client, admin_cookies, cust["id"], amount=1000.0, send=True)
    resp = app_client.put(f"{BASE}/{inv['id']}", json={"withholding_tax_rate": 0}, cookies=admin_cookies)
    assert resp.status_code == 409 and "withholding_tax_rate" in resp.json()["detail"]["locked_fields"]
    assert app_client.put(f"{BASE}/{inv['id']}", json={"withholding_tax_rate": 1, "notes": "n"}, cookies=admin_cookies).status_code == 200


def test_receipt_plus_withheld_closes_invoice_and_only_received_moves_bank(app_client, admin_cookies):
    cust = _customer(app_client, admin_cookies, rate=1.0, name="Acceptance WHT")
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv = create_invoice(app_client, admin_cookies, cust["id"], amount=100000.0, send=True)
    assert inv["total"] == 100000.0 and inv["expected_to_receive"] == 99000.0

    pay = receipt(app_client, admin_cookies, inv["id"], acc, 99000.0, reference="WHT-1", withheld_amount=1000.0)
    assert pay.status_code == 201, pay.text
    assert pay.json()["amount"] == 99000.0 and pay.json()["withheld_amount"] == 1000.0

    done = get_invoice(app_client, admin_cookies, inv["id"])
    assert done["status"] == "paid" and done["balance"] == 0.0
    assert done["amount_paid"] == 99000.0 and done["withheld_total"] == 1000.0
    assert account_balance(app_client, admin_cookies, acc) == 99000.0     # no bank movement for the 1,000
    assert [r["amount"] for r in _rows(app_client, admin_cookies, acc) if r.get("linked_invoice_id") == inv["id"]] == [99000.0]


def test_partial_receipt_with_withheld_and_reversal(app_client, admin_cookies):
    cust = _customer(app_client, admin_cookies, rate=1.0, name="Partial WHT")
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv = create_invoice(app_client, admin_cookies, cust["id"], amount=100000.0, send=True)

    first = receipt(app_client, admin_cookies, inv["id"], acc, 49500.0, reference="P-1", withheld_amount=500.0)
    assert first.status_code == 201
    mid = get_invoice(app_client, admin_cookies, inv["id"])
    assert mid["status"] == "partially_paid" and mid["balance"] == 50000.0

    # cannot withhold more than expected, nor overpay with received + withheld
    assert receipt(app_client, admin_cookies, inv["id"], acc, 10.0, reference="P-2", withheld_amount=600.0).status_code == 400
    assert receipt(app_client, admin_cookies, inv["id"], acc, 50000.0, reference="P-3", withheld_amount=500.0).status_code == 400

    second = receipt(app_client, admin_cookies, inv["id"], acc, 49500.0, reference="P-4", withheld_amount=500.0)
    assert second.status_code == 201
    assert get_invoice(app_client, admin_cookies, inv["id"])["status"] == "paid"

    rev = app_client.post(f"{BASE}/{inv['id']}/payments/{second.json()['id']}/reverse", cookies=admin_cookies)
    assert rev.status_code == 200
    back = get_invoice(app_client, admin_cookies, inv["id"])
    assert back["status"] == "partially_paid" and back["balance"] == 50000.0 and back["withheld_total"] == 500.0
    assert account_balance(app_client, admin_cookies, acc) == 49500.0


def test_withholding_credits_report_lists_withheld_by_customer_and_month(app_client, admin_cookies):
    cust = _customer(app_client, admin_cookies, rate=1.0, name="Report WHT")
    other = _customer(app_client, admin_cookies, rate=0, name="No WHT")
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv = create_invoice(app_client, admin_cookies, cust["id"], amount=100000.0, send=True)
    receipt(app_client, admin_cookies, inv["id"], acc, 99000.0, reference="R-1", withheld_amount=1000.0, date="2026-09-15")
    plain = create_invoice(app_client, admin_cookies, other["id"], amount=500.0, send=True)
    receipt(app_client, admin_cookies, plain["id"], acc, 500.0, reference="R-2", date="2026-09-16")

    res = app_client.get(f"{REPORT}?currency=USD", cookies=admin_cookies)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_withheld"] == 1000.0
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["customer_name"] == "Report WHT" and item["month"] == "2026-09"
    assert item["withheld_amount"] == 1000.0 and item["invoice_numbers"] == [inv["invoice_number"]]

    # a reversed receipt drops out of the report; date filter works
    assert app_client.get(f"{REPORT}?currency=USD&start_date=2027-01-01", cookies=admin_cookies).json()["items"] == []
    pay_id = app_client.get(f"{BASE}/{inv['id']}/payments", cookies=admin_cookies).json()[0]["id"]
    app_client.post(f"{BASE}/{inv['id']}/payments/{pay_id}/reverse", cookies=admin_cookies)
    assert app_client.get(f"{REPORT}?currency=USD", cookies=admin_cookies).json()["total_withheld"] == 0.0


def test_report_in_library_and_permission(app_client, admin_cookies, employee_cookies):
    lib = app_client.get("/api/finance/reports/library", cookies=admin_cookies)
    assert lib.status_code == 200
    data = lib.json()
    reports = data if isinstance(data, list) else (data.get("reports") or data.get("items") or [])
    assert "withholding-credits" in [r["key"] for r in reports]
    assert app_client.get(REPORT, cookies=employee_cookies).status_code == 403


def test_migration_adds_withholding_columns_with_zero(tmp_path):
    path = os.path.join(BE_DIR, "migrations", "versions", "0033_customer_withholding_tax.py")
    spec = importlib.util.spec_from_file_location("mig_0033", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE finance_customers (id INTEGER PRIMARY KEY, name VARCHAR(50))"))
        conn.execute(sa.text("CREATE TABLE finance_sales_invoices (id INTEGER PRIMARY KEY, total FLOAT)"))
        conn.execute(sa.text("CREATE TABLE finance_payments (id INTEGER PRIMARY KEY, amount FLOAT)"))
        conn.execute(sa.text("INSERT INTO finance_customers VALUES (1, 'A')"))
        conn.execute(sa.text("INSERT INTO finance_sales_invoices VALUES (1, 500)"))
        conn.execute(sa.text("INSERT INTO finance_payments VALUES (1, 500)"))
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
    with engine.connect() as conn:
        assert conn.execute(sa.text("SELECT withholding_tax_rate FROM finance_customers")).scalar() == 0
        assert tuple(conn.execute(sa.text("SELECT withholding_tax_rate, total FROM finance_sales_invoices")).fetchone()) == (0, 500)
        assert tuple(conn.execute(sa.text("SELECT withheld_amount, amount FROM finance_payments")).fetchone()) == (0, 500)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
    insp = sa.inspect(engine)
    assert "withholding_tax_rate" not in {c["name"] for c in insp.get_columns("finance_customers")}
    assert "withheld_amount" not in {c["name"] for c in insp.get_columns("finance_payments")}
