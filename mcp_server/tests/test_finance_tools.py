"""Finance tools against a fake HRFlow: validation, caps, cursors, whitelisting and that only GETs are sent."""
import json

import httpx
import pytest

import finance_tools as ft
from hrflow_client import HRFlowError

ACCOUNTS = [
    {"id": 1, "account_name": "Main EGP", "bank_name": "Bank A", "account_number": "****1234", "currency": "EGP",
     "account_type": "bank", "book_code": "local", "visibility": "full", "is_active": True, "opening_balance": 100.0,
     "opening_balance_date": "2023-01-01", "current_balance": 150.5, "iban": "EG00SECRET"},
    {"id": 2, "account_name": "Overseas USD", "bank_name": "Bank B", "account_number": "9999", "currency": "USD",
     "account_type": "bank", "book_code": "overseas", "visibility": "partial", "is_active": True, "opening_balance": 0,
     "current_balance": 40.0, "latest_checkpoint": {"date": "2023-06-30", "balance": 50.0, "computed_balance": 40.0,
                                                    "unrecorded_difference": 10.0, "attachment_name": "secret.pdf"}},
    {"id": 3, "account_name": "Old", "currency": "EGP", "account_type": "cash", "book_code": "local",
     "visibility": "full", "is_active": False, "opening_balance": 0, "current_balance": 0},
]


def _tx(i, date, direction, amount, **extra):
    base = {"id": i, "date": date, "direction": direction, "amount": amount, "currency": "EGP", "category_name": "Rent",
            "payment_type_name": "Bank Transfer", "payee_name": "Landlord", "description": "d", "reference": "r",
            "cheque_number": "", "source": "manual", "running_balance": 1.0, "payee_type": "vendor",
            "linked_bill_id": None, "linked_transfer_id": None, "linked_cheque_id": None}
    base.update(extra)
    return base


@pytest.fixture
def backend():
    calls = []
    txs = [_tx(i, f"2023-0{1 + i // 40}-{1 + i % 28:02d}", "out" if i % 2 else "in", 10.0 + i) for i in range(1, 250)]
    txs.append(_tx(900, "2023-01-05", "out", 5000.0, payee_type="employee", payee_name="Sara Ali", source="payroll",
                   description="salary Sara", category_name="Salaries"))

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        p, q = request.url.path, dict(request.url.params)
        if p == "/api/finance/accounts":
            off, lim = int(q.get("offset", 0)), int(q.get("limit", 50))
            return httpx.Response(200, json=ACCOUNTS[off:off + lim])
        if p == "/api/finance/reports/balances":
            return httpx.Response(200, json={"as_of_date": q["as_of_date"], "currency_totals": {"EGP": 150.5}, "accounts": [
                {"account_id": 1, "account_name": "Main EGP", "bank_name": "Bank A", "account_number": "RAW-NUMBER-1",
                 "currency": "EGP", "account_type": "bank", "book_code": "local", "visibility": "full",
                 "balance_as_of_date": 150.5, "base_year": None, "base_amount": 100.0, "base_source": "account_opening"},
                {"account_id": 2, "account_name": "Overseas USD", "bank_name": "Bank B", "account_number": "RAW-2",
                 "currency": "USD", "account_type": "bank", "book_code": "overseas", "visibility": "partial",
                 "balance_as_of_date": 40.0, "base_year": 2023, "base_amount": 0.0, "base_source": "entered"}]})
        if p == "/api/finance/reports/transactions":
            rows = [t for t in txs if q["date_from"] <= t["date"] <= q["date_to"]]
            if "direction" in q:
                rows = [t for t in rows if t["direction"] == q["direction"]]
            return httpx.Response(200, json={"transactions": rows})
        if p == "/api/finance/reports/fiscal-year-summary":
            return httpx.Response(200, json={"accounts": [{"account_id": 1, "opening": 1.0, "money_in": 2.0, "money_out": 0.5,
                                                          "closing": 2.5, "no_data": False, "account_number": "X"}]})
        if p == "/api/finance/categories":
            return httpx.Response(200, json=[{"id": 7, "name": "Rent"}])
        if p == "/api/finance/payment-types":
            return httpx.Response(200, json=[{"id": 8, "name": "Bank Transfer"}])
        return httpx.Response(404, json={"detail": "no"})

    from hrflow_client import HRFlowClient
    client = HRFlowClient("http://hrflow.test", "hrf_x", transport=httpx.MockTransport(handler))
    return client, calls


def test_accounts_are_whitelisted_and_inactive_hidden(backend):
    client, _ = backend
    out = ft.finance_list_accounts(client)
    assert [a["name"] for a in out["accounts"]] == ["Main EGP", "Overseas USD"]
    text = json.dumps(out)
    assert "1234" not in text and "9999" not in text and "SECRET" not in text and "secret.pdf" not in text
    assert out["accounts"][1]["latest_checkpoint"]["unrecorded_difference"] == 10.0
    assert len(ft.finance_list_accounts(client, include_inactive=True)["accounts"]) == 3


