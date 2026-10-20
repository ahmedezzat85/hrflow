"""
be/tests/test_finance_import_cheques.py
Slice I3 of the bulk / historical import (D-033, plan 25): the cheques importer.

Draft cheques only, scan attached through the cheque-attachment path, no ledger rows. Handwriting is the weakest
input, so amount, cheque number and issue date are required and low-confidence rows warn.
"""
import pytest

from bill_test_helpers import make_account, make_user
from import_test_helpers import PNG_BYTES, build_zip, image_only_pdf, manifest_csv, post_import

BASE = "/api/finance/cheques"
_seq = {"n": 0}


def _acct(client, cookies, currency="EGP"):
    _seq["n"] += 1
    return make_account(client, cookies, name=f"Chq Acct {_seq['n']}", number=f"CHQ{_seq['n']:05d}", currency=currency)


def _row(n, account, **extra):
    row = {"row_ref": f"C-{n:04d}", "source_file": f"chq-{n:04d}.pdf", "account": account, "cheque_number": f"{100000 + n}",
           "payee": "Test Payee", "amount": "1500.00", "currency": "EGP", "issue_date": "2026-03-05", "confidence": "0.95"}
    row.update(extra)
    return row


def _files(*numbers):
    return {f"chq-{n:04d}.pdf": image_only_pdf(f"cheque {n}") for n in numbers}


def _run(client, cookies, rows, files, commit=False):
    resp = post_import(client, cookies, "cheques", manifest_csv("cheques", rows), build_zip(files), commit=commit)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _counts():
    from db import get_db_context
    from finance.models import FinanceAttachmentDB, FinanceChequeDB, ImportBatchDB, LedgerTransactionDB, PaymentDB

    with get_db_context() as db:
        return {m.__tablename__: db.query(m).count() for m in (FinanceChequeDB, FinanceAttachmentDB, ImportBatchDB, LedgerTransactionDB, PaymentDB)}


def _balance(client, cookies, account_id):
    accounts = client.get("/api/finance/accounts", cookies=cookies).json()
    return next(a for a in accounts if a["id"] == account_id)["current_balance"]


def _codes(row):
    return [f["code"] for f in row["findings"]]


def test_dry_run_writes_nothing(app_client, admin_cookies):
    name = f"Chq Acct {_seq['n'] + 1}"
    _acct(app_client, admin_cookies)
    before = _counts()
    report = _run(app_client, admin_cookies, [_row(1, name)], _files(1))
    assert report["rows_ok"] == 1 and report["dry_run"] is True
    assert _counts() == before


def test_commit_creates_draft_cheques_with_the_scan_and_no_ledger_rows(app_client, admin_cookies):
    acc = _acct(app_client, admin_cookies)
    name = f"Chq Acct {_seq['n']}"
    balance_before = _balance(app_client, admin_cookies, acc)
    before = _counts()
    report = _run(app_client, admin_cookies, [_row(1, name), _row(2, str(acc), cheque_number="000777")], _files(1, 2), commit=True)
    assert report["committed"] is True and report["rows_created"] == 2

    chq = app_client.get(f"{BASE}/{report['rows'][0]['created_id']}", cookies=admin_cookies).json()
    assert chq["status"] == "draft" and chq["has_scan"] is True and chq["attachment_count"] == 1
    assert chq["account_id"] == acc and chq["amount"] == 1500.0 and chq["issue_date"] == "2026-03-05"
    assert chq["payee"] == "Test Payee" and chq["currency"] == "EGP" and chq["fiscal_year"] == 2026
    assert chq["linked_transaction_id"] is None and "batch" in chq["notes"] and "C-0001" in chq["notes"]
    second = app_client.get(f"{BASE}/{report['rows'][1]['created_id']}", cookies=admin_cookies).json()
    assert second["cheque_number"] == "000777"  # leading zeros survive

    atts = app_client.get(f"{BASE}/{chq['id']}/attachments", cookies=admin_cookies).json()
    assert atts[0]["file_name"] == "chq-0001.pdf"
    dl = app_client.get(f"{BASE}/{chq['id']}/attachments/{atts[0]['id']}/download", cookies=admin_cookies)
    assert dl.status_code == 200 and dl.content.startswith(b"%PDF")

    from db import get_db_context
    from finance.models import FinanceAttachmentDB, FinanceChequeDB

    with get_db_context() as db:
        assert db.get(FinanceChequeDB, chq["id"]).import_batch_id == report["batch_id"]
        stored = db.query(FinanceAttachmentDB).filter(FinanceAttachmentDB.cheque_id == chq["id"]).one().storage_ref
        assert "chq-0001" not in stored.replace("\\", "/").rsplit("/", 1)[-1]  # generated name

    after = _counts()
    assert after["finance_cheques"] == before["finance_cheques"] + 2
    assert after["finance_import_batches"] == before["finance_import_batches"] + 1
    # Drafts only: no ledger row, no payment, no balance change
    assert after["finance_ledger_transactions"] == before["finance_ledger_transactions"]
    assert after["finance_payments"] == before["finance_payments"]
    assert _balance(app_client, admin_cookies, acc) == balance_before


