"""
test_finance_mcp_read.py
FM-1 of the finance MCP tools: the `mcp:finance` token scope and its route allow-list, and the five tools run
end to end (mcp_server/finance_tools.py -> a real token -> this backend) on a seeded dataset: EGP bank, USD bank,
cash, an Overseas partial account with a checkpoint, an import batch and a posted FX transfer.
"""
import hashlib
import json
import os
import sys
import uuid
from datetime import datetime

import httpx
import pytest
from sqlalchemy import text

import api_tokens
from conftest import add_test_user
from db import get_db_context, get_session_factory
from finance import books
from finance.models import (
    AccountBalanceCheckpointDB, AccountTransferDB, FinanceBankAccountDB, ImportBatchDB, LedgerTransactionDB,
    TransactionCategoryDB,
)
from finance.repositories.ledger_repository import LedgerRepository

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "mcp_server"))
import finance_tools  # noqa: E402
from hrflow_client import HRFlowClient, HRFlowError  # noqa: E402

SECRET_NUMBER = "ACCT-NO-SECRET-"
ALLOWED_GETS = [
    "/api/finance/accounts", "/api/finance/accounts/1/transactions", "/api/finance/accounts/1/checkpoints",
    "/api/finance/reports/balances", "/api/finance/reports/fiscal-year-summary?year=2023",
    "/api/finance/reports/transactions", "/api/finance/reports/category-summary",
    "/api/finance/categories", "/api/finance/payment-types",
]


def _secret(scopes=("mcp:finance",), role_key="super_admin", email="fin-admin@hrflow.test"):
    with get_db_context() as db:
        uid = add_test_user(db, email, role_key=role_key, employee_id=1)
        _, secret = api_tokens.create_token(db, uid, "test", list(scopes), 30)
        return secret


def _bearer(secret):
    return {"Authorization": f"Bearer {secret}"}


class _ToApp(httpx.BaseTransport):
    """Sends the MCP client's requests into the FastAPI test client, so the real token path is exercised."""

    def __init__(self, client):
        self.client = client

    def handle_request(self, request):
        r = self.client.request(request.method, request.url.raw_path.decode(), headers=dict(request.headers),
                                content=request.content)
        return httpx.Response(r.status_code, headers={"content-type": "application/json"}, content=r.content)


def _mcp_client(app_client, secret):
    return HRFlowClient("http://testserver", secret, transport=_ToApp(app_client))


@pytest.fixture
def seeded(app_client):
    session = get_session_factory()()
    ids = {}
    try:
        b = books.ensure_books(session)

        def account(key, name, currency, atype="bank", opening=1000.0, book="local", visibility="full"):
            acc = FinanceBankAccountDB(account_name=name, bank_name="Bank " + key, account_number=SECRET_NUMBER + key,
                                       currency=currency, opening_balance=opening, opening_balance_date="2023-01-01",
                                       current_balance=opening, account_type=atype, book_id=b[book].id, visibility=visibility)
            session.add(acc)
            session.flush()
            ids[key] = acc.id
            return acc

        egp = account("egp", "Cash Book EGP", "EGP")
        usd = account("usd", "Cash Book USD", "USD", opening=500.0)
        cash = account("cash", "Petty Cash", "EGP", atype="cash", opening=200.0)
        ovs = account("ovs", "Overseas Partial", "USD", opening=0.0, book="overseas", visibility="partial")
        cat = session.query(TransactionCategoryDB).first() or TransactionCategoryDB(name="Rent")
        session.add(cat)
        session.flush()

        def tx(acc, date, amount, direction, **kw):
            row = LedgerTransactionDB(account_id=acc.id, date=date, amount=amount, direction=direction, currency=acc.currency,
                                      source=kw.pop("source", "manual"), entry_type="standard", category_id=cat.id,
                                      description=kw.pop("description", "row"), reference=kw.pop("reference", ""), **kw)
            session.add(row)
            return row

        tx(egp, "2023-01-10", 100.0, "out", description="January rent")
        tx(egp, "2023-02-05", 300.0, "in", reference="INV-1")
        tx(egp, "2023-02-20", 50.0, "out", payee_type="employee", payee_name="Sara Ali", source="payroll", description="salary Sara")
        tx(egp, "2023-03-15", 25.0, "out")
        tx(usd, "2023-02-01", 40.0, "in")
        tx(cash, "2023-02-02", 10.0, "out")
        tx(ovs, "2023-03-03", 70.0, "in")
        session.add(ImportBatchDB(kind="bills", created_by="x", rows_total=2, rows_created=2, created_at=datetime.utcnow()))
        # a posted FX transfer: 100 USD out of the USD account, 4800 EGP into the EGP account
        tr = AccountTransferDB(from_account_id=usd.id, to_account_id=egp.id, date="2023-03-20", from_amount=100.0,
                               from_currency="USD", to_amount=4800.0, to_currency="EGP", fx_rate=48.0, transfer_type="same_bank_fx")
        session.add(tr)
        session.flush()
        tx(usd, "2023-03-20", 100.0, "out", source="transfer", linked_transfer_id=tr.id)
        tx(egp, "2023-03-20", 4800.0, "in", source="transfer", linked_transfer_id=tr.id)
        session.flush()
        for a in (egp, usd, cash, ovs):
            LedgerRepository(session).recalculate_account_running_balances(a.id)
        session.add(AccountBalanceCheckpointDB(account_id=ovs.id, date="2023-06-30", balance=90.0, note="statement"))
        session.commit()
    finally:
        session.close()
    return ids