def test_book_is_validated(backend):
    with pytest.raises(HRFlowError):
        ft.finance_list_accounts(backend[0], book="mars")


def test_balances_never_leak_account_numbers_and_show_checkpoint_for_partial_only(backend):
    out = ft.finance_get_balances(backend[0], "2023-07-31")
    assert "RAW-" not in json.dumps(out)
    full, partial = out["accounts"]
    assert "latest_checkpoint" not in full and partial["latest_checkpoint"]["balance"] == 50.0
    assert partial["balance_as_of_date"] == 40.0 and "cached_balance" not in partial  # not today's date


def test_balances_filter_by_name_and_unknown_name_fails(backend):
    assert [a["name"] for a in ft.finance_get_balances(backend[0], "2023-07-31", accounts=["main egp"])["accounts"]] == ["Main EGP"]
    with pytest.raises(HRFlowError):
        ft.finance_get_balances(backend[0], "2023-07-31", accounts=["Nope"])


@pytest.mark.parametrize("bad", [None, "", "31/07/2023", "2023-13-01"])
def test_dates_are_required_and_iso(backend, bad):
    with pytest.raises(HRFlowError):
        ft.finance_get_balances(backend[0], bad)
    with pytest.raises(HRFlowError):
        ft.finance_list_transactions(backend[0], "Main EGP", bad, "2023-12-31")


def test_month_end_caps_and_counts(backend):
    out = ft.finance_get_month_end_balances(backend[0], "main egp", 2023, months=[1, 2])
    assert [m["month"] for m in out["months"]] == ["2023-01", "2023-02"]
    assert out["months"][0]["closing"] == 2.5 and out["months"][0]["transaction_count"] > 0
    assert len(ft.finance_get_month_end_balances(backend[0], "Main EGP", 2023, through_year=2024)["months"]) == 24
    with pytest.raises(HRFlowError):
        ft.finance_get_month_end_balances(backend[0], "Main EGP", 2023, through_year=2025)
    with pytest.raises(HRFlowError):
        ft.finance_get_month_end_balances(backend[0], "Main EGP", 2023, months=[13])


def test_transactions_cap_cursor_and_truncated(backend):
    client, _ = backend
    first = ft.finance_list_transactions(client, "Main EGP", "2023-01-01", "2023-12-31", limit=200)
    assert first["returned"] == 200 and first["truncated"] is True and first["next_cursor"] == "200"
    second = ft.finance_list_transactions(client, "Main EGP", "2023-01-01", "2023-12-31", limit=200, cursor=first["next_cursor"])
    assert second["returned"] == first["matching_rows"] - 200 and second["truncated"] is False and second["next_cursor"] is None
    with pytest.raises(HRFlowError):
        ft.finance_list_transactions(client, "Main EGP", "2023-01-01", "2023-12-31", limit=201)
    with pytest.raises(HRFlowError):
        ft.finance_list_transactions(client, "Main EGP", "2023-01-01", "2023-12-31", cursor="abc")


def test_employee_rows_have_no_names_or_descriptions(backend):
    out = ft.finance_list_transactions(backend[0], "Main EGP", "2023-01-05", "2023-01-05", limit=200)
    row = next(t for t in out["transactions"] if t["id"] == 900)
    assert row["details_withheld"] is True and row["payee"] == "" and row["description"] == ""
    assert "Sara" not in json.dumps(out) and "Salaries" not in json.dumps(out)


def test_amount_filters_and_summary_groups(backend):
    client, _ = backend
    out = ft.finance_list_transactions(client, "Main EGP", "2023-01-01", "2023-12-31", min_amount=100, max_amount=200, limit=200)
    assert out["matching_rows"] > 0 and all(100 <= t["amount"] <= 200 for t in out["transactions"])
    summary = ft.finance_summarize_transactions(client, "Main EGP", "2023-01-01", "2023-12-31", group_by="category")
    assert sum(g["count"] for g in summary["groups"]) == summary["rows_counted"]
    assert ft.WITHHELD in {g["group"] for g in summary["groups"]}
    with pytest.raises(HRFlowError):
        ft.finance_summarize_transactions(client, "Main EGP", "2023-01-01", "2023-12-31", group_by="vendor")


def test_unknown_account_lists_names_only(backend):
    with pytest.raises(HRFlowError) as exc:
        ft.finance_list_transactions(backend[0], "Nope", "2023-01-01", "2023-01-31")
    assert "Main EGP" in str(exc.value) and "1234" not in str(exc.value)


def test_only_get_requests_are_sent(backend):
    client, calls = backend
    ft.finance_list_accounts(client)
    ft.finance_get_balances(client, "2023-07-31")
    ft.finance_get_month_end_balances(client, "Main EGP", 2023, months=[1])
    ft.finance_list_transactions(client, "Main EGP", "2023-01-01", "2023-01-31", category="Rent", payment_type="bank transfer")
    assert calls and {c.method for c in calls} == {"GET"}
