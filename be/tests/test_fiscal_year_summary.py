"""
be/tests/test_fiscal_year_summary.py
FY-1: GET /api/finance/reports/fiscal-year-summary?year=YYYY (calendar year, January to December).
- opening of year N equals closing of year N-1; both agree with /balances on the boundary dates
- opening + money in - money out = closing; empty year; negative closing; multi-currency, no cross-currency sums
- company spend per category and currency agrees with the Category Summary; own-account transfers within the
  same country are excluded from spend but stay in the account figures; to another country they stay in spend
- years before an account's opening date are "no data"; transactions before it are counted as a warning
- inactive accounts appear only when they have activity or a balance
"""
import uuid
import pytest

from db import get_session_factory
from finance.models import (
    AccountTransferDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
)

URL = "/api/finance/reports/fiscal-year-summary"


@pytest.fixture
def db_session(app_client):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def _account(db, name, currency="USD", opening=1000.0, opening_date="2024-01-01", country="Egypt", active=True):
    acc = FinanceBankAccountDB(account_name=f"{name} {uuid.uuid4().hex[:6]}", bank_name="Test Bank",
                               account_number=f"FY-{uuid.uuid4().hex[:8]}", currency=currency, opening_balance=opening,
                               opening_balance_date=opening_date, current_balance=opening, is_active=active, country=country)
    db.add(acc)
    db.flush()
    return acc


def _tx(db, acc, date, amount, direction, category_id=None, **extra):
    db.add(LedgerTransactionDB(account_id=acc.id, date=date, amount=amount, direction=direction, currency=acc.currency,
                               source=extra.pop("source", "manual"), entry_type="standard", category_id=category_id, **extra))


def _category(db, name):
    cat = db.query(TransactionCategoryDB).filter_by(name=name).first()
    if not cat:
        cat = TransactionCategoryDB(name=name, kind="cost", is_active=True, sort_order=50)
        db.add(cat)
        db.flush()
    return cat


def _transfer(db, src, dst, date, amount):
    t = AccountTransferDB(from_account_id=src.id, to_account_id=dst.id, date=date, from_amount=amount,
                          from_currency=src.currency, to_amount=amount, to_currency=dst.currency, transfer_type="internal")
    db.add(t)
    db.flush()
    _tx(db, src, date, amount, "out", source="transfer", linked_transfer_id=t.id)
    _tx(db, dst, date, amount, "in", source="transfer", linked_transfer_id=t.id)


def _fy(app_client, cookies, year):
    res = app_client.get(URL, params={"year": year}, cookies=cookies)
    assert res.status_code == 200, res.text
    return res.json()


def _row(report, acc):
    return next((r for r in report["accounts"] if r["account_id"] == acc.id), None)


def test_opening_equals_previous_closing_and_matches_balances(app_client, admin_cookies, db_session):
    acc = _account(db_session, "Roll", opening=1000.0, opening_date="2024-01-01")
    _tx(db_session, acc, "2024-03-01", 500.0, "in")
    _tx(db_session, acc, "2024-12-31", 100.0, "out")
    _tx(db_session, acc, "2025-01-01", 40.0, "out")
    _tx(db_session, acc, "2025-06-30", 300.0, "in")
    db_session.commit()

    y24, y25 = _row(_fy(app_client, admin_cookies, 2024), acc), _row(_fy(app_client, admin_cookies, 2025), acc)
    assert (y24["opening"], y24["money_in"], y24["money_out"], y24["closing"]) == (1000.0, 500.0, 100.0, 1400.0)
    assert (y25["opening"], y25["money_in"], y25["money_out"], y25["closing"]) == (1400.0, 300.0, 40.0, 1660.0)
    assert y25["opening"] == y24["closing"]
    for r in (y24, y25):
        assert round(r["opening"] + r["money_in"] - r["money_out"], 2) == r["closing"]

    def pit(date):
        rows = app_client.get("/api/finance/reports/balances", params={"as_of_date": date}, cookies=admin_cookies).json()["accounts"]
        return next(a["balance_as_of_date"] for a in rows if a["account_id"] == acc.id)

    assert pit("2024-12-31") == y24["closing"] == y25["opening"]
    assert pit("2025-12-31") == y25["closing"]


