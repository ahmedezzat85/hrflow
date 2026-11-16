"""FM-2 tools against a fake HRFlow: caps, cursors, filters done in the tool, whitelisting and GET-only."""
import json

import httpx
import pytest

import finance_records as fr
from hrflow_client import HRFlowClient, HRFlowError

BILLS = [{"id": i, "bill_number": f"BILL-23-{i:03d}", "vendor_name": "Acme" if i % 2 else "Beta", "issue_date": f"2023-0{1 + i % 6}-10",
          "due_date": "2023-12-31", "status": "paid", "total": 10.0 * i, "amount_paid": 10.0 * i, "remaining_balance": 0,
          "currency": "EGP", "category_name": "Rent", "book": "local", "paid_from_account_name": "Main" if i % 3 else "Cash",
          "book_source": "paid", "capture_source": "import", "import_batch_id": 4, "created_by": "someone@x.test",
          "attachment_url": "secret/path.pdf"} for i in range(1, 251)]


@pytest.fixture
def backend():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        p, q = request.url.path, dict(request.url.params)
        off, lim = int(q.get("offset", 0)), int(q.get("limit", 50))
        if p == "/api/finance/accounts":
            return httpx.Response(200, json=[{"id": 1, "account_name": "Main", "currency": "EGP", "book_code": "local",
                                              "account_type": "bank", "is_active": True, "account_number": "SECRET"}])
        if p == "/api/finance/vendors":
            rows = [{"id": 9, "name": "Acme", "is_active": True, "tax_id": "TAX-SECRET", "contact_email": "a@x.test",
                     "default_category_name": "Rent"}, {"id": 10, "name": "Beta", "is_active": False}]
            if "search" in q:
                rows = [v for v in rows if q["search"].lower() in v["name"].lower()]
            return httpx.Response(200, json=rows[off:off + lim])
        if p == "/api/finance/bills":
            rows = BILLS
            if "vendor_id" in q:
                rows = [b for b in rows if b["vendor_name"] == "Acme"]
            return httpx.Response(200, json=rows[off:off + lim])
        if p == "/api/finance/cheques":
            rows = [{"id": 1, "cheque_number": "C1", "issue_date": "2023-05-01", "amount": 9.0, "currency": "EGP", "status": "cleared",
                     "account_name": "Main", "payee": "Acme", "purpose_type": "vendor_payment", "signer_name": "SECRET SIGNER",
                     "fiscal_year": int(q["fiscal_year"]), "import_batch_id": 4}]
            rows = [r for r in rows if r["fiscal_year"] == 2023]
            return httpx.Response(200, json=rows[off:off + lim])
        if p == "/api/finance/transfers":
            rows = [{"id": i, "date": "2023-03-20", "from_account_name": "USD", "to_account_name": "EGP", "from_amount": 100,
                     "from_currency": "USD", "to_amount": 4800, "to_currency": "EGP", "fx_rate": 48.0, "fee": 1.5,
                     "transfer_type": "same_bank_fx", "settlement_status": "settled", "created_by": "who@x.test"} for i in range(1, 6)]
            return httpx.Response(200, json=rows[off:off + lim])
        if p == "/api/finance/categories":
            return httpx.Response(200, json=[{"id": 1, "name": "Rent", "kind": "cost", "is_active": True}])
        if p == "/api/finance/payment-types":
            return httpx.Response(200, json=[{"id": 1, "name": "Bank Transfer", "code": "bank", "is_active": True}])
        if p == "/api/finance/imports/batches":
            rows = [{"id": i, "kind": "bills", "created_at": "2023-01-01T00:00:00", "manifest_name": "m.xlsx", "archive_name": None,
                     "rows_total": 3, "rows_created": 2, "rows_failed": 1, "created_by": "who@x.test"} for i in range(9, 0, -1)]
            return httpx.Response(200, json=rows[off:off + lim])
        if p == "/api/finance/imports/batches/4/rows":
            return httpx.Response(200, json={"batch": {"id": 4, "kind": "bills", "rows_total": 2, "rows_created": 2, "rows_failed": 0},
                                             "matching_rows": 2, "rows": [{"row_ref": "R1", "created": "bill", "id": 1, "label": "B-1", "x": 1},
                                                                          {"row_ref": "R2", "created": "bill", "id": 2, "label": "B-2"}]})
        return httpx.Response(404, json={"detail": "no"})

    return HRFlowClient("http://hrflow.test", "hrf_x", transport=httpx.MockTransport(handler)), calls


