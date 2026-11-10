"""
be/tests/test_finance_import_paid_bills.py
D-052 (plan: docs/finance-module/import-paid-bills-and-transfers-plan.md): the bills importer can create bills that
are already paid, and record a subscription bill as that subscription's charge.

Synthetic data only. A paid row posts exactly one outflow in the paying account, so an overseas account's book (and
only that book) sees it; a commit with such rows needs an explicit confirmation.
"""
import io

import pytest

from bill_test_helpers import make_vendor
from import_test_helpers import build_zip, manifest_csv, post_import, text_pdf
from test_finance_books import _account
from test_finance_subscriptions_v2 import _sub

from finance.subscription_naming import subscription_bill_number


@pytest.fixture(autouse=True)
def _own_files_root(monkeypatch, tmp_path):
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path / "files"))


def _category_name():
    from db import get_db_context
    from finance.models import TransactionCategoryDB

    with get_db_context() as db:
        return db.query(TransactionCategoryDB).filter(TransactionCategoryDB.is_active == True).first().name  # noqa: E712


def _row(n, account_name, **extra):
    row = {"row_ref": f"P-{n:04d}", "source_file": f"bill-{n:04d}.pdf", "vendor_name": "Paid Vendor Co",
           "bill_number": f"PD-{n:03d}", "issue_date": "2023-03-05", "due_date": "2023-03-05", "currency": "USD",
           "category": _category_name(), "total_amount": "100.00", "description": "Hosting",
           "paid_date": "2023-03-06", "paid_from_account": account_name}
    row.update(extra)
    return row


def _pdfs(*numbers):
    return {f"bill-{n:04d}.pdf": text_pdf("Paid Vendor Co", f"PD-{n:03d}", 100.0, issue="2023-03-05", due="2023-03-05") for n in numbers}


def _post(client, cookies, rows, files, commit=False, confirm=False):
    manifest = manifest_csv("bills", rows)
    archive = build_zip(files)
    if commit and confirm:
        return client.post(
            "/api/finance/imports/bills",
            files={"manifest": ("manifest.csv", io.BytesIO(manifest), "text/csv"), "archive": ("package.zip", io.BytesIO(archive), "application/zip")},
            data={"confirm_posting": "true"},
            cookies=cookies,
        )
    return post_import(client, cookies, "bills", manifest, archive, commit=commit)


def _balance(client, cookies, account_id):
    return client.get(f"/api/finance/accounts/{account_id}", cookies=cookies).json()["current_balance"]


def _codes(report, i=0):
    return [f["code"] for f in report["rows"][i]["findings"]]


def _counts():
    from db import get_db_context
    from finance.models import BillDB, LedgerTransactionDB, PaymentDB, SubscriptionChargeDB

    with get_db_context() as db:
        return {m.__tablename__: db.query(m).count() for m in (BillDB, LedgerTransactionDB, PaymentDB, SubscriptionChargeDB)}


# ── Naming ──────────────────────────────────────────────────────────────────
def test_subscription_bill_number_follows_id_name_date():
    assert subscription_bill_number(7, "GitHub Team", "2023-03-05") == "SUB-7-GitHub_Team-20230305"
    assert subscription_bill_number(7, "  Adobe   Creative Cloud ", "2023-03-05") == "SUB-7-Adobe_Creative_Cloud-20230305"
    assert subscription_bill_number(7, "A/B & C!", "2023-03-05") == "SUB-7-AB_C-20230305"
    assert subscription_bill_number(7, "", "2023-03-05") == "SUB-7-20230305"
    long = subscription_bill_number(12, "x" * 200, "2023-03-05")
    assert len(long) == 50 and long.startswith("SUB-12-") and long.endswith("-20230305")


# ── Paid bills ──────────────────────────────────────────────────────────────
def test_dry_run_flags_posting_and_writes_nothing(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Paid Vendor Co")
    acc = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=1000.0)
    before = _counts()
    resp = _post(app_client, admin_cookies, [_row(1, acc["account_name"])], _pdfs(1))
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert report["rows_posting"] == 1 and report["rows"][0]["status"] == "warning", report
    assert "will_post_ledger" in _codes(report)
    assert _counts() == before and _balance(app_client, admin_cookies, acc["id"]) == 1000.0