def test_duplicates_and_idempotent_recommit(app_client, admin_cookies):
    acc = _acct(app_client, admin_cookies)
    name = f"Chq Acct {_seq['n']}"
    rows = [_row(1, name), _row(2, name, cheque_number="100001")]  # second repeats the first's number
    first = _run(app_client, admin_cookies, rows, _files(1, 2), commit=True)
    assert [r["status"] for r in first["rows"]] == ["ok", "duplicate"]
    assert "duplicate_in_manifest" in _codes(first["rows"][1])

    before = _counts()
    again = _run(app_client, admin_cookies, [_row(1, name)], _files(1), commit=True)
    assert again["rows"][0]["status"] == "duplicate" and again["rows"][0]["duplicate_of"] == first["rows"][0]["created_id"]
    assert again["committed"] is False and _counts() == before


def test_same_number_on_a_different_account_is_not_a_duplicate(app_client, admin_cookies):
    _acct(app_client, admin_cookies)
    a = f"Chq Acct {_seq['n']}"
    _acct(app_client, admin_cookies)
    b = f"Chq Acct {_seq['n']}"
    report = _run(app_client, admin_cookies, [_row(1, a), _row(2, b, cheque_number="100001")], _files(1, 2), commit=True)
    assert [r["status"] for r in report["rows"]] == ["ok", "ok"]


def test_account_must_exist_be_unique_active_and_a_bank_account(app_client, admin_cookies):
    _acct(app_client, admin_cookies)
    good = f"Chq Acct {_seq['n']}"
    cash = app_client.post("/api/finance/accounts", json={"account_name": "Petty Cash EGP", "bank_name": "Cash", "account_number": "CASH0001", "account_type": "cash", "currency": "EGP", "opening_balance": 10}, cookies=admin_cookies)
    assert cash.status_code == 201, cash.text
    rows = [_row(1, "Nowhere Bank"), _row(2, "Petty Cash EGP"), _row(3, ""), _row(4, "999999"), _row(5, good)]
    report = _run(app_client, admin_cookies, rows, _files(1, 2, 3, 4, 5))
    assert [r["status"] for r in report["rows"]] == ["error"] * 4 + ["ok"]
    assert _codes(report["rows"][0]) == ["account_unknown"] and _codes(report["rows"][1]) == ["account_not_bank"]
    assert _codes(report["rows"][2]) == ["account_missing"] and _codes(report["rows"][3]) == ["account_unknown"]


def test_required_fields_amount_number_and_date(app_client, admin_cookies):
    _acct(app_client, admin_cookies)
    name = f"Chq Acct {_seq['n']}"
    rows = [
        _row(1, name, amount=""),
        _row(2, name, cheque_number=""),
        _row(3, name, issue_date=""),
        _row(4, name, amount="", issue_date="", review_flags="amount smudged; date unreadable"),
        _row(5, name, payee=""),
    ]
    report = _run(app_client, admin_cookies, rows, _files(1, 2, 3, 4, 5), commit=True)
    assert [r["status"] for r in report["rows"]] == ["error"] * 5
    assert "required_missing" in _codes(report["rows"][0]) and "amount" in report["rows"][0]["findings"][0]["message"]
    assert "required_missing" in _codes(report["rows"][1]) and "required_missing" in _codes(report["rows"][2])
    # a flagged row is still not stored with blanks: nothing is invented; it is to be entered by hand
    flagged = next(f for f in report["rows"][3]["findings"] if f["code"] == "required_blank_flagged")
    assert "enter this one by hand" in flagged["message"]
    assert "review_flagged" in _codes(report["rows"][3])
    assert "payee_required" in _codes(report["rows"][4])
    assert report["rows_created"] == 0 and report["committed"] is False


