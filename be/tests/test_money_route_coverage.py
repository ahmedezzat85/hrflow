"""
be/tests/test_money_route_coverage.py
Routes that create or reverse money records and had no test (audit 2026-11, finding M-12):
revenue receipt reversal, bill upload from files, bulk salary payment documents, salesperson edits.
"""
import io
import uuid
from datetime import datetime

from employee_test_helpers import set_pay
from finance.models import BillDB, LedgerTransactionDB


# ---- revenue receipt reversal --------------------------------------------------------------------------------------

def _receipt(client, cookies, amount=300.0):
    acc = client.post(
        "/api/finance/accounts",
        json={"account_name": f"Rev {datetime.utcnow().timestamp()}", "bank_name": "HSBC Egypt",
              "account_number": f"REV-{uuid.uuid4().hex[:10]}", "currency": "USD",
              "opening_balance": 1000.0, "account_type": "bank"},
        cookies=cookies,
    ).json()["id"]
    src = client.post("/api/finance/revenue-sources", json={"name": "Consulting", "code": f"C-{uuid.uuid4().hex[:6]}"},
                      cookies=cookies).json()["id"]
    rec = client.post("/api/finance/revenue-receipts",
                      json={"account_id": acc, "date": "2026-10-06", "amount": amount, "currency": "USD",
                            "revenue_source_id": src}, cookies=cookies)
    assert rec.status_code == 201, rec.text
    return acc, rec.json()


def _balance(client, cookies, account_id):
    accounts = client.get("/api/finance/accounts", cookies=cookies).json()
    accounts = accounts.get("items", accounts) if isinstance(accounts, dict) else accounts
    return next(float(a["current_balance"]) for a in accounts if a["id"] == account_id)


def test_reversing_a_receipt_posts_the_opposite_row_and_restores_the_balance(app_client, admin_cookies):
    acc, rec = _receipt(app_client, admin_cookies, 300.0)
    assert _balance(app_client, admin_cookies, acc) == 1300.0

    rev = app_client.post(f"/api/finance/revenue-receipts/{rec['id']}/reverse", json={"reason": "Customer charged twice"},
                          cookies=admin_cookies)
    assert rev.status_code == 201, rev.text
    assert _balance(app_client, admin_cookies, acc) == 1000.0

    from db import get_db_context
    with get_db_context() as db:
        row = db.get(LedgerTransactionDB, rev.json()["id"])
        assert (row.direction, float(row.amount), row.reference) == ("out", 300.0, f"REV-{rec['id']}")
        assert "Customer charged twice" in row.description and row.created_by == "admin@hrflow.test"
        assert row.revenue_source_id == rec["revenue_source_id"]


def test_a_receipt_reverses_only_once_and_a_reversal_cannot_be_reversed(app_client, admin_cookies):
    acc, rec = _receipt(app_client, admin_cookies)
    first = app_client.post(f"/api/finance/revenue-receipts/{rec['id']}/reverse", json={"reason": "wrong"}, cookies=admin_cookies)
    assert first.status_code == 201
    again = app_client.post(f"/api/finance/revenue-receipts/{rec['id']}/reverse", json={"reason": "wrong"}, cookies=admin_cookies)
    assert again.status_code == 400 and "already been reversed" in again.json()["detail"]
    of_rev = app_client.post(f"/api/finance/revenue-receipts/{first.json()['id']}/reverse", json={"reason": "x"},
                             cookies=admin_cookies)
    assert of_rev.status_code in (400, 404)
    assert _balance(app_client, admin_cookies, acc) == 1000.0


def test_reversal_needs_a_reason_and_the_write_permission(app_client, admin_cookies, employee_cookies):
    _, rec = _receipt(app_client, admin_cookies)
    assert app_client.post(f"/api/finance/revenue-receipts/{rec['id']}/reverse", json={"reason": ""},
                           cookies=admin_cookies).status_code == 422
    assert app_client.post(f"/api/finance/revenue-receipts/{rec['id']}/reverse", json={"reason": "x"},
                           cookies=employee_cookies).status_code == 403


# ---- bill upload from files ----------------------------------------------------------------------------------------