def test_bills_range_prefix_vendor_account_and_whitelist(backend):
    client, _ = backend
    out = fr.finance_list_bills(client, "2023-01-01", "2023-12-31", limit=200)
    assert out["matching_rows"] == 250 and out["returned"] == 200 and out["truncated"] and out["next_cursor"] == "200"
    nxt = fr.finance_list_bills(client, "2023-01-01", "2023-12-31", limit=200, cursor="200")
    assert nxt["returned"] == 50 and not nxt["truncated"]
    blob = json.dumps(out)
    assert "someone@x.test" not in blob and "secret/path" not in blob
    assert out["bills"][0]["import_batch_id"] == 4
    only = fr.finance_list_bills(client, "2023-01-01", "2023-12-31", vendor="acme", number_prefix="BILL-23-00", paid_from_account="main")
    assert only["matching_rows"] > 0 and all(b["vendor"] == "Acme" and b["number"].startswith("BILL-23-00") and b["paid_from_account"] == "Main" for b in only["bills"])


def test_bills_need_a_range_and_a_known_vendor(backend):
    client, _ = backend
    with pytest.raises(HRFlowError):
        fr.finance_list_bills(client, None, "2023-12-31")
    with pytest.raises(HRFlowError):
        fr.finance_list_bills(client, "2023-01-01", "2023-12-31", vendor="Nobody")
    with pytest.raises(HRFlowError):
        fr.finance_list_bills(client, "2023-01-01", "2023-12-31", limit=500)


def test_a_huge_scan_asks_for_a_narrower_question(backend, monkeypatch):
    monkeypatch.setattr(fr, "MAX_SCAN_PAGES", 2)
    with pytest.raises(HRFlowError) as exc:
        fr.finance_list_bills(backend[0], "2023-01-01", "2023-12-31")
    assert "Narrow" in str(exc.value)


def test_cheques_by_year_and_no_signer(backend):
    out = fr.finance_list_cheques(backend[0], "2022-06-01", "2023-12-31", account="Main")
    assert [c["number"] for c in out["cheques"]] == ["C1"] and "SECRET" not in json.dumps(out)
    assert fr.finance_list_cheques(backend[0], "2023-06-01", "2023-12-31")["cheques"] == []


def test_transfers_cursor_and_no_creator(backend):
    client, _ = backend
    first = fr.finance_list_transfers(client, "2023-01-01", "2023-12-31", limit=2)
    assert first["returned"] == 2 and first["truncated"] and first["next_cursor"] == "2"
    last = fr.finance_list_transfers(client, "2023-01-01", "2023-12-31", limit=2, cursor="4")
    assert last["returned"] == 1 and not last["truncated"] and last["next_cursor"] is None
    t = first["transfers"][0]
    assert t["from_amount"] == 100.0 and t["to_amount"] == 4800.0 and t["fx_rate"] == 48.0 and "who@x.test" not in json.dumps(first)


def test_reference_data_names_only(backend):
    client, _ = backend
    vendors = fr.finance_list_reference_data(client, "vendors")
    assert [v["name"] for v in vendors["items"]] == ["Acme", "Beta"]
    blob = json.dumps(vendors) + json.dumps(fr.finance_list_reference_data(client, "accounts"))
    assert "SECRET" not in blob and "a@x.test" not in blob
    assert {k: len(fr.finance_list_reference_data(client, k)["items"]) for k in ("categories", "payment_types")} == {"categories": 1, "payment_types": 1}
    with pytest.raises(HRFlowError):
        fr.finance_list_reference_data(client, "salaries")


def test_import_batches_and_rows(backend):
    client, _ = backend
    out = fr.finance_list_import_batches(client, kind="bills", limit=5)
    assert out["returned"] == 5 and out["truncated"] and "who@x.test" not in json.dumps(out)
    with pytest.raises(HRFlowError):
        fr.finance_list_import_batches(client, kind="payroll")
    with pytest.raises(HRFlowError):
        fr.finance_list_import_batches(client, date_from="2023-01-01")  # a range needs both ends
    rows = fr.finance_get_import_batch_rows(client, 4)
    assert [r["row_ref"] for r in rows["rows"]] == ["R1", "R2"] and "x" not in rows["rows"][0] and not rows["truncated"]


def test_only_gets(backend):
    client, calls = backend
    fr.finance_list_bills(client, "2023-01-01", "2023-12-31", vendor="Acme")
    fr.finance_list_cheques(client, "2023-01-01", "2023-12-31")
    fr.finance_list_transfers(client, "2023-01-01", "2023-12-31", account="Main")
    fr.finance_get_import_batch_rows(client, 4)
    assert {c.method for c in calls} == {"GET"}