def test_invalid_values(app_client, admin_cookies):
    _acct(app_client, admin_cookies)
    name = f"Chq Acct {_seq['n']}"
    rows = [_row(1, name, amount="0"), _row(2, name, amount="1,500"), _row(3, name, issue_date="05/03/2026"),
            _row(4, name, currency="USD"), _row(5, name, cheque_number="9" * 60)]
    report = _run(app_client, admin_cookies, rows, _files(1, 2, 3, 4, 5))
    assert [_codes(r)[0] for r in report["rows"]] == ["amount_not_positive", "amount_invalid", "issue_date_invalid", "currency_mismatch", "cheque_number_too_long"]


def test_blank_currency_takes_the_account_currency(app_client, admin_cookies):
    _acct(app_client, admin_cookies, currency="USD")
    name = f"Chq Acct {_seq['n']}"
    report = _run(app_client, admin_cookies, [_row(1, name, currency="")], _files(1), commit=True)
    chq = app_client.get(f"{BASE}/{report['rows'][0]['created_id']}", cookies=admin_cookies).json()
    assert chq["currency"] == "USD"


def test_low_confidence_warns_but_still_imports(app_client, admin_cookies):
    _acct(app_client, admin_cookies)
    name = f"Chq Acct {_seq['n']}"
    rows = [_row(1, name, confidence="0.79"), _row(2, name, confidence="0.8"), _row(3, name, confidence="")]
    report = _run(app_client, admin_cookies, rows, _files(1, 2, 3), commit=True)
    assert [r["status"] for r in report["rows"]] == ["warning", "ok", "ok"]
    assert "low_confidence" in _codes(report["rows"][0]) and report["rows_created"] == 3


def test_low_confidence_threshold_is_configurable(app_client, admin_cookies, monkeypatch):
    from finance import import_config as cfg

    _acct(app_client, admin_cookies)
    name = f"Chq Acct {_seq['n']}"
    monkeypatch.setattr(cfg, "LOW_CONFIDENCE_THRESHOLD", 0.97)
    report = _run(app_client, admin_cookies, [_row(1, name, confidence="0.95")], _files(1))
    assert "low_confidence" in _codes(report["rows"][0])


def test_row_without_a_scan_warns_and_is_flagged_scan_missing(app_client, admin_cookies):
    _acct(app_client, admin_cookies)
    name = f"Chq Acct {_seq['n']}"
    report = _run(app_client, admin_cookies, [_row(1, name, source_file="")], {}, commit=True)
    assert report["rows"][0]["status"] == "warning" and "no_scan" in _codes(report["rows"][0])
    chq = app_client.get(f"{BASE}/{report['rows'][0]['created_id']}", cookies=admin_cookies).json()
    assert chq["has_scan"] is False
    missing = app_client.get(f"{BASE}?has_scan=false", cookies=admin_cookies).json()
    assert chq["id"] in [c["id"] for c in missing]


def test_a_photo_scan_is_accepted_and_one_bad_row_never_blocks_the_rest(app_client, admin_cookies):
    _acct(app_client, admin_cookies)
    name = f"Chq Acct {_seq['n']}"
    rows = [_row(1, name, amount="oops"), _row(2, name, source_file="photo.png")]
    report = _run(app_client, admin_cookies, rows, {"chq-0001.pdf": image_only_pdf("x"), "photo.png": PNG_BYTES}, commit=True)
    assert [r["status"] for r in report["rows"]] == ["error", "ok"] and report["rows_created"] == 1
    atts = app_client.get(f"{BASE}/{report['rows'][1]['created_id']}/attachments", cookies=admin_cookies).json()
    assert atts[0]["mime_type"] == "image/png"


def test_a_draft_import_does_not_block_issuing_the_cheque_later_in_the_normal_flow(app_client, admin_cookies):
    acc = _acct(app_client, admin_cookies)
    name = f"Chq Acct {_seq['n']}"
    report = _run(app_client, admin_cookies, [_row(1, name)], _files(1), commit=True)
    cid = report["rows"][0]["created_id"]
    got = app_client.get(f"{BASE}/{cid}", cookies=admin_cookies).json()
    assert got["status"] == "draft" and got["posting_policy"] == "at_issue"


def test_only_the_account_write_permission_is_needed(app_client, admin_cookies):
    _acct(app_client, admin_cookies)
    name = f"Chq Acct {_seq['n']}"
    cookies = make_user("chq-importer@hrflow.test", ["finance.account.write", "finance.account.read"])
    report = _run(app_client, cookies, [_row(1, name)], _files(1), commit=True)
    assert report["rows_created"] == 1
    bills_only = make_user("chq-denied@hrflow.test", ["finance.bill.write"])
    resp = post_import(app_client, bills_only, "cheques", manifest_csv("cheques", [_row(1, name)]), build_zip(_files(1)))
    assert resp.status_code == 403
