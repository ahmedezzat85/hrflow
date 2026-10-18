"""
be/tests/test_finance_analytics.py
X6: revenue and subscription analytics and their exports (one record per row, per currency, audited).
"""
import csv
import io

import openpyxl

from test_finance_books import _account, _get, _tx, TODAY
from test_finance_revenue import _receipt, _sources, _product
from test_finance_subscriptions_v2 import _months_ago, _sub, _charges, S
from invoice_test_helpers import make_customer

R = "/api/finance/reports"


def _export(client, cookies, key, fmt="xlsx", **filters):
    return client.post(f"{R}/export", json={"report_key": key, "format": fmt, "filters": filters}, cookies=cookies)


def _sheet_rows(content: bytes):
    ws = openpyxl.load_workbook(io.BytesIO(content)).active
    return [[c.value for c in row] for row in ws.iter_rows()]


def _settle(client, cookies, sub_id, account_id, amount, date_index=0):
    client.get(S, cookies=cookies)  # generates the expected charges
    ch = sorted(_charges(client, cookies, subscription_id=sub_id, status="expected"), key=lambda c: c["billing_date"])[date_index]
    pay = _tx(client, cookies, account_id, "out", amount, "USD", "Subscription payment")
    resp = client.post(f"{S}/charges/{ch['id']}/settle", json={"mode": "link_ledger", "ledger_transaction_id": pay["id"]}, cookies=cookies)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_subscription_spend_by_vendor_department_and_book(app_client, admin_cookies, employee_cookies):
    local = _account(app_client, admin_cookies, "AN Local", "USD", book="local", opening=5000.0)
    over = _account(app_client, admin_cookies, "AN Overseas", "USD", book="overseas", opening=5000.0)
    s_local = _sub(app_client, admin_cookies, account_id=local["id"], months_back=1, department="Engineering", amount=100.0)
    s_over = _sub(app_client, admin_cookies, account_id=over["id"], months_back=1, department="Sales", amount=40.0)
    _settle(app_client, admin_cookies, s_local["id"], local["id"], 100.0)
    _settle(app_client, admin_cookies, s_over["id"], over["id"], 45.0)

    frm = _months_ago(2).strftime("%Y-%m-%d")
    allv = _get(app_client, admin_cookies, "subscription-spend", date_from=frm, date_to=TODAY, currency="ALL")
    assert allv["totals_by_currency"]["USD"] == 145.0
    assert {r["book_code"] for r in allv["rows"]} == {"local", "overseas"}
    by_book = {(b["book_code"], b["currency"]): b["amount"] for b in allv["by_book"]}
    assert by_book[("local", "USD")] == 100.0 and by_book[("overseas", "USD")] == 45.0
    assert {d["department"] for d in allv["by_department"]} >= {"Engineering", "Sales"}
    assert any(v["vendor"] for v in allv["by_vendor"])
    over_row = next(r for r in allv["rows"] if r["book_code"] == "overseas")
    assert over_row["variance"] == 5.0 and over_row["paid_from"].startswith("AN Overseas")

    only_over = _get(app_client, admin_cookies, "subscription-spend", date_from=frm, date_to=TODAY, book="overseas")
    assert only_over["totals_by_currency"]["USD"] == 45.0 and all(r["book_code"] == "overseas" for r in only_over["rows"])
    assert app_client.get(f"{R}/subscription-spend?book=bogus", cookies=admin_cookies).status_code == 400
    assert app_client.get(f"{R}/subscription-spend", cookies=employee_cookies).status_code == 403


def test_proofs_missing_report(app_client, admin_cookies, employee_cookies):
    acc = _account(app_client, admin_cookies, "AN Proof", "USD", opening=1000.0)
    sub = _sub(app_client, admin_cookies, account_id=acc["id"], months_back=1, proof_expected=True)
    quiet = _sub(app_client, admin_cookies, account_id=acc["id"], months_back=1, proof_expected=False)
    app_client.get(S, cookies=admin_cookies)
    rep = _get(app_client, admin_cookies, "subscription-proofs-missing")
    ids = {r["subscription"] for r in rep["rows"]}
    assert sub["name"] in ids and quiet["name"] not in ids
    row = next(r for r in rep["rows"] if r["subscription"] == sub["name"])
    assert row["proof_source"] == "email_inbox" and row["billing_email"] == "billing@vendor.test" and row["book_code"] == "local"
    assert rep["totals_by_currency"]["USD"] >= 200.0
    assert app_client.get(f"{R}/subscription-proofs-missing", cookies=employee_cookies).status_code == 403