def test_a_year_with_no_activity_and_a_negative_closing_balance(app_client, admin_cookies, db_session):
    quiet = _account(db_session, "Quiet", opening=250.0, opening_date="2023-01-01")
    overdrawn = _account(db_session, "Overdrawn", opening=100.0, opening_date="2023-01-01")
    _tx(db_session, overdrawn, "2026-02-01", 450.0, "out")
    db_session.commit()

    q = _row(_fy(app_client, admin_cookies, 2026), quiet)
    assert (q["opening"], q["money_in"], q["money_out"], q["closing"]) == (250.0, 0.0, 0.0, 250.0)
    o = _row(_fy(app_client, admin_cookies, 2026), overdrawn)
    assert o["closing"] == -350.0 and o["money_out"] == 450.0


def test_multi_currency_totals_are_never_added_together(app_client, admin_cookies, db_session):
    usd = _account(db_session, "Multi USD", currency="USD", opening=100.0, opening_date="2023-01-01", country="United States")
    egp = _account(db_session, "Multi EGP", currency="EGP", opening=5000.0, opening_date="2023-01-01")
    _tx(db_session, usd, "2026-05-01", 25.0, "in")
    _tx(db_session, egp, "2026-05-01", 1000.0, "out")
    db_session.commit()

    report = _fy(app_client, admin_cookies, 2026)
    totals = report["currency_totals"]
    assert {"USD", "EGP"} <= set(totals)
    assert _row(report, usd)["closing"] == 125.0 and _row(report, egp)["closing"] == 4000.0
    # each currency total only contains accounts of that currency
    assert totals["USD"]["closing"] == round(sum(r["closing"] for r in report["accounts"] if r["currency"] == "USD" and not r["no_data"]), 2)
    assert totals["EGP"]["closing"] == round(sum(r["closing"] for r in report["accounts"] if r["currency"] == "EGP" and not r["no_data"]), 2)


def test_spend_agrees_with_the_category_summary(app_client, admin_cookies, db_session):
    acc = _account(db_session, "Spender", currency="USD", opening=5000.0, opening_date="2023-01-01", country="United States")
    rent, tools = _category(db_session, "FY Rent"), _category(db_session, "FY Tools")
    _tx(db_session, acc, "2026-02-01", 300.0, "out", category_id=rent.id)
    _tx(db_session, acc, "2026-07-01", 120.0, "out", category_id=tools.id)
    _tx(db_session, acc, "2026-07-02", 80.0, "out", category_id=tools.id)
    _tx(db_session, acc, "2025-12-31", 999.0, "out", category_id=rent.id)   # another year
    db_session.commit()

    spend = _fy(app_client, admin_cookies, 2026)["spend"]["USD"]
    summary = app_client.get("/api/finance/reports/category-summary",
                             params={"date_from": "2026-01-01", "date_to": "2026-12-31", "currency": "USD"},
                             cookies=admin_cookies).json()
    mine = {c["category_name"]: c["total_amount"] for c in spend["categories"] if c["category_name"].startswith("FY ")}
    theirs = {c["category_name"]: c["total_amount"] for c in summary["categories"] if c["category_name"].startswith("FY ")}
    assert mine == theirs == {"FY Rent": 300.0, "FY Tools": 200.0}
    assert spend["total"] + spend["excluded_own_account_same_country"] == summary["total_spent"]


