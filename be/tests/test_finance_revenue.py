"""
be/tests/test_finance_revenue.py
X4 (D-029, D-030): revenue sources, "Record revenue receipt", invoice receipts as source Invoice, and the
revenue breakdown by product x book x source x month per currency with an Untagged revenue row.
"""
import importlib.util
import os
from datetime import datetime

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from invoice_test_helpers import create_invoice, make_customer, receipt
from test_finance_books import _account, _get, TODAY

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = "/api/finance/revenue-receipts"
_n = {"v": 0}


def _sources(client, cookies):
    resp = client.get("/api/finance/revenue-sources", cookies=cookies)
    assert resp.status_code == 200, resp.text
    return {s["code"]: s for s in resp.json()}


def _product(client, cookies, name):
    _n["v"] += 1
    resp = client.post("/api/finance/products", json={"name": name, "code": f"RV{_n['v']}{abs(hash(name)) % 999}", "product_type": "saas_subscription", "default_currency": "USD"}, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _receipt(client, cookies, account_id, source_id, amount=1000.0, currency="USD", **extra):
    payload = {"account_id": account_id, "date": TODAY, "amount": amount, "currency": currency, "revenue_source_id": source_id}
    payload.update(extra)
    return client.post(R, json=payload, cookies=cookies)


def _balance(client, cookies, account_id):
    return client.get(f"/api/finance/accounts/{account_id}", cookies=cookies).json()["current_balance"]


def test_sources_seeded_editable_and_protected(app_client, admin_cookies, employee_cookies):
    src = _sources(app_client, admin_cookies)
    assert set(src) == {"invoice", "stripe_payout", "direct_transfer", "cash", "other"}
    assert src["invoice"]["is_system"] is True
    assert app_client.get("/api/finance/revenue-sources", cookies=employee_cookies).status_code == 403

    made = app_client.post("/api/finance/revenue-sources", json={"name": "Marketplace payout", "code": "Marketplace Payout"}, cookies=admin_cookies)
    assert made.status_code == 201 and made.json()["code"] == "marketplace_payout"
    assert app_client.post("/api/finance/revenue-sources", json={"name": "Dup", "code": "marketplace_payout"}, cookies=admin_cookies).status_code == 400
    assert app_client.post("/api/finance/revenue-sources", json={"name": "No", "code": "no"}, cookies=employee_cookies).status_code == 403

    renamed = app_client.patch(f"/api/finance/revenue-sources/{made.json()['id']}", json={"name": "Marketplace"}, cookies=admin_cookies)
    assert renamed.json()["name"] == "Marketplace"
    off = app_client.patch(f"/api/finance/revenue-sources/{made.json()['id']}", json={"is_active": False}, cookies=admin_cookies)
    assert off.json()["is_active"] is False
    assert app_client.patch(f"/api/finance/revenue-sources/{src['invoice']['id']}", json={"is_active": False}, cookies=admin_cookies).status_code == 400


def test_record_receipt_validations_and_memo_fields(app_client, admin_cookies, employee_cookies):
    acc = _account(app_client, admin_cookies, "Rcpt Overseas", "USD", book="overseas", opening=500.0)
    src = _sources(app_client, admin_cookies)
    pid = _product(app_client, admin_cookies, "Receipt Product")
    cust = make_customer(app_client, admin_cookies, "Receipt Customer")

    resp = _receipt(app_client, admin_cookies, acc["id"], src["stripe_payout"]["id"], amount=90.0, product_id=pid, customer_id=cust,
                    period_start="2026-09-01", period_end="2026-09-30", memo_gross_amount=100.0, memo_fee_amount=10.0, reference="po_123")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["revenue_source_name"] == "Stripe payout" and body["product_name"] == "Receipt Product" and body["customer_name"] == "Receipt Customer"
    assert body["book_code"] == "overseas" and body["memo_gross_amount"] == 100.0 and body["memo_fee_amount"] == 10.0
    assert _balance(app_client, admin_cookies, acc["id"]) == 590.0  # only the 90 received; memo amounts never move the balance

    # D-020 same currency, Invoice source refused, bad period, inactive product, permissions
    assert _receipt(app_client, admin_cookies, acc["id"], src["cash"]["id"], currency="EGP").status_code == 400
    assert _receipt(app_client, admin_cookies, acc["id"], src["invoice"]["id"]).status_code == 400
    assert _receipt(app_client, admin_cookies, acc["id"], src["cash"]["id"], period_start="2026-09-30", period_end="2026-09-01").status_code == 400
    assert _receipt(app_client, admin_cookies, acc["id"], src["cash"]["id"], date="09/01/2026").status_code == 400
    assert _receipt(app_client, admin_cookies, 999999, src["cash"]["id"]).status_code == 404
    off = _product(app_client, admin_cookies, "Retired Product")
    app_client.patch(f"/api/finance/products/{off}", json={"is_active": False}, cookies=admin_cookies)
    assert _receipt(app_client, admin_cookies, acc["id"], src["cash"]["id"], product_id=off).status_code == 400
    assert _receipt(app_client, employee_cookies, acc["id"], src["cash"]["id"]).status_code == 403

    listed = app_client.get(f"{R}?book=overseas", cookies=admin_cookies).json()
    assert [r["id"] for r in listed] == [body["id"]]
    assert app_client.get(f"{R}?book=local", cookies=admin_cookies).json() == []


def test_receipt_attachment_and_reversal(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Rcpt Local", "USD", opening=0.0)
    src = _sources(app_client, admin_cookies)
    rid = _receipt(app_client, admin_cookies, acc["id"], src["direct_transfer"]["id"], amount=400.0).json()["id"]

    up = app_client.post(f"{R}/{rid}/attachment", files={"file": ("wire.pdf", b"%PDF-1.4 wire", "application/pdf")}, cookies=admin_cookies)
    assert up.status_code == 200 and up.json()["has_attachment"] is True
    dl = app_client.get(f"{R}/{rid}/attachment", cookies=admin_cookies)
    assert dl.status_code == 200 and dl.content == b"%PDF-1.4 wire"

    rev = app_client.post(f"{R}/{rid}/reverse", json={"reason": "Booked on the wrong account"}, cookies=admin_cookies)
    assert rev.status_code == 201 and rev.json()["is_reversal"] is True
    assert _balance(app_client, admin_cookies, acc["id"]) == 0.0
    assert app_client.post(f"{R}/{rid}/reverse", json={"reason": "again"}, cookies=admin_cookies).status_code == 400
    assert app_client.post(f"{R}/{rev.json()['id']}/reverse", json={"reason": "undo"}, cookies=admin_cookies).status_code == 400
    # the original row is still there, and revenue nets to zero
    assert app_client.get(f"{R}/{rid}", cookies=admin_cookies).status_code == 200
    bd = _get(app_client, admin_cookies, "revenue-breakdown", currency="USD", date_from=TODAY, date_to=TODAY, book="local")
    assert bd["totals_by_currency"].get("USD", 0.0) == 0.0


def test_invoice_receipt_is_source_invoice_and_split_by_product(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Inv Local", "USD", opening=0.0)
    pid = _product(app_client, admin_cookies, "Invoice Product")
    cust = make_customer(app_client, admin_cookies, "Invoice Customer")
    resp = app_client.post("/api/finance/invoices", json={
        "customer_id": cust, "invoice_number": "INV-X4-1", "issue_date": TODAY, "due_date": TODAY, "currency": "USD",
        "expected_bank_account_id": acc["id"],
        "lines": [
            {"description": "Tagged", "quantity": 1, "unit_price": 600.0, "line_total": 600.0, "product_id": pid},
            {"description": "Untagged", "quantity": 1, "unit_price": 400.0, "line_total": 400.0},
        ],
    }, cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    inv = resp.json()
    assert app_client.post(f"/api/finance/invoices/{inv['id']}/send", cookies=admin_cookies).status_code == 200
    receipt(app_client, admin_cookies, inv["id"], acc["id"], 1000.0, date=TODAY)

    bd = _get(app_client, admin_cookies, "revenue-breakdown", currency="USD", date_from=TODAY, date_to=TODAY, book="local")
    rows = {r["product_name"]: r for r in bd["rows"] if r["customer_name"] == "Invoice Customer"}
    assert rows["Invoice Product"]["amount"] == 600.0 and rows["Invoice Product"]["source"] == "Invoice"
    assert rows["Untagged revenue"]["amount"] == 400.0
    assert bd["untagged_by_currency"]["USD"] >= 400.0

    ledger = app_client.get(f"/api/finance/accounts/{acc['id']}/transactions", cookies=admin_cookies).json()
    assert ledger and ledger[0]["source"] == "invoice_payment"


def test_breakdown_by_book_source_product_and_currency(app_client, admin_cookies):
    usd_local = _account(app_client, admin_cookies, "BD Local USD", "USD", book="local")
    egp_local = _account(app_client, admin_cookies, "BD Local EGP", "EGP", book="local")
    usd_over = _account(app_client, admin_cookies, "BD Overseas USD", "USD", book="overseas")
    src = _sources(app_client, admin_cookies)
    p_saas = _product(app_client, admin_cookies, "BD SaaS")
    p_impl = _product(app_client, admin_cookies, "BD Implementation")

    assert _receipt(app_client, admin_cookies, usd_over["id"], src["stripe_payout"]["id"], 4000.0, product_id=p_saas).status_code == 201
    assert _receipt(app_client, admin_cookies, usd_over["id"], src["direct_transfer"]["id"], 10000.0, product_id=p_impl).status_code == 201
    assert _receipt(app_client, admin_cookies, usd_over["id"], src["other"]["id"], 250.0).status_code == 201  # untagged
    assert _receipt(app_client, admin_cookies, egp_local["id"], src["cash"]["id"], 5000.0, "EGP", product_id=p_saas).status_code == 201
    assert _receipt(app_client, admin_cookies, usd_local["id"], src["direct_transfer"]["id"], 700.0, product_id=p_saas).status_code == 201

    def cell(rows, book, product, source, cur):
        return sum(r["amount"] for r in rows if r["book_code"] == book and r["product_name"] == product and r["source"] == source and r["currency"] == cur)

    bd = _get(app_client, admin_cookies, "revenue-breakdown", currency="ALL", date_from=TODAY, date_to=TODAY, book="consolidated")
    rows = bd["rows"]
    assert cell(rows, "overseas", "BD SaaS", "Stripe payout", "USD") == 4000.0
    assert cell(rows, "overseas", "BD Implementation", "Direct transfer", "USD") == 10000.0
    assert cell(rows, "overseas", "Untagged revenue", "Other", "USD") == 250.0
    assert cell(rows, "local", "BD SaaS", "Cash", "EGP") == 5000.0
    assert cell(rows, "local", "BD SaaS", "Direct transfer", "USD") == 700.0
    assert all(r["month"] == TODAY[:7] for r in rows)
    # one figure per currency, never a converted total (D-026)
    assert bd["totals_by_currency"]["USD"] == 14950.0 and bd["totals_by_currency"]["EGP"] == 5000.0
    assert "converted" in bd["conversion_policy"]

    over = _get(app_client, admin_cookies, "revenue-breakdown", currency="USD", date_from=TODAY, date_to=TODAY, book="overseas")
    assert over["totals_by_currency"]["USD"] == 14250.0 and all(r["book_code"] == "overseas" for r in over["rows"])
    assert app_client.get("/api/finance/reports/revenue-breakdown?book=bogus", cookies=admin_cookies).status_code == 400


def _migration():
    path = os.path.join(BE_DIR, "migrations", "versions", "0039_revenue_receipts.py")
    spec = importlib.util.spec_from_file_location("mig_0039", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_tags_existing_invoice_receipts(tmp_path):
    mod = _migration()
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'm.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE finance_products (id INTEGER PRIMARY KEY)"))
        conn.execute(sa.text("CREATE TABLE finance_customers (id INTEGER PRIMARY KEY)"))
        conn.execute(sa.text("CREATE TABLE finance_sales_invoices (id INTEGER PRIMARY KEY, customer_id INTEGER)"))
        conn.execute(sa.text(
            "CREATE TABLE finance_ledger_transactions (id INTEGER PRIMARY KEY, account_id INTEGER, amount FLOAT, source VARCHAR(50), linked_invoice_id INTEGER)"
        ))
        conn.execute(sa.text("INSERT INTO finance_customers VALUES (7)"))
        conn.execute(sa.text("INSERT INTO finance_sales_invoices VALUES (1, 7)"))
        conn.execute(sa.text("INSERT INTO finance_ledger_transactions VALUES (1, 1, 100, 'invoice_payment', 1), (2, 1, 100, 'payment_reversal', 1), (3, 1, 50, 'manual', NULL)"))

    for _ in range(2):  # idempotent
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                mod.upgrade()

    with engine.begin() as conn:
        codes = [r[0] for r in conn.execute(sa.text("SELECT code FROM finance_revenue_sources ORDER BY sort_order")).fetchall()]
        assert codes == ["invoice", "stripe_payout", "direct_transfer", "cash", "other"]
        inv_src = conn.execute(sa.text("SELECT id FROM finance_revenue_sources WHERE code = 'invoice'")).scalar()
        rows = {r[0]: (r[1], r[2]) for r in conn.execute(sa.text("SELECT id, revenue_source_id, customer_id FROM finance_ledger_transactions")).fetchall()}
        assert rows[1] == (inv_src, 7) and rows[2] == (inv_src, 7) and rows[3] == (None, None)

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
    assert "revenue_source_id" not in {c["name"] for c in sa.inspect(engine).get_columns("finance_ledger_transactions")}
    assert "finance_revenue_sources" not in sa.inspect(engine).get_table_names()