def test_exports_are_one_record_per_row_and_audited(app_client, admin_cookies, employee_cookies):
    over = _account(app_client, admin_cookies, "AN Export Over", "USD", book="overseas")
    src = _sources(app_client, admin_cookies)
    pid = _product(app_client, admin_cookies, "Export Product")
    cust = make_customer(app_client, admin_cookies, "=HYPERLINK(evil)")  # formula injection attempt in a name
    assert _receipt(app_client, admin_cookies, over["id"], src["stripe_payout"]["id"], 700.0, product_id=pid, customer_id=cust).status_code == 201
    assert _receipt(app_client, admin_cookies, over["id"], src["other"]["id"], 55.0).status_code == 201

    bd = _get(app_client, admin_cookies, "revenue-breakdown", currency="ALL", date_from=TODAY, date_to=TODAY, book="overseas")
    resp = _export(app_client, admin_cookies, "revenue-breakdown", "xlsx", currency="ALL", date_from=TODAY, date_to=TODAY, book="overseas")
    assert resp.status_code == 200, resp.text[:200]
    assert "spreadsheetml" in resp.headers["content-type"]
    rows = _sheet_rows(resp.content)
    header_idx = next(i for i, r in enumerate(rows) if r and r[0] == "Month")
    assert rows[header_idx] == ["Month", "Book", "Source", "Product", "Customer", "Currency", "Amount"]
    data_rows = []
    for r in rows[header_idx + 1:]:
        if not r or r[0] is None or str(r[0]).startswith("TOTALS"):
            break
        data_rows.append(r)
    assert len(data_rows) == len(bd["rows"])  # exactly one record per breakdown row
    assert sum(r[6] for r in data_rows) == 755.0
    assert any("Untagged revenue" == r[3] for r in data_rows)
    assert not any(str(c).startswith("=") for r in data_rows for c in r if isinstance(c, str))  # formulas neutralised
    meta = " ".join(str(c) for r in rows[:3] for c in r if c)
    assert "Book: Overseas" in meta

    csv_resp = _export(app_client, admin_cookies, "revenue-breakdown", "csv", currency="ALL", date_from=TODAY, date_to=TODAY, book="overseas")
    assert csv_resp.status_code == 200
    lines = [l for l in csv.reader(io.StringIO(csv_resp.content.decode("utf-8"))) if l and not l[0].startswith("#")]
    assert lines[0] == ["Month", "Book", "Source", "Product", "Customer", "Currency", "Amount"] and len(lines) == 1 + len(bd["rows"])

    # the audit trail records each export with its filters
    audits = app_client.get(f"{R}/export-audits?report_key=revenue-breakdown", cookies=admin_cookies).json()
    assert len(audits) >= 2 and all(a["row_count"] == len(bd["rows"]) for a in audits[:2])
    assert '"book": "overseas"' in audits[0]["filters_json"]
    assert _export(app_client, employee_cookies, "revenue-breakdown").status_code == 403


def test_subscription_exports(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "AN Sub Export", "USD", opening=1000.0)
    sub = _sub(app_client, admin_cookies, account_id=acc["id"], months_back=1, department="Ops")
    _settle(app_client, admin_cookies, sub["id"], acc["id"], 100.0)
    frm = _months_ago(2).strftime("%Y-%m-%d")

    spend = _get(app_client, admin_cookies, "subscription-spend", date_from=frm, date_to=TODAY)
    resp = _export(app_client, admin_cookies, "subscription-spend", "xlsx", date_from=frm, date_to=TODAY)
    assert resp.status_code == 200
    rows = _sheet_rows(resp.content)
    hi = next(i for i, r in enumerate(rows) if r and r[0] == "Month")
    assert rows[hi][:4] == ["Month", "Vendor", "Department", "Subscription"]
    body = []
    for r in rows[hi + 1:]:
        if not r or r[0] is None or str(r[0]).startswith("TOTALS"):
            break
        body.append(r)
    assert len(body) == len(spend["rows"])

    pm = _export(app_client, admin_cookies, "subscription-proofs-missing", "xlsx")
    assert pm.status_code == 200
    hi = next(i for i, r in enumerate(_sheet_rows(pm.content)) if r and r[0] == "Billing date")
    assert hi >= 0
    csv_pm = _export(app_client, admin_cookies, "subscription-proofs-missing", "csv")
    assert csv_pm.status_code == 200 and b"Billing date,Subscription,Vendor,Status" in csv_pm.content


def test_library_lists_the_analytics_reports(app_client, admin_cookies):
    lib = app_client.get(f"{R}/library", cookies=admin_cookies).json()
    items = lib["reports"] if isinstance(lib, dict) else lib
    keys = {r["key"] for r in items}
    assert {"revenue-breakdown", "subscription-spend", "subscription-proofs-missing"} <= keys