def test_same_country_transfers_stay_in_the_account_but_leave_spend(app_client, admin_cookies, db_session):
    a = _account(db_session, "Cairo A", currency="EGP", opening=10000.0, opening_date="2023-01-01", country="Egypt")
    b = _account(db_session, "Cairo B", currency="EGP", opening=0.0, opening_date="2023-01-01", country="Egypt")
    us = _account(db_session, "US Overseas", currency="EGP", opening=0.0, opening_date="2023-01-01", country="United States")
    _transfer(db_session, a, b, "2026-03-10", 2000.0)    # same country: not spend
    _transfer(db_session, a, us, "2026-03-11", 700.0)    # another country: stays in spend
    db_session.commit()

    report = _fy(app_client, admin_cookies, 2026)
    ra, rb = _row(report, a), _row(report, b)
    # the statement still matches the system: every movement is in the account figures
    assert ra["money_out"] == 2700.0 and rb["money_in"] == 2000.0
    assert round(ra["opening"] + ra["money_in"] - ra["money_out"], 2) == ra["closing"] == 7300.0

    spend = report["spend"]["EGP"]
    cats = {c["category_name"]: c["total_amount"] for c in spend["categories"]}
    assert cats.get("Transfers to another country") == 700.0
    assert spend["excluded_own_account_same_country"] >= 2000.0
    summary = app_client.get("/api/finance/reports/category-summary",
                             params={"date_from": "2026-01-01", "date_to": "2026-12-31", "currency": "EGP"},
                             cookies=admin_cookies).json()
    # nothing is lost: spend plus the excluded same-country transfers is the raw category summary total
    assert round(spend["total"] + spend["excluded_own_account_same_country"], 2) == summary["total_spent"]


def test_years_before_the_opening_date_have_no_data_and_early_transactions_are_flagged(app_client, admin_cookies, db_session):
    acc = _account(db_session, "Late opener", opening=1000.0, opening_date="2025-01-01")
    _tx(db_session, acc, "2024-06-15", 200.0, "in")     # dated before the opening date
    db_session.commit()

    early = _row(_fy(app_client, admin_cookies, 2023), acc)
    assert early["no_data"] is True and early["opening"] is None and early["closing"] is None
    opened = _row(_fy(app_client, admin_cookies, 2025), acc)
    assert opened["no_data"] is False and opened["transactions_before_opening_date"] == 1
    # no_data accounts are left out of the currency totals
    assert "Late opener" not in str(_fy(app_client, admin_cookies, 2023)["currency_totals"])


def test_inactive_accounts_appear_only_with_activity_or_a_balance(app_client, admin_cookies, db_session):
    closed_busy = _account(db_session, "Closed busy", opening=0.0, opening_date="2023-01-01", active=False)
    closed_empty = _account(db_session, "Closed empty", opening=0.0, opening_date="2023-01-01", active=False)
    _tx(db_session, closed_busy, "2025-04-01", 75.0, "in")
    db_session.commit()

    report = _fy(app_client, admin_cookies, 2025)
    assert _row(report, closed_busy) is not None and _row(report, closed_busy)["money_in"] == 75.0
    assert _row(report, closed_empty) is None


def test_permissions_xlsx_and_validation(app_client, admin_cookies, employee_cookies):
    assert app_client.get(URL, params={"year": 2026}).status_code == 401
    assert app_client.get(URL, params={"year": 2026}, cookies=employee_cookies).status_code == 403
    assert app_client.get(URL, cookies=admin_cookies).status_code == 422
    assert app_client.get(URL, params={"year": 1800}, cookies=admin_cookies).status_code == 422
    res = app_client.get(URL, params={"year": 2026, "format": "xlsx"}, cookies=admin_cookies)
    assert res.status_code == 200 and res.content[:2] == b"PK"


def test_shell_export_menu_formats(app_client, admin_cookies, db_session):
    """The report shell export (xlsx, csv) works for this report key and is audited."""
    from finance.services.reports_service import ReportsService
    svc = ReportsService(db_session)
    for fmt in ("xlsx", "csv"):
        data, name, _mime = svc.generate_report_export("fiscal-year-summary", fmt, {"year": "2026"}, user_email="admin@x.test")
        assert data and name.startswith("fiscal-year-summary_") and name.endswith(f".{fmt}")
    assert svc.generate_report_export("fiscal-year-summary", "xlsx", {"year": "2026"})[0][:2] == b"PK"
