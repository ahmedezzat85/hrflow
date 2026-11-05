"""
be/tests/test_finance_import_transfers.py
D-052: the transfers importer. An overseas to local movement is one transfer whose two ledger legs sit in two books
(so it shows in both cashbooks), with the supporting document attached to both legs. Synthetic data only.
"""
import io

import pytest

from import_test_helpers import build_zip, manifest_csv, post_import, text_pdf
from test_finance_books import _account


@pytest.fixture(autouse=True)
def _own_files_root(monkeypatch, tmp_path):
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path / "files"))


def _row(n, src, dst, **extra):
    row = {"row_ref": f"T-{n:04d}", "source_file": f"doc-{n:04d}.pdf", "from_account": src, "to_account": dst,
           "date": "2023-04-10", "from_amount": "1000.00", "to_amount": "", "fx_rate": "", "fee": "", "exchange_reference": f"WIRE-{n}"}
    row.update(extra)
    return row


def _docs(*numbers):
    return {f"doc-{n:04d}.pdf": text_pdf("Local Entity", f"PAY-{n}", 1000.0) for n in numbers}


def _post(client, cookies, rows, files, commit=False, confirm=False):
    manifest, archive = manifest_csv("transfers", rows), build_zip(files)
    if commit and confirm:
        return client.post(
            "/api/finance/imports/transfers",
            files={"manifest": ("manifest.csv", io.BytesIO(manifest), "text/csv"), "archive": ("package.zip", io.BytesIO(archive), "application/zip")},
            data={"confirm_posting": "true"}, cookies=cookies,
        )
    return post_import(client, cookies, "transfers", manifest, archive, commit=commit)


def _balance(client, cookies, account_id):
    return client.get(f"/api/finance/accounts/{account_id}", cookies=cookies).json()["current_balance"]


def _codes(report, i=0):
    return [f["code"] for f in report["rows"][i]["findings"]]


def _accounts(client, cookies):
    over = _account(client, cookies, "Overseas USD", "USD", book="overseas", opening=5000.0)
    local = _account(client, cookies, "Local EGP", "EGP", book="local", opening=0.0)
    return over, local


def test_dry_run_reports_posting_and_writes_nothing(app_client, admin_cookies):
    over, local = _accounts(app_client, admin_cookies)
    resp = _post(app_client, admin_cookies, [_row(1, over["account_name"], local["account_name"], to_amount="50000.00")], _docs(1))
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert report["rows_posting"] == 1 and "will_post_ledger" in _codes(report)
    assert _balance(app_client, admin_cookies, over["id"]) == 5000.0 and _balance(app_client, admin_cookies, local["id"]) == 0.0


def test_overseas_to_local_posts_both_legs_across_books_with_the_document_on_each(app_client, admin_cookies):
    over, local = _accounts(app_client, admin_cookies)
    row = _row(1, over["account_name"], local["account_name"], to_amount="50000.00")

    refused = _post(app_client, admin_cookies, [row], _docs(1), commit=True)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "posting_confirmation_required"
    assert _balance(app_client, admin_cookies, over["id"]) == 5000.0

    resp = _post(app_client, admin_cookies, [row], _docs(1), commit=True, confirm=True)
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert report["rows_created"] == 1, report
    assert _balance(app_client, admin_cookies, over["id"]) == 4000.0 and _balance(app_client, admin_cookies, local["id"]) == 50000.0

    from db import get_db_context
    from finance import books
    from finance.models import AccountTransferDB, FinanceAttachmentDB, LedgerTransactionDB

    with get_db_context() as db:
        transfer = db.query(AccountTransferDB).filter(AccountTransferDB.id == report["rows"][0]["created_id"]).first()
        assert transfer.from_amount == 1000.0 and transfer.to_amount == 50000.0 and transfer.fx_rate == 50.0
        legs = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.linked_transfer_id == transfer.id).all()
        assert sorted((l.account_id, l.direction) for l in legs) == sorted([(over["id"], "out"), (local["id"], "in")])
        scope = books.resolve(db, "consolidated")
        assert all(scope.inter_book(l) for l in legs)  # one movement, two books: Local income / Overseas outflow
        docs = db.query(FinanceAttachmentDB).filter(FinanceAttachmentDB.ledger_transaction_id.in_([l.id for l in legs])).all()
        assert len(docs) == 2 and {d.ledger_transaction_id for d in docs} == {l.id for l in legs}

    again = _post(app_client, admin_cookies, [row], _docs(1), commit=True, confirm=True).json()
    assert again["rows_created"] == 0 and again["rows"][0]["status"] == "duplicate"
    assert _balance(app_client, admin_cookies, over["id"]) == 4000.0


def test_same_currency_transfer_and_fx_rate_in_place_of_to_amount(app_client, admin_cookies):
    over, _local = _accounts(app_client, admin_cookies)
    other = _account(app_client, admin_cookies, "Local USD", "USD", book="local", opening=0.0)
    same = _post(app_client, admin_cookies, [_row(1, over["account_name"], other["account_name"], source_file="")], {}, commit=True, confirm=True).json()
    assert same["rows_created"] == 1
    assert _balance(app_client, admin_cookies, other["id"]) == 1000.0

    egp = _account(app_client, admin_cookies, "Local EGP 2", "EGP", book="local", opening=0.0)
    fx = _post(app_client, admin_cookies, [_row(2, over["account_name"], egp["account_name"], source_file="", fx_rate="49.5", exchange_reference="WIRE-2")], {}, commit=True, confirm=True).json()
    assert fx["rows_created"] == 1
    assert _balance(app_client, admin_cookies, egp["id"]) == 49500.0


@pytest.mark.parametrize("extra,code", [
    ({"from_account": "Nope"}, "from_account_unknown"),
    ({"to_account": ""}, "required_missing"),
    ({"date": "10/04/2023"}, "date_invalid"),
    ({"from_amount": "0"}, "from_amount_not_positive"),
    ({"from_amount": "abc"}, "from_amount_invalid"),
    ({"to_amount": "", "fx_rate": ""}, "fx_required"),
])
def test_row_errors(app_client, admin_cookies, extra, code):
    over, local = _accounts(app_client, admin_cookies)
    row = _row(1, over["account_name"], local["account_name"], to_amount="50000.00")
    row.update(extra)
    report = _post(app_client, admin_cookies, [row], _docs(1)).json()
    assert report["rows"][0]["status"] == "error" and code in _codes(report), report


def test_same_account_and_unequal_amounts_in_one_currency_are_errors(app_client, admin_cookies):
    over, _local = _accounts(app_client, admin_cookies)
    other = _account(app_client, admin_cookies, "Local USD", "USD", book="local", opening=0.0)
    same_acc = _post(app_client, admin_cookies, [_row(1, over["account_name"], over["account_name"])], _docs(1)).json()
    assert "same_account" in _codes(same_acc)
    unequal = _post(app_client, admin_cookies, [_row(1, over["account_name"], other["account_name"], to_amount="900.00")], _docs(1)).json()
    assert "to_amount_differs" in _codes(unequal)


def test_permission_is_the_transfer_write_permission(app_client, employee_cookies):
    resp = post_import(app_client, employee_cookies, "transfers", manifest_csv("transfers", [_row(1, "a", "b")]), build_zip({}))
    assert resp.status_code == 403
