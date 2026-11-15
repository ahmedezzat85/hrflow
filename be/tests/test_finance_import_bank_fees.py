"""
The bank_fees importer: standalone bank fees post as one money-out ledger row each, through the manual-transaction
path. Synthetic data only.
"""
import io

import pytest

from import_test_helpers import manifest_csv, manifest_xlsx, post_import
from test_finance_books import _account


def _row(n, account, **extra):
    row = {"row_ref": f"F-{n:04d}", "account": account, "date": "2023-03-31", "amount": "25.50"}
    row.update(extra)
    return row


def _post(client, cookies, rows, commit=False, confirm=False, xlsx=False):
    if xlsx:
        manifest, name = manifest_xlsx("bank_fees", rows), "manifest.xlsx"
    else:
        manifest, name = manifest_csv("bank_fees", rows), "manifest.csv"
    if commit and confirm:
        return client.post("/api/finance/imports/bank_fees", files={"manifest": (name, io.BytesIO(manifest), "text/csv")},
                           data={"confirm_posting": "true"}, cookies=cookies)
    return post_import(client, cookies, "bank_fees", manifest, None, commit=commit, manifest_name=name)


def _codes(report, i=0):
    return [f["code"] for f in report["rows"][i]["findings"]]


def _fees(account_id):
    from db import get_db_context
    from finance.models import LedgerTransactionDB

    with get_db_context() as db:
        return [(t.direction, t.amount, t.source, t.description, t.reference, t.payment_type.code, t.category.name)
                for t in db.query(LedgerTransactionDB).filter(LedgerTransactionDB.account_id == account_id,
                                                              LedgerTransactionDB.entry_type == "bank_fee").all()]


def _all_rows(account_id):
    from db import get_db_context
    from finance.models import LedgerTransactionDB

    with get_db_context() as db:
        return db.query(LedgerTransactionDB).filter(LedgerTransactionDB.account_id == account_id).count()


def _balance(client, cookies, account_id):
    return client.get(f"/api/finance/accounts/{account_id}", cookies=cookies).json()["current_balance"]


@pytest.fixture
def egp(app_client, admin_cookies):
    return _account(app_client, admin_cookies, "Fees EGP", "EGP", opening=1000.0)


def test_dry_run_reports_posting_and_writes_nothing(app_client, admin_cookies, egp):
    before = _all_rows(egp["id"])
    resp = _post(app_client, admin_cookies, [_row(1, egp["account_name"])])
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert report["rows_posting"] == 1 and "will_post_ledger" in _codes(report)
    assert _all_rows(egp["id"]) == before and _balance(app_client, admin_cookies, egp["id"]) == 1000.0


def test_commit_needs_confirmation_then_posts_one_fee_out_with_defaults(app_client, admin_cookies, egp):
    row = _row(1, egp["account_name"].upper(), currency="egp")
    before = _all_rows(egp["id"])
    refused = _post(app_client, admin_cookies, [row], commit=True)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "posting_confirmation_required"
    assert _all_rows(egp["id"]) == before

    resp = _post(app_client, admin_cookies, [row], commit=True, confirm=True)
    assert resp.status_code == 200, resp.text
    assert resp.json()["rows_created"] == 1
    assert _fees(egp["id"]) == [("out", 25.5, "manual", "Bank fees", "", "BANK_FEES", "Bank Fees")]
    assert _all_rows(egp["id"]) == before + 1
    assert _balance(app_client, admin_cookies, egp["id"]) == 974.5


def test_recommit_of_the_same_file_does_not_double_post(app_client, admin_cookies, egp):
    rows = [_row(1, egp["account_name"]), _row(2, egp["account_name"], amount="10.00")]
    assert _post(app_client, admin_cookies, rows, commit=True, confirm=True).json()["rows_created"] == 2
    again = _post(app_client, admin_cookies, rows, commit=True, confirm=True)
    assert again.status_code == 200 and again.json()["rows_created"] == 0
    assert _balance(app_client, admin_cookies, egp["id"]) == 964.5