def test_commit_needs_confirmation_then_pays_from_the_overseas_account_only(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Paid Vendor Co")
    acc = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=1000.0)
    before = _counts()

    refused = _post(app_client, admin_cookies, [_row(1, acc["account_name"])], _pdfs(1), commit=True)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "posting_confirmation_required"
    assert _counts() == before

    resp = _post(app_client, admin_cookies, [_row(1, acc["account_name"])], _pdfs(1), commit=True, confirm=True)
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert report["rows_created"] == 1, report
    bill = app_client.get(f"/api/finance/bills/{report['rows'][0]['created_id']}", cookies=admin_cookies).json()
    assert bill["status"] == "paid" and bill["capture_source"] == "import" and bill["is_reviewed"] is False
    assert bill["total"] == 100.0 and bill["attachment_url"]
    assert _balance(app_client, admin_cookies, acc["id"]) == 900.0
    after = _counts()
    assert after["finance_ledger_transactions"] == before["finance_ledger_transactions"] + 1
    assert after["finance_payments"] == before["finance_payments"] + 1

    # the bill belongs to the Overseas book (the book of the account that paid it) and not to Local
    from db import get_db_context
    from finance import books
    from finance.models import BillDB

    with get_db_context() as db:
        bills = db.query(BillDB).filter(BillDB.id == bill["id"]).all()
        assert [b.id for b in books.filter_bills(db, books.resolve(db, "overseas"), bills)] == [bill["id"]]
        assert books.filter_bills(db, books.resolve(db, "local"), bills) == []

    # sending the same package again creates nothing
    again = _post(app_client, admin_cookies, [_row(1, acc["account_name"])], _pdfs(1), commit=True, confirm=True).json()
    assert again["rows_created"] == 0 and again["rows"][0]["status"] == "duplicate"
    assert _balance(app_client, admin_cookies, acc["id"]) == 900.0


def test_rows_without_payment_columns_stay_unposted_drafts(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Paid Vendor Co")
    acc = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=1000.0)
    row = _row(1, acc["account_name"], paid_date="", paid_from_account="")
    before = _counts()
    resp = _post(app_client, admin_cookies, [row], _pdfs(1), commit=True)  # no confirmation needed: nothing posts
    assert resp.status_code == 200, resp.text
    bill = app_client.get(f"/api/finance/bills/{resp.json()['rows'][0]['created_id']}", cookies=admin_cookies).json()
    assert bill["status"] == "draft"
    assert _counts()["finance_ledger_transactions"] == before["finance_ledger_transactions"]
    assert _balance(app_client, admin_cookies, acc["id"]) == 1000.0


@pytest.mark.parametrize("extra,code", [
    ({"paid_from_account": ""}, "payment_incomplete"),
    ({"paid_date": ""}, "payment_incomplete"),
    ({"paid_date": "05/03/2023"}, "paid_date_invalid"),
    ({"paid_from_account": "No Such Account"}, "account_unknown"),
    ({"currency": "EGP"}, "currency_mismatch"),
    ({"payment_type": "CHK"}, "payment_type_cheque"),
    ({"payment_type": "Nonsense"}, "payment_type_unknown"),
    ({"category": ""}, "not_ready_to_pay"),
    ({"total_amount": ""}, "total_required_to_pay"),
])
def test_paid_row_errors(app_client, admin_cookies, extra, code):
    make_vendor(app_client, admin_cookies, "Paid Vendor Co")
    acc = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=1000.0)
    row = _row(1, acc["account_name"], **extra)
    resp = _post(app_client, admin_cookies, [row], _pdfs(1))
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert report["rows"][0]["status"] == "error" and code in _codes(report), report


