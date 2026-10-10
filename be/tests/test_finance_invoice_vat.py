"""
be/tests/test_finance_invoice_vat.py
Slice F2 of Finance Review Round 2 (D-023): VAT on sales invoices, net revenue,
the on-demand monthly VAT estimate, and the 0032 migration.
"""
import importlib.util
import os
from datetime import datetime

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from invoice_test_helpers import BASE, create_invoice, get_invoice, make_customer

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAT = "/api/finance/statutory-obligations"


def test_egp_invoice_defaults_to_14_percent(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=105000.0, currency="EGP")
    assert inv["vat_rate"] == 14.0
    assert inv["subtotal"] == 105000.0
    assert inv["tax_amount"] == 14700.0
    assert inv["total"] == 119700.0
    assert inv["balance"] == 119700.0


def test_other_currency_defaults_to_zero_and_rate_is_editable_on_draft(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    usd = create_invoice(app_client, admin_cookies, cust, amount=1000.0, currency="USD")
    assert usd["vat_rate"] == 0.0 and usd["tax_amount"] == 0.0 and usd["total"] == 1000.0

    upd = app_client.put(f"{BASE}/{usd['id']}", json={"vat_rate": 5}, cookies=admin_cookies)
    assert upd.status_code == 200, upd.text
    assert upd.json()["tax_amount"] == 50.0 and upd.json()["total"] == 1050.0

    explicit = create_invoice(app_client, admin_cookies, cust, amount=200.0, currency="EGP", vat_rate=0)
    assert explicit["vat_rate"] == 0.0 and explicit["total"] == 200.0

    # rate and lines together recompute from the new lines
    both = app_client.put(f"{BASE}/{usd['id']}", json={
        "vat_rate": 10,
        "lines": [{"description": "X", "quantity": 2, "unit_price": 500.0, "line_total": 1000.0}],
    }, cookies=admin_cookies)
    assert both.json()["tax_amount"] == 100.0 and both.json()["total"] == 1100.0


def test_invalid_vat_rate_refused(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust)
    assert app_client.put(f"{BASE}/{inv['id']}", json={"vat_rate": -1}, cookies=admin_cookies).status_code == 422
    assert app_client.put(f"{BASE}/{inv['id']}", json={"vat_rate": 101}, cookies=admin_cookies).status_code == 422


def test_vat_rate_locked_once_sent(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=1000.0, currency="EGP", send=True)
    resp = app_client.put(f"{BASE}/{inv['id']}", json={"vat_rate": 0}, cookies=admin_cookies)
    assert resp.status_code == 409
    assert "vat_rate" in resp.json()["detail"]["locked_fields"]
    same = app_client.put(f"{BASE}/{inv['id']}", json={"vat_rate": 14, "notes": "ok"}, cookies=admin_cookies)
    assert same.status_code == 200 and same.json()["total"] == 1140.0


def test_revenue_report_uses_net_subtotal(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    create_invoice(app_client, admin_cookies, cust, amount=105000.0, currency="EGP",
                   issue_date=today, due_date=today, send=True)
    res = app_client.get("/api/finance/reports/summary?basis=accrual&period=MTD&currency=EGP", cookies=admin_cookies)
    assert res.status_code == 200, res.text
    assert res.json()["revenue_mtd"] == 105000.0


def _month_invoice(client, cookies, cust, month, amount, currency="EGP", send=True, number=None):
    return create_invoice(client, cookies, cust, number=number, amount=amount, currency=currency,
                          issue_date=f"{month}-10", due_date=f"{month}-28", send=send)


def test_vat_estimate_creates_then_updates_one_obligation(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    _month_invoice(app_client, admin_cookies, cust, "2026-08", 100000.0)           # VAT 14,000
    _month_invoice(app_client, admin_cookies, cust, "2026-08", 50000.0, send=False)  # draft: excluded
    _month_invoice(app_client, admin_cookies, cust, "2026-08", 1000.0, currency="USD")  # not EGP: excluded
    _month_invoice(app_client, admin_cookies, cust, "2026-09", 10000.0)            # other month: excluded

    first = app_client.post(f"{STAT}/vat-estimate", json={"period": "2026-08"}, cookies=admin_cookies)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["obligation_type"] == "sales_tax" and body["status"] == "estimated"
    assert body["currency"] == "EGP" and body["period"] == "2026-08"
    assert body["amount_estimated"] == 14000.0 and body["amount_accrued"] == 14000.0

    # a new invoice in the month, then regenerate: same obligation, new estimate
    _month_invoice(app_client, admin_cookies, cust, "2026-08", 10000.0)  # +1,400
    second = app_client.post(f"{STAT}/vat-estimate", json={"period": "2026-08"}, cookies=admin_cookies)
    assert second.status_code == 200
    assert second.json()["id"] == body["id"]
    assert second.json()["amount_estimated"] == 15400.0

    rows = app_client.get(f"{STAT}?obligation_type=sales_tax&period=2026-08", cookies=admin_cookies).json()
    assert len(rows) == 1


def test_vat_estimate_not_regenerated_after_portal_confirmation(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    _month_invoice(app_client, admin_cookies, cust, "2026-07", 100000.0)
    ob = app_client.post(f"{STAT}/vat-estimate", json={"period": "2026-07"}, cookies=admin_cookies).json()
    conf = app_client.post(f"{STAT}/{ob['id']}/confirm", json={"amount_accrued": 13900.0, "variance_note": "portal"}, cookies=admin_cookies)
    assert conf.status_code == 200 and conf.json()["status"] == "accrued"

    again = app_client.post(f"{STAT}/vat-estimate", json={"period": "2026-07"}, cookies=admin_cookies)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "obligation_confirmed"
    assert app_client.get(f"{STAT}/{ob['id']}", cookies=admin_cookies).json()["amount_accrued"] == 13900.0


def test_vat_estimate_validates_period_and_permission(app_client, admin_cookies, employee_cookies):
    assert app_client.post(f"{STAT}/vat-estimate", json={"period": "2026-13"}, cookies=admin_cookies).status_code == 422
    assert app_client.post(f"{STAT}/vat-estimate", json={"period": "2026-08"}, cookies=employee_cookies).status_code == 403


# ── Migration 0032: existing invoices keep their totals ─────────────────────
def test_migration_adds_vat_rate_zero_and_keeps_totals(tmp_path):
    path = os.path.join(BE_DIR, "migrations", "versions", "0032_invoice_vat_rate.py")
    spec = importlib.util.spec_from_file_location("mig_0032", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text(
            "CREATE TABLE finance_sales_invoices (id INTEGER PRIMARY KEY, subtotal FLOAT, tax_amount FLOAT, total FLOAT)"
        ))
        conn.execute(sa.text("INSERT INTO finance_sales_invoices VALUES (1, 1000, 0, 1000), (2, 250.5, 0, 250.5)"))

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
    with engine.connect() as conn:
        rows = conn.execute(sa.text("SELECT id, subtotal, tax_amount, total, vat_rate FROM finance_sales_invoices ORDER BY id")).fetchall()
    assert [tuple(r) for r in rows] == [(1, 1000.0, 0.0, 1000.0, 0.0), (2, 250.5, 0.0, 250.5, 0.0)]

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
    assert "vat_rate" not in {c["name"] for c in sa.inspect(engine).get_columns("finance_sales_invoices")}