def test_description_and_reference_are_used(app_client, admin_cookies, egp):
    resp = _post(app_client, admin_cookies, [_row(1, egp["account_name"], description="Card fee", reference="CF-1", category="Bank Fees")], commit=True, confirm=True)
    assert resp.json()["rows_created"] == 1
    assert _fees(egp["id"]) == [("out", 25.5, "manual", "Card fee", "CF-1", "BANK_FEES", "Bank Fees")]


@pytest.mark.parametrize("extra,code", [
    ({"account": "No Such Account"}, "account_unknown"),
    ({"currency": "USD"}, "currency_mismatch"),
    ({"category": "Not A Category"}, "category_unknown"),
    ({"amount": "0"}, "amount_not_positive"),
    ({"amount": "-5.00"}, "amount_not_positive"),
    ({"amount": "1,000"}, "amount_invalid"),
    ({"date": "31/03/2023"}, "date_invalid"),
])
def test_row_errors(app_client, admin_cookies, egp, extra, code):
    row = _row(1, egp["account_name"])
    row.update(extra)
    report = _post(app_client, admin_cookies, [row]).json()
    assert report["rows"][0]["status"] == "error" and code in _codes(report)


def test_closed_reconciliation_month_is_an_error(app_client, admin_cookies, egp):
    from db import get_db_context
    from finance.models import BankStatementImportDB

    with get_db_context() as db:
        db.add(BankStatementImportDB(account_id=egp["id"], period_month="2023-03", status="closed"))
        db.commit()
    report = _post(app_client, admin_cookies, [_row(1, egp["account_name"])]).json()
    assert "period_closed" in _codes(report)


def test_one_bad_row_does_not_block_the_batch(app_client, admin_cookies, egp):
    rows = [_row(1, egp["account_name"]), _row(2, "No Such Account"), _row(3, egp["account_name"], amount="4.00")]
    report = _post(app_client, admin_cookies, rows, commit=True, confirm=True).json()
    assert report["rows_created"] == 2
    assert _balance(app_client, admin_cookies, egp["id"]) == 970.5


def test_repeated_row_ref_is_an_error_not_a_second_posting(app_client, admin_cookies, egp):
    rows = [_row(1, egp["account_name"]), _row(1, egp["account_name"])]
    report = _post(app_client, admin_cookies, rows, commit=True, confirm=True).json()
    assert report["rows_created"] == 1 and "duplicate_row_ref" in _codes(report, 1)


def test_identical_fee_already_in_the_ledger_is_a_warning_not_an_error(app_client, admin_cookies, egp):
    assert _post(app_client, admin_cookies, [_row(1, egp["account_name"])], commit=True, confirm=True).json()["rows_created"] == 1
    report = _post(app_client, admin_cookies, [_row(9, egp["account_name"])]).json()
    assert report["rows"][0]["status"] == "warning" and "possible_existing_ledger_row" in _codes(report)
    assert _post(app_client, admin_cookies, [_row(9, egp["account_name"])], commit=True, confirm=True).json()["rows_created"] == 1


def test_xlsx_manifest(app_client, admin_cookies, egp):
    resp = _post(app_client, admin_cookies, [_row(1, egp["account_name"])], commit=True, confirm=True, xlsx=True)
    assert resp.status_code == 200 and resp.json()["rows_created"] == 1


def test_optional_columns_may_be_left_out_of_the_header(app_client, admin_cookies, egp):
    manifest = manifest_csv("bank_fees", [_row(1, egp["account_name"])], columns=["row_ref", "account", "date", "amount"])
    report = post_import(app_client, admin_cookies, "bank_fees", manifest, None).json()
    assert not report["file_errors"] and report["rows"][0]["status"] != "error"


def test_required_columns_are_still_required(app_client, admin_cookies, egp):
    manifest = manifest_csv("bank_fees", [_row(1, egp["account_name"])], columns=["row_ref", "account", "date"])
    assert post_import(app_client, admin_cookies, "bank_fees", manifest, None).json()["file_errors"]


def test_permission_is_the_account_write_permission(app_client, employee_cookies):
    resp = post_import(app_client, employee_cookies, "bank_fees", manifest_csv("bank_fees", [_row(1, "a")]), None)
    assert resp.status_code == 403


def test_unauthenticated_is_401(app_client):
    resp = post_import(app_client, {}, "bank_fees", manifest_csv("bank_fees", [_row(1, "a")]), None)
    assert resp.status_code == 401