def test_payment_type_alone_is_an_error_and_balance_is_counted_across_rows(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Paid Vendor Co")
    acc = _account(app_client, admin_cookies, "Small USD", "USD", book="overseas", opening=150.0)
    alone = _post(app_client, admin_cookies, [_row(1, acc["account_name"], paid_date="", paid_from_account="", payment_type="OUTBOUND_TRANS")], _pdfs(1)).json()
    assert "payment_incomplete" in _codes(alone)

    two = _post(app_client, admin_cookies, [_row(1, acc["account_name"]), _row(2, acc["account_name"])], _pdfs(1, 2)).json()
    assert two["rows"][0]["status"] == "warning" and two["rows"][1]["status"] == "error"
    assert "insufficient_balance" in _codes(two, 1)
    assert two["rows_posting"] == 1


def test_a_duplicate_vendor_and_number_is_not_paid_twice(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Paid Vendor Co")
    acc = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=1000.0)
    manual = {"row_ref": "X-1", "source_file": "", "vendor_name": "Paid Vendor Co", "bill_number": "PD-001"}
    first = _post(app_client, admin_cookies, [_row(1, acc["account_name"], source_file="")], {}, commit=True, confirm=True)
    assert first.status_code == 200 and first.json()["rows_created"] == 1, first.text
    dup = _post(app_client, admin_cookies, [_row(1, acc["account_name"], row_ref="P-0002", source_file="")], {}).json()
    assert dup["rows"][0]["status"] == "duplicate"
    assert manual  # keeps flake8 quiet about the unused sketch above


# ── Subscription charges ────────────────────────────────────────────────────
def test_subscription_row_records_a_settled_charge_with_the_subscription_bill_number(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=1000.0)
    sub = _sub(app_client, admin_cookies, account_id=acc["id"], months_back=-1)  # renewal in the future: no auto charges
    row = {"row_ref": "S-0001", "source_file": "bill-0001.pdf", "vendor_name": "", "bill_number": "VENDOR-INV-77",
           "issue_date": "2023-03-05", "due_date": "", "currency": "", "category": "", "total_amount": "95.00",
           "description": "Seats", "paid_date": "2023-03-05", "paid_from_account": acc["account_name"], "subscription": sub["name"]}
    before = _counts()
    resp = _post(app_client, admin_cookies, [row], {"bill-0001.pdf": text_pdf("Vendor", "VENDOR-INV-77", 95.0, issue="2023-03-05", due="2023-03-05")}, commit=True, confirm=True)
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert report["rows_created"] == 1, report
    bill = app_client.get(f"/api/finance/bills/{report['rows'][0]['created_id']}", cookies=admin_cookies).json()
    expected_number = subscription_bill_number(sub["id"], sub["name"], "2023-03-05")
    assert bill["bill_number"] == expected_number and " " not in expected_number
    assert bill["status"] == "paid" and bill["capture_source"] == "import" and bill["is_reviewed"] is False
    assert "VENDOR-INV-77" in (bill["notes"] or "")
    assert bill["legal_entity"] == "Voyance Egypt LLC"

    charges = app_client.get(f"/api/finance/subscriptions/charges?subscription_id={sub['id']}", cookies=admin_cookies).json()
    charge = next(c for c in charges if c["billing_date"] == "2023-03-05")
    assert charge["status"] == "settled" and charge["amount"] == 95.0 and charge["linked_bill_id"] == bill["id"]
    assert charge["linked_transaction_id"] and charge["proof_status"] == "attached"
    assert _balance(app_client, admin_cookies, acc["id"]) == 905.0
    assert _counts()["finance_subscription_charges"] == before["finance_subscription_charges"] + 1

    # the same package again: duplicate, nothing paid twice
    again = _post(app_client, admin_cookies, [row], {"bill-0001.pdf": text_pdf("Vendor", "VENDOR-INV-77", 95.0, issue="2023-03-05", due="2023-03-05")}, commit=True, confirm=True).json()
    assert again["rows_created"] == 0 and again["rows"][0]["status"] == "duplicate"
    assert _balance(app_client, admin_cookies, acc["id"]) == 905.0


def test_subscription_row_errors(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=1000.0)
    sub = _sub(app_client, admin_cookies, account_id=acc["id"], months_back=-1)
    base = {"row_ref": "S-0001", "source_file": "", "issue_date": "2023-03-05", "total_amount": "95.00", "currency": "USD",
            "paid_date": "2023-03-05", "paid_from_account": acc["account_name"], "subscription": sub["name"]}
    unknown = _post(app_client, admin_cookies, [dict(base, subscription="No Such Tool")], {}).json()
    assert "subscription_unknown" in _codes(unknown)
    unpaid = _post(app_client, admin_cookies, [dict(base, paid_date="", paid_from_account="")], {}).json()
    assert "subscription_needs_payment" in _codes(unpaid)
    wrong_currency = _post(app_client, admin_cookies, [dict(base, currency="EGP")], {}).json()
    assert "currency_mismatch_subscription" in _codes(wrong_currency)
    no_date = _post(app_client, admin_cookies, [dict(base, issue_date="")], {}).json()
    assert "issue_date_required" in _codes(no_date)


def test_a_partial_visibility_account_is_not_held_to_the_overdraft_rule(app_client, admin_cookies):
    """An account the owner cannot see (D-028) only knows the movements entered; its recorded balance says nothing
    about what it really holds, so a payment from it is recorded even when the known balance is below it."""
    make_vendor(app_client, admin_cookies, "Paid Vendor Co")
    partial = _account(app_client, admin_cookies, "Hidden USD", "USD", book="overseas", visibility="partial", opening=0.0)
    full = _account(app_client, admin_cookies, "Visible USD", "USD", book="overseas", opening=0.0)

    refused = _post(app_client, admin_cookies, [_row(1, full["account_name"])], _pdfs(1)).json()
    assert "insufficient_balance" in _codes(refused)

    rows = [_row(1, partial["account_name"]), _row(2, partial["account_name"], total_amount="120.00")]
    report = _post(app_client, admin_cookies, rows, _pdfs(1, 2)).json()
    assert [r["status"] for r in report["rows"]] == ["warning", "warning"] and report["rows_posting"] == 2
    done = _post(app_client, admin_cookies, rows, _pdfs(1, 2), commit=True, confirm=True)
    assert done.status_code == 200 and done.json()["rows_created"] == 2, done.text
    assert _balance(app_client, admin_cookies, partial["id"]) == -220.0  # shown as the known movements; checkpoints cover the gap