def _pdf_bytes(tag):
    return b"%PDF-1.4\n%" + tag.encode() + b"\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def test_uploading_files_makes_one_draft_each_and_refuses_bad_or_repeated_files(app_client, admin_cookies):
    files = [
        ("files", ("invoice-a.pdf", io.BytesIO(_pdf_bytes("a")), "application/pdf")),
        ("files", ("notes.txt", io.BytesIO(b"hello"), "text/plain")),
        ("files", ("empty.pdf", io.BytesIO(b""), "application/pdf")),
    ]
    res = app_client.post("/api/finance/bills/upload", files=files, cookies=admin_cookies)
    assert res.status_code == 200, res.text
    by_name = {r["filename"]: r for r in res.json()["results"]}
    draft = by_name["invoice-a.pdf"]["bill"]
    assert draft and draft["status"] == "draft" and draft["vendor_id"] is None
    assert "Unsupported file type" in by_name["notes.txt"]["error"]
    assert "empty" in by_name["empty.pdf"]["error"]

    from db import get_db_context
    with get_db_context() as db:
        bill = db.get(BillDB, draft["id"])
        assert bill.created_by == "admin@hrflow.test" and bill.attachment_url
        assert not bill.attachment_url.startswith(("/", "\\")) and ":" not in bill.attachment_url[:3]

    again = app_client.post("/api/finance/bills/upload",
                            files=[("files", ("copy.pdf", io.BytesIO(_pdf_bytes("a")), "application/pdf"))],
                            cookies=admin_cookies)
    assert again.json()["results"][0]["duplicate_of"] == draft["id"]


def test_bill_upload_needs_the_write_permission(app_client, employee_cookies):
    res = app_client.post("/api/finance/bills/upload",
                          files=[("files", ("x.pdf", io.BytesIO(_pdf_bytes("x")), "application/pdf"))],
                          cookies=employee_cookies)
    assert res.status_code == 403


# ---- bulk salary payment documents --------------------------------------------------------------------------------

def test_bulk_generation_makes_documents_for_eligible_employees_and_skips_repeats(app_client, admin_cookies, monkeypatch):
    import services.salary_payment_docs as spd
    import services.pdf_converter as pdf
    monkeypatch.setattr(spd, "render_invoice_document", lambda ctx: b"fake-docx-bytes")
    monkeypatch.setattr(pdf, "convert_docx_to_pdf_bytes", lambda b: b"%PDF-1.4 fake-pdf")
    app_client.put("/api/employees/2", json={"invoice_id": "02"}, cookies=admin_cookies)
    set_pay(app_client, admin_cookies, 2, 0.0, 750.0, start="2026-01-01")
    app_client.put("/api/employees/2/personal", json={"legal_name": "Employee Two Legal", "address_line_1": "Test Address"},
                   cookies=admin_cookies)

    body = {"payment_year": 2026, "payment_month": 9, "skip_existing": True}
    first = app_client.post("/api/salary-payment-docs/generate", json=body, cookies=admin_cookies)
    assert first.status_code == 200, first.text
    mine = [r for r in first.json()["results"] if r["employee_id"] == 2]
    assert mine and mine[0]["status"] == "generated"
    assert first.json()["summary"]["generated"] >= 1

    second = app_client.post("/api/salary-payment-docs/generate", json=body, cookies=admin_cookies).json()
    assert [r["status"] for r in second["results"] if r["employee_id"] == 2] == ["already_exists"]
    assert second["summary"]["generated"] == 0


def test_bulk_generation_needs_the_write_permission(app_client, employee_cookies):
    res = app_client.post("/api/salary-payment-docs/generate", json={"payment_year": 2026, "payment_month": 9},
                          cookies=employee_cookies)
    assert res.status_code == 403


# ---- salesperson edits ---------------------------------------------------------------------------------------------

def test_a_salesperson_is_edited_and_deactivated_never_deleted(app_client, admin_cookies, employee_cookies):
    sp = app_client.post("/api/finance/salespeople", json={"name": "Sam Sales"}, cookies=admin_cookies)
    assert sp.status_code == 201, sp.text
    sid = sp.json()["id"]

    upd = app_client.patch(f"/api/finance/salespeople/{sid}",
                           json={"name": "Samira Sales", "settlement_frequency": "monthly", "is_active": False},
                           cookies=admin_cookies)
    assert upd.status_code == 200, upd.text
    assert (upd.json()["name"], upd.json()["settlement_frequency"], upd.json()["is_active"]) == ("Samira Sales", "monthly", False)

    assert app_client.patch(f"/api/finance/salespeople/{sid}", json={"settlement_frequency": "weekly"},
                            cookies=admin_cookies).status_code == 422
    assert app_client.patch("/api/finance/salespeople/999999", json={"name": "Nobody"},
                            cookies=admin_cookies).status_code == 404
    assert app_client.patch(f"/api/finance/salespeople/{sid}", json={"name": "x"},
                            cookies=employee_cookies).status_code == 403