def _digest():
    """A hash of every row of every table: any write, even an updated_at touch, changes it."""
    with get_db_context() as db:
        h = hashlib.sha256()
        tables = [r[0] for r in db.execute(text("select name from sqlite_master where type='table' order by name"))]
        for t in tables:
            if t in ("api_tokens", "auth_sessions"):
                continue  # last_used_at on the token is the only thing authentication may touch
            for row in db.execute(text(f'select * from "{t}" order by 1')):
                h.update(repr(tuple(row)).encode())
        return h.hexdigest()


# ---- scope and route allow-list ---------------------------------------------------------------------------------

def test_scope_grants_only_four_read_permissions(app_client):
    secret = _secret()
    me = app_client.get("/api/auth/me", headers=_bearer(secret)).json()
    assert set(me["permissions"]) == {"finance.account.read", "finance.report.read", "finance.bill.read", "finance.vendor.read"}


def test_listed_routes_are_reachable(app_client, seeded):
    secret = _secret()
    for path in ALLOWED_GETS:
        assert app_client.get(path, headers=_bearer(secret)).status_code == 200, path


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/finance/accounts"),
    ("GET", "/api/finance/accounts/1"),                       # not listed (and the reveal flag lives here)
    ("GET", "/api/finance/vendors/1/payment-instructions"),   # vendor bank details
    ("GET", "/api/finance/vendors/1/360"),
    ("GET", "/api/finance/bills/1/attachment"),
    ("GET", "/api/finance/bills/summary"),
    ("POST", "/api/finance/bills"),
    ("POST", "/api/finance/imports/bills"),
    ("GET", "/api/finance/transfers/1"),
    ("GET", "/api/finance/reports/compensation/company"),     # finance.report.read would open it; the allow-list does not
    ("GET", "/api/finance/reports/profit-and-loss"),
    ("GET", "/api/finance/accounts/1/checkpoints/1/attachment"),
    ("GET", "/api/finance/reports/balances?format=xlsx"),
    ("POST", "/api/finance/accounts/1/transactions"),
])
def test_everything_else_under_finance_is_forbidden(app_client, seeded, method, path):
    secret = _secret()
    assert app_client.request(method, path, headers=_bearer(secret), json={}).status_code == 403


def test_a_token_without_the_finance_scope_gets_no_finance_data(app_client, seeded):
    secret = _secret(scopes=("mcp:read",), email="reader@hrflow.test")
    assert app_client.get("/api/finance/accounts", headers=_bearer(secret)).status_code == 403
    assert app_client.get("/api/employees", headers=_bearer(secret)).status_code == 200  # HR scope unchanged


def test_a_user_without_finance_permission_gets_an_error_not_data(app_client, seeded):
    secret = _secret(role_key="employee", email="plain@hrflow.test")
    assert app_client.get("/api/finance/accounts", headers=_bearer(secret)).status_code == 403


def test_the_finance_scope_cannot_reach_hr_routes(app_client):
    secret = _secret()
    assert app_client.get("/api/employees", headers=_bearer(secret)).status_code == 403


# ---- the tools end to end ---------------------------------------------------------------------------------------

