"""
be/tests/test_finance_books.py
X2 (D-028): books, account visibility, balance checkpoints, inter-book transfers and report views.

Includes the mandatory regression gate (Local-only data gives identical numbers for book omitted, local and
consolidated, on every report) and the worked example from plan 23 section 2.
"""
from datetime import datetime

import pytest

from invoice_test_helpers import make_customer, create_invoice, receipt
from test_finance_core_reports import core_reports_env  # noqa: F401 - reused as the Local-only dataset

TODAY = datetime.utcnow().strftime("%Y-%m-%d")
YEAR = datetime.utcnow().year
_n = {"v": 0}


def _books(client, cookies):
    resp = client.get("/api/finance/accounts/books", cookies=cookies)
    assert resp.status_code == 200, resp.text
    return {b["code"]: b for b in resp.json()}


def _account(client, cookies, name, currency, book=None, visibility=None, opening=0.0):
    _n["v"] += 1
    payload = {
        "account_name": f"{name} {_n['v']}",
        "bank_name": "Test Bank",
        "account_number": f"BK{_n['v']:06d}",
        "currency": currency,
        "opening_balance": opening,
        "account_type": "bank",
    }
    if book is not None:
        payload["book_id"] = _books(client, cookies)[book]["id"]
    if visibility:
        payload["visibility"] = visibility
    resp = client.post("/api/finance/accounts", json=payload, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _tx(client, cookies, account_id, direction, amount, currency, description="x"):
    resp = client.post(
        f"/api/finance/accounts/{account_id}/transactions",
        json={"date": TODAY, "amount": amount, "direction": direction, "currency": currency, "reference": f"R{_n['v']}", "description": description},
        cookies=cookies,
    )
    assert resp.status_code in (200, 201), resp.text
    _n["v"] += 1
    return resp.json()


def _transfer(client, cookies, from_id, to_id, amount, currency="USD"):
    resp = client.post(
        "/api/finance/transfers",
        json={"from_account_id": from_id, "to_account_id": to_id, "date": TODAY, "from_amount": amount, "from_currency": currency,
              "transfer_type": "internal", "note": "inter-book"},
        cookies=cookies,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _get(client, cookies, path, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
    resp = client.get(f"/api/finance/reports/{path}" + (f"?{q}" if q else ""), cookies=cookies)
    assert resp.status_code == 200, (path, resp.status_code, resp.text[:300])
    return resp.json()


def _strip(obj):
    """Remove fields that legitimately differ between views (timestamps, the echoed book)."""
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if k not in ("generated_at", "book")}
    if isinstance(obj, list):
        return [_strip(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------------------------------------------
# Accounts, books, visibility, checkpoints
# ---------------------------------------------------------------------------------------------------------------
def test_books_seeded_and_accounts_default_to_local(app_client, admin_cookies, employee_cookies):
    books = _books(app_client, admin_cookies)
    assert set(books) == {"local", "overseas"} and books["local"]["is_default"] is True and books["overseas"]["is_default"] is False
    assert app_client.get("/api/finance/accounts/books", cookies=employee_cookies).status_code == 403

    acc = _account(app_client, admin_cookies, "Default Book", "USD")
    assert acc["book_code"] == "local" and acc["visibility"] == "full"
    ov = _account(app_client, admin_cookies, "Over Book", "USD", book="overseas", visibility="partial")
    assert ov["book_code"] == "overseas" and ov["visibility"] == "partial"

    listed = {a["id"] for a in app_client.get("/api/finance/accounts?book=overseas", cookies=admin_cookies).json()}
    assert ov["id"] in listed and acc["id"] not in listed
    all_ids = {a["id"] for a in app_client.get("/api/finance/accounts", cookies=admin_cookies).json()}
    assert {ov["id"], acc["id"]} <= all_ids
    assert app_client.get("/api/finance/accounts?book=nope", cookies=admin_cookies).status_code == 400

    bad = app_client.post("/api/finance/accounts", json={"account_name": "Bad Vis", "account_number": "12345678", "visibility": "weird"}, cookies=admin_cookies)
    assert bad.status_code == 400
    bad_book = app_client.post("/api/finance/accounts", json={"account_name": "Bad Book", "account_number": "12345679", "book_id": 99999}, cookies=admin_cookies)
    assert bad_book.status_code == 404


def test_book_cannot_change_after_postings(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Move Me", "USD")
    overseas_id = _books(app_client, admin_cookies)["overseas"]["id"]
    moved = app_client.put(f"/api/finance/accounts/{acc['id']}", json={"book_id": overseas_id}, cookies=admin_cookies)
    assert moved.status_code == 200 and moved.json()["book_code"] == "overseas"
    _tx(app_client, admin_cookies, acc["id"], "in", 10.0, "USD")
    local_id = _books(app_client, admin_cookies)["local"]["id"]
    assert app_client.put(f"/api/finance/accounts/{acc['id']}", json={"book_id": local_id}, cookies=admin_cookies).status_code == 400


def test_partial_account_checkpoint_difference_is_never_posted(app_client, admin_cookies, employee_cookies):
    full = _account(app_client, admin_cookies, "Full Acc", "USD", opening=100.0)
    assert app_client.post(f"/api/finance/accounts/{full['id']}/checkpoints", json={"date": TODAY, "balance": 1.0}, cookies=admin_cookies).status_code == 400

    acc = _account(app_client, admin_cookies, "Partial Acc", "USD", book="overseas", visibility="partial", opening=1000.0)
    _tx(app_client, admin_cookies, acc["id"], "in", 500.0, "USD")
    assert app_client.post(f"/api/finance/accounts/{acc['id']}/checkpoints", json={"date": TODAY, "balance": 1700.0}, cookies=employee_cookies).status_code == 403
    assert app_client.post(f"/api/finance/accounts/{acc['id']}/checkpoints", json={"date": "bad", "balance": 1.0}, cookies=admin_cookies).status_code == 400

    cp = app_client.post(f"/api/finance/accounts/{acc['id']}/checkpoints", json={"date": TODAY, "balance": 1700.0, "note": "from portal"}, cookies=admin_cookies)
    assert cp.status_code == 201, cp.text
    body = cp.json()
    assert body["computed_balance"] == 1500.0 and body["unrecorded_difference"] == 200.0

    # shown on the account, ledger untouched
    got = app_client.get(f"/api/finance/accounts/{acc['id']}", cookies=admin_cookies).json()
    assert got["latest_checkpoint"]["unrecorded_difference"] == 200.0
    assert got["current_balance"] == 1500.0
    txs = app_client.get(f"/api/finance/accounts/{acc['id']}/transactions", cookies=admin_cookies).json()
    assert len(txs) == 1

    # attachment on the checkpoint
    up = app_client.post(f"/api/finance/accounts/{acc['id']}/checkpoints/{body['id']}/attachment",
                         files={"file": ("portal.pdf", b"%PDF-1.4 portal", "application/pdf")}, cookies=admin_cookies)
    assert up.status_code == 200 and up.json()["has_attachment"] is True
    dl = app_client.get(f"/api/finance/accounts/{acc['id']}/checkpoints/{body['id']}/attachment", cookies=admin_cookies)
    assert dl.status_code == 200 and dl.content == b"%PDF-1.4 portal"
    assert len(app_client.get(f"/api/finance/accounts/{acc['id']}/checkpoints", cookies=admin_cookies).json()) == 1


# ---------------------------------------------------------------------------------------------------------------
# Regression gate: Local-only data, every report identical for book omitted / local / consolidated
# ---------------------------------------------------------------------------------------------------------------
def test_regression_gate_local_only_reports_identical(app_client, admin_cookies, core_reports_env):
    env = core_reports_env
    # extend the dataset: a second Local account, an FX transfer, an invoice receipt and a cash withdrawal cheque
    egp = _account(app_client, admin_cookies, "Gate EGP", "EGP", opening=100000.0)
    cash = app_client.post("/api/finance/accounts", json={"account_name": f"Gate Cash {_n['v']}", "account_number": "CASHGATE1", "currency": "EGP", "account_type": "cash"}, cookies=admin_cookies).json()
    fx = app_client.post("/api/finance/transfers", json={
        "from_account_id": env["account_id"], "to_account_id": egp["id"], "date": TODAY, "from_amount": 100.0, "from_currency": "USD",
        "fx_rate": 49.0, "transfer_type": "same_bank_fx", "exchange_reference": "GATE-FX"}, cookies=admin_cookies)
    assert fx.status_code == 201, fx.text
    chq = app_client.post("/api/finance/cheques", json={
        "account_id": egp["id"], "cheque_number": "GATE-1", "issue_date": TODAY, "amount": 1000.0, "currency": "EGP",
        "payee": "Cash", "purpose_type": "cash_withdrawal", "destination_cash_account_id": cash["id"]}, cookies=admin_cookies)
    assert chq.status_code == 201, chq.text
    cust = make_customer(app_client, admin_cookies, "Gate Customer")
    inv = create_invoice(app_client, admin_cookies, cust, amount=700.0, send=True, expected_bank_account_id=env["account_id"])
    receipt(app_client, admin_cookies, inv["id"], env["account_id"], 300.0)

    calls = [
        ("summary", dict(period="ALL", currency="ALL")),
        ("summary", dict(period="ALL", currency="USD", basis="accrual")),
        ("summary", dict(period="YTD", currency="EGP")),
        ("transactions", {}),
        ("category-summary", {}),
        ("category-by-period-matrix", dict(year=YEAR)),
        ("balances", dict(as_of_date=TODAY)),
        ("cheques", dict(fiscal_year=YEAR)),
        ("profit-and-loss", dict(currency="USD", date_from=f"{YEAR}-01-01", date_to=TODAY)),
        ("profit-and-loss", dict(currency="ALL", date_from=f"{YEAR}-01-01", date_to=TODAY, basis="accrual")),
        ("balance-sheet", dict(currency="USD", as_of_date=TODAY)),
        ("trial-balance", dict(currency="ALL", as_of_date=TODAY)),
        ("cash-flow", dict(currency="USD", date_from=f"{YEAR}-01-01", date_to=TODAY)),
        ("ar-aging", dict(currency="USD", as_of_date=TODAY)),
        ("ap-aging", dict(currency="USD", as_of_date=TODAY)),
        ("cash-forecast", dict(currency="all", horizon_days=90)),
        ("attention-queue", {}),
    ]
    for path, params in calls:
        base = _strip(_get(app_client, admin_cookies, path, **params))
        for view in ("local", "consolidated"):
            got = _strip(_get(app_client, admin_cookies, path, book=view, **params))
            assert got == base, f"{path} {params} differs for book={view}"

    # the Overseas view of the same data is empty of Local money
    ov = _get(app_client, admin_cookies, "summary", period="ALL", currency="USD", book="overseas")
    assert ov["balance"] == 0.0 and ov["revenue_mtd"] == 0.0 and ov["cost_mtd"] == 0.0
    assert _get(app_client, admin_cookies, "transactions", book="overseas")["transactions"] == []

    assert app_client.get("/api/finance/reports/summary?book=bogus", cookies=admin_cookies).status_code == 400


# ---------------------------------------------------------------------------------------------------------------
# Worked example (plan 23 section 2)
# ---------------------------------------------------------------------------------------------------------------
@pytest.fixture
def worked_example(app_client, admin_cookies):
    l_egp = _account(app_client, admin_cookies, "WE Local EGP", "EGP", book="local")
    l_usd = _account(app_client, admin_cookies, "WE Local USD", "USD", book="local")
    o_usd = _account(app_client, admin_cookies, "WE Overseas USD", "USD", book="overseas")
    _tx(app_client, admin_cookies, l_egp["id"], "in", 500000.0, "EGP", "Local receipts")
    _tx(app_client, admin_cookies, o_usd["id"], "in", 10000.0, "USD", "Overseas client")
    _tx(app_client, admin_cookies, o_usd["id"], "in", 4000.0, "USD", "Stripe payout")
    _tx(app_client, admin_cookies, o_usd["id"], "out", 345.0, "USD", "Tools")
    _tx(app_client, admin_cookies, o_usd["id"], "out", 3000.0, "USD", "External salaries")
    _transfer(app_client, admin_cookies, o_usd["id"], l_usd["id"], 5000.0)
    return {"l_egp": l_egp, "l_usd": l_usd, "o_usd": o_usd}


def _summary(client, cookies, cur, **kw):
    return _get(client, cookies, "summary", period="ALL", currency=cur, **kw)


def test_worked_example_summary_in_each_view(app_client, admin_cookies, worked_example):
    c, k = app_client, admin_cookies
    # Local
    assert _summary(c, k, "EGP", book="local")["revenue_mtd"] == 500000.0
    loc = _summary(c, k, "USD", book="local")
    assert loc["revenue_mtd"] == 5000.0 and loc["cost_mtd"] == 0.0
    assert {"currency": "USD", "side": "revenue", "label": "Income from overseas entity", "amount": 5000.0} in loc["inter_book_lines"]
    # Overseas
    ov = _summary(c, k, "USD", book="overseas")
    assert ov["revenue_mtd"] == 14000.0 and ov["cost_mtd"] == 3345.0
    assert {"currency": "USD", "side": "transfer_out", "label": "Transferred to local entity", "amount": 5000.0} in ov["inter_book_lines"]
    assert _summary(c, k, "EGP", book="overseas")["revenue_mtd"] == 0.0
    # Consolidated eliminates the transfer, and omitting the book gives the same numbers
    for kw in ({"book": "consolidated"}, {}):
        con = _summary(c, k, "USD", **kw)
        assert con["revenue_mtd"] == 14000.0 and con["cost_mtd"] == 3345.0
        assert _summary(c, k, "EGP", **kw)["revenue_mtd"] == 500000.0
    # per-currency columns, never a converted total (D-026)
    all_cur = _summary(c, k, "ALL", book="consolidated")
    assert all_cur["revenue_mtd"] is None
    by = {r["currency"]: r for r in all_cur["by_currency"]}
    assert by["USD"]["revenue"] == 14000.0 and by["EGP"]["revenue"] == 500000.0


def test_worked_example_profit_and_loss_and_cash_flow(app_client, admin_cookies, worked_example):
    c, k = app_client, admin_cookies
    p = dict(currency="USD", date_from=f"{YEAR}-01-01", date_to=TODAY)
    loc = _get(c, k, "profit-and-loss", book="local", **p)
    assert loc["total_revenue"] == 5000.0 and loc["total_expenses"] == 0.0
    assert any(i["category_name"] == "Income from overseas entity" and i["amount"] == 5000.0 for i in loc["revenue_items"])

    ov = _get(c, k, "profit-and-loss", book="overseas", **p)
    assert ov["total_revenue"] == 14000.0 and ov["total_expenses"] == 3345.0
    assert ov["inter_book_items"] == [{"label": "Transferred to local entity", "amount": 5000.0}]
    assert all("local entity" not in i["category_name"].lower() for i in ov["expense_items"])  # not an operating expense

    con = _get(c, k, "profit-and-loss", book="consolidated", **p)
    assert con["total_revenue"] == 14000.0 and con["total_expenses"] == 3345.0 and con["inter_book_items"] == []

    # cash flow still reconciles inside each book, with the inter-book leg on its own line
    for view in ("local", "overseas", "consolidated"):
        cf = _get(c, k, "cash-flow", book=view, **p)
        assert round(cf["beginning_cash_balance"] + cf["net_change_in_cash"] - cf["ending_cash_balance"], 2) == 0.0, view
    ov_cf = _get(c, k, "cash-flow", book="overseas", **p)
    assert any(i["name"] == "Transferred to local entity" and i["amount"] == -5000.0 for i in ov_cf["financing_activities"])


def test_balances_and_account_views_follow_the_book(app_client, admin_cookies, worked_example):
    c, k = app_client, admin_cookies
    names = lambda view: {a["account_name"] for a in _get(c, k, "balances", as_of_date=TODAY, book=view)["accounts"]}
    assert worked_example["o_usd"]["account_name"] in names("overseas")
    assert worked_example["o_usd"]["account_name"] not in names("local")
    assert worked_example["l_usd"]["account_name"] in names("local")
    assert {worked_example["o_usd"]["account_name"], worked_example["l_usd"]["account_name"]} <= names("consolidated")
    forecast = _get(c, k, "cash-forecast", currency="all", book="overseas")
    assert {a["account_name"] for a in forecast["accounts"]} == {worked_example["o_usd"]["account_name"]}


def test_intercompany_receipt_is_relabelled_in_local_and_eliminated_in_consolidated(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "IC Local USD", "USD", book="local")
    cust_resp = app_client.post("/api/finance/customers", json={"name": "Overseas Entity Inc", "is_intercompany": True}, cookies=admin_cookies)
    assert cust_resp.status_code == 201 and cust_resp.json()["is_intercompany"] is True
    cust = cust_resp.json()["id"]
    inv = create_invoice(app_client, admin_cookies, cust, amount=800.0, send=True, expected_bank_account_id=acc["id"])
    receipt(app_client, admin_cookies, inv["id"], acc["id"], 800.0)

    loc = _summary(app_client, admin_cookies, "USD", book="local")
    assert any(l["label"] == "Income from overseas entity" and l["amount"] == 800.0 for l in loc["inter_book_lines"])
    before = _summary(app_client, admin_cookies, "USD", book="consolidated")["revenue_mtd"]
    legacy = _summary(app_client, admin_cookies, "USD")["revenue_mtd"]
    assert legacy - before == 800.0  # omitted = legacy counts it; consolidated eliminates it