def test_balances_match_the_report_service_and_month_end_matches_cached(app_client, seeded):
    client = _mcp_client(app_client, _secret())
    out = finance_tools.finance_get_balances(client, "2023-12-31")
    from finance.services.reports_service import ReportsService
    with get_db_context() as db:
        expected = ReportsService(db).get_point_in_time_balances(as_of_date="2023-12-31")
    want = {a["account_name"]: a["balance_as_of_date"] for a in expected["accounts"]}
    got = {a["name"]: a["balance_as_of_date"] for a in out["accounts"]}
    assert got == {k: round(v, 2) for k, v in want.items()}

    month_end = finance_tools.finance_get_month_end_balances(client, "Cash Book EGP", 2023)
    stored = {a["name"]: a["current_balance"] for a in finance_tools.finance_list_accounts(client)["accounts"]}
    assert month_end["months"][-1]["closing"] == stored["Cash Book EGP"]
    assert [m["closing"] for m in month_end["months"][:2]] == [900.0, 1150.0]  # Jan, Feb (Feb: +300 -50)
    assert sum(m["transaction_count"] for m in month_end["months"]) == 5
    for earlier, later in zip(month_end["months"], month_end["months"][1:]):
        assert earlier["closing"] == later["opening"]


def test_partial_account_shows_checkpoint_and_difference_as_the_app_does(app_client, seeded):
    client = _mcp_client(app_client, _secret())
    ovs = next(a for a in finance_tools.finance_list_accounts(client)["accounts"] if a["name"] == "Overseas Partial")
    assert ovs["book"] == "overseas" and ovs["visibility"] == "partial"
    assert ovs["latest_checkpoint"]["balance"] == 90.0 and ovs["latest_checkpoint"]["unrecorded_difference"] == 20.0
    bal = finance_tools.finance_get_balances(client, "2023-12-31", accounts=["overseas partial"])["accounts"][0]
    assert bal["balance_as_of_date"] == 70.0 and bal["latest_checkpoint"]["unrecorded_difference"] == 20.0
    assert [a["name"] for a in finance_tools.finance_get_balances(client, "2023-12-31", book="overseas")["accounts"]] == ["Overseas Partial"]


def test_transactions_totals_links_and_employee_rows(app_client, seeded):
    client = _mcp_client(app_client, _secret())
    out = finance_tools.finance_list_transactions(client, "Cash Book EGP", "2023-01-01", "2023-12-31")
    assert out["matching_rows"] == 5 and out["currency"] == "EGP" and out["truncated"] is False
    assert out["total_in"] == 5100.0 and out["total_out"] == 175.0
    fx = next(t for t in out["transactions"] if t["source"] == "transfer")
    assert fx["linked_transfer_id"] is not None and fx["amount"] == 4800.0
    sara = next(t for t in out["transactions"] if t["details_withheld"])
    assert sara["payee"] == "" and sara["description"] == "" and "Sara" not in json.dumps(out)
    only_in = finance_tools.finance_list_transactions(client, "Cash Book EGP", "2023-01-01", "2023-12-31", direction="in", text="INV")
    assert [t["reference"] for t in only_in["transactions"]] == ["INV-1"]
    by_month = finance_tools.finance_summarize_transactions(client, "Cash Book EGP", "2023-01-01", "2023-12-31")
    assert [g["group"] for g in by_month["groups"]] == ["2023-01", "2023-02", "2023-03"]


def test_no_account_number_or_iban_in_any_response(app_client, seeded):
    client = _mcp_client(app_client, _secret())
    blob = json.dumps([
        finance_tools.finance_list_accounts(client, include_inactive=True),
        finance_tools.finance_get_balances(client, "2023-12-31"),
        finance_tools.finance_get_month_end_balances(client, "Cash Book USD", 2023),
        finance_tools.finance_list_transactions(client, "Cash Book USD", "2023-01-01", "2023-12-31"),
        finance_tools.finance_summarize_transactions(client, "Cash Book USD", "2023-01-01", "2023-12-31", group_by="direction"),
    ])
    for forbidden in (SECRET_NUMBER, "account_number", "iban", "IBAN"):
        assert forbidden not in blob


def test_an_unknown_account_is_an_error(app_client, seeded):
    with pytest.raises(HRFlowError):
        finance_tools.finance_list_transactions(_mcp_client(app_client, _secret()), "Nope", "2023-01-01", "2023-01-31")


def test_every_tool_leaves_the_database_unchanged(app_client, seeded):
    secret = _secret()
    client = _mcp_client(app_client, secret)
    before = _digest()
    finance_tools.finance_list_accounts(client, include_inactive=True)
    finance_tools.finance_get_balances(client, "2023-12-31")
    finance_tools.finance_get_balances(client, datetime.utcnow().strftime("%Y-%m-%d"))
    finance_tools.finance_get_month_end_balances(client, "Cash Book EGP", 2023, through_year=2024)
    finance_tools.finance_list_transactions(client, "Cash Book EGP", "2023-01-01", "2023-12-31")
    finance_tools.finance_summarize_transactions(client, "Overseas Partial", "2023-01-01", "2023-12-31", group_by="category")
    for path in ALLOWED_GETS:
        app_client.get(path, headers=_bearer(secret))
    assert _digest() == before
