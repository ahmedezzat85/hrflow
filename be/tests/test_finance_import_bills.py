"""
be/tests/test_finance_import_bills.py
Slice I1 of the bulk / historical import (D-033, plan 25): the bills importer.

Synthetic PDFs only (one with a text layer, one image-only). Imported bills are Drafts, unreviewed, with the
document attached; no vendor or category is created; no ledger row, payment or approval is produced.
"""
import os

import pytest

from bill_test_helpers import make_vendor
from import_test_helpers import build_zip, image_only_pdf, manifest_csv, post_import, text_pdf

BASE = "/api/finance/bills"


def _row(n, **extra):
    row = {"row_ref": f"B-{n:04d}", "source_file": f"bill-{n:04d}.pdf", "vendor_name": "Import Vendor Co",
           "bill_number": f"IMP-{n:03d}", "issue_date": "2026-04-10", "due_date": "2026-05-10", "currency": "USD",
           "category": "", "total_amount": "100.00", "description": "Hosting"}
    row.update(extra)
    return row


def _pdfs(*numbers, total=100.0):
    return {f"bill-{n:04d}.pdf": text_pdf("Import Vendor Co", f"IMP-{n:03d}", total) for n in numbers}


def _counts():
    from db import get_db_context
    from finance.models import (
        BillDB, FinanceAttachmentDB, ImportBatchDB, LedgerTransactionDB, PaymentDB, VendorDB, TransactionCategoryDB,
    )

    with get_db_context() as db:
        return {m.__tablename__: db.query(m).count()
                for m in (BillDB, VendorDB, TransactionCategoryDB, ImportBatchDB, LedgerTransactionDB, PaymentDB, FinanceAttachmentDB)}


def _upload_dir_files():
    import file_layout

    root = file_layout.get_files_root()
    files = []
    if os.path.exists(root):
        for dirpath, _, filenames in os.walk(root):
            if "_meta" in dirpath.replace("\\", "/"):
                continue
            for f in filenames:
                files.append(os.path.join(dirpath, f))
    return sorted(files)


def _run(client, cookies, rows, files, commit=False):
    resp = post_import(client, cookies, "bills", manifest_csv("bills", rows), build_zip(files), commit=commit)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── Dry run ─────────────────────────────────────────────────────────────────
def test_dry_run_writes_nothing(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    before, files_before = _counts(), _upload_dir_files()
    report = _run(app_client, admin_cookies, [_row(1), _row(2)], _pdfs(1, 2))
    assert report["rows_ok"] == 2 and report["dry_run"] is True and report["committed"] is False
    assert _counts() == before and _upload_dir_files() == files_before


# ── Commit ──────────────────────────────────────────────────────────────────
def test_commit_creates_unreviewed_drafts_with_the_pdf_attached(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Import Vendor Co")
    before = _counts()
    report = _run(app_client, admin_cookies, [_row(1), _row(2, bill_number="IMP-002", total_amount="250.50")], _pdfs(1, 2), commit=True)
    assert report["committed"] is True and report["rows_created"] == 2 and report["batch_id"]

    bill_id = report["rows"][1]["created_id"]
    bill = app_client.get(f"{BASE}/{bill_id}", cookies=admin_cookies).json()
    assert bill["status"] == "draft"  # even for a super admin: nothing is auto-approved
    assert bill["capture_source"] == "import" and bill["is_reviewed"] is False
    assert bill["vendor_id"] == vid and bill["vendor_to_confirm"] is False
    assert bill["bill_number"] == "IMP-002" and bill["issue_date"] == "2026-04-10" and bill["currency"] == "USD"
    assert bill["total"] == 250.5 and bill["lines"][0]["description"] == "Hosting" and bill["amount_paid"] == 0.0
    assert bill["attachment_name"] == "bill-0002.pdf" and bill["file_fingerprint"]
    assert "batch" in bill["notes"] and "B-0002" in bill["notes"]
    assert bill["missing_fields"] == "category"  # blank category is listed, not invented

    # the document downloads through the normal authorised endpoint
    att = app_client.get(f"{BASE}/{bill_id}/attachment", cookies=admin_cookies)
    assert att.status_code == 200 and att.content.startswith(b"%PDF")

    # the stored file name is generated, never the ZIP entry name
    from db import get_db_context
    from finance.models import BillDB

    with get_db_context() as db:
        row = db.get(BillDB, bill_id)
        assert row.import_batch_id == report["batch_id"]
        assert "bill-0002" not in os.path.basename(row.attachment_url)

    # it shows in the Draft queue
    drafts = app_client.get(f"{BASE}?queue=draft", cookies=admin_cookies).json()
    assert bill_id in [b["id"] for b in drafts]

    after = _counts()
    assert after["finance_bills"] == before["finance_bills"] + 2
    assert after["finance_import_batches"] == before["finance_import_batches"] + 1
    # Drafts only: no vendor, category, ledger row, payment created
    for table in ("finance_vendors", "finance_transaction_categories", "finance_ledger_transactions", "finance_payments"):
        assert after[table] == before[table], table


def test_commit_leaves_an_activity_entry_naming_the_batch(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    report = _run(app_client, admin_cookies, [_row(1)], _pdfs(1), commit=True)
    bill_id = report["rows"][0]["created_id"]
    activity = app_client.get(f"/api/finance/activity/bill/{bill_id}", cookies=admin_cookies).json()
    text = str(activity)
    assert "imported from batch" in text and "B-0001" in text


def test_unknown_vendor_and_category_are_flagged_never_created(app_client, admin_cookies):
    before = _counts()
    rows = [_row(1, vendor_name="Nobody Ltd", category="Made Up Category")]
    report = _run(app_client, admin_cookies, rows, _pdfs(1), commit=True)
    row = report["rows"][0]
    assert row["status"] == "warning" and row["created_id"]
    assert {"vendor_unknown", "category_unknown"} <= {f["code"] for f in row["findings"]}
    bill = app_client.get(f"{BASE}/{row['created_id']}", cookies=admin_cookies).json()
    assert bill["vendor_id"] is None and bill["vendor_to_confirm"] is True and bill["suggested_vendor_name"] == "Nobody Ltd"
    assert not bill["category_id"] and "category" in bill["missing_fields"]
    after = _counts()
    assert after["finance_vendors"] == before["finance_vendors"]
    assert after["finance_transaction_categories"] == before["finance_transaction_categories"]


def test_known_category_is_linked(app_client, admin_cookies):
    from db import get_db_context
    from finance.models import TransactionCategoryDB

    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    with get_db_context() as db:
        cat = db.query(TransactionCategoryDB).filter(TransactionCategoryDB.is_active == True).first()  # noqa: E712
        cat_id, cat_name = cat.id, cat.name
    report = _run(app_client, admin_cookies, [_row(1, category=cat_name.upper())], _pdfs(1), commit=True)
    bill = app_client.get(f"{BASE}/{report['rows'][0]['created_id']}", cookies=admin_cookies).json()
    assert bill["category_id"] == cat_id and "category" not in (bill["missing_fields"] or "")


def test_blank_fields_are_listed_not_guessed(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    rows = [_row(1, bill_number="", issue_date="", due_date="", total_amount="", currency="")]
    report = _run(app_client, admin_cookies, rows, _pdfs(1), commit=True)
    row = report["rows"][0]
    assert row["status"] == "warning" and "currency_defaulted" in [f["code"] for f in row["findings"]]
    bill = app_client.get(f"{BASE}/{row['created_id']}", cookies=admin_cookies).json()
    assert bill["bill_number"] is None and bill["issue_date"] is None and bill["due_date"] is None
    assert bill["lines"] == [] and bill["total"] == 0
    assert set(bill["missing_fields"].split(",")) >= {"bill_number", "issue_date", "due_date", "total", "category"}


def test_row_without_a_file_needs_a_known_vendor(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    rows = [_row(1, source_file=""), _row(2, source_file="", vendor_name="Nobody Ltd")]
    report = _run(app_client, admin_cookies, rows, {}, commit=True)
    assert report["rows"][0]["status"] == "ok" and report["rows"][0]["created_id"]
    assert report["rows"][1]["status"] == "error"
    assert "vendor_or_file_required" in [f["code"] for f in report["rows"][1]["findings"]]
    bill = app_client.get(f"{BASE}/{report['rows'][0]['created_id']}", cookies=admin_cookies).json()
    assert bill["attachment_name"] is None


# ── Validation ──────────────────────────────────────────────────────────────
def test_invalid_values_are_row_errors_and_one_bad_row_never_blocks_the_rest(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    rows = [
        _row(1, issue_date="10/04/2026"),
        _row(2, total_amount="0"),
        _row(3, total_amount="1,200.00"),
        _row(4, currency="XXX"),
        _row(5, bill_number="N" * 60),
        _row(6),
    ]
    report = _run(app_client, admin_cookies, rows, _pdfs(1, 2, 3, 4, 5, 6), commit=True)
    assert [r["status"] for r in report["rows"]] == ["error"] * 5 + ["ok"]
    codes = [r["findings"][0]["code"] for r in report["rows"][:5]]
    assert codes == ["issue_date_invalid", "total_not_positive", "total_amount_invalid", "currency_unknown", "bill_number_too_long"]
    assert report["rows_created"] == 1 and report["rows_failed"] == 5


# ── Duplicates ──────────────────────────────────────────────────────────────
def test_duplicates_are_detected_and_recommit_is_idempotent(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    rows, files = [_row(1), _row(2)], _pdfs(1, 2)
    first = _run(app_client, admin_cookies, rows, files, commit=True)
    assert first["rows_created"] == 2
    before = _counts()

    again = _run(app_client, admin_cookies, rows, files, commit=True)
    assert [r["status"] for r in again["rows"]] == ["duplicate", "duplicate"]
    assert again["rows"][0]["duplicate_of"] == first["rows"][0]["created_id"]
    assert again["rows_created"] == 0 and again["committed"] is False and again["batch_id"] is None
    assert _counts() == before


def test_duplicate_vendor_and_number_even_when_the_file_differs(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    _run(app_client, admin_cookies, [_row(1)], _pdfs(1), commit=True)
    # same vendor + number, different document bytes
    report = _run(app_client, admin_cookies, [_row(1, row_ref="B-9000", source_file="other.pdf")],
                  {"other.pdf": text_pdf("Import Vendor Co", "IMP-001", 999.0)})
    assert report["rows"][0]["status"] == "duplicate"
    assert "Vendor and bill number already exist" in report["rows"][0]["findings"][0]["message"]


def test_duplicate_of_an_earlier_upload_by_fingerprint(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    pdf = text_pdf("Import Vendor Co", "IMP-001", 100.0)
    up = app_client.post(f"{BASE}/upload", files=[("files", ("scan.pdf", pdf, "application/pdf"))], cookies=admin_cookies)
    existing = up.json()["results"][0]["bill"]["id"]
    report = _run(app_client, admin_cookies, [_row(1)], {"bill-0001.pdf": pdf})
    assert report["rows"][0]["status"] == "duplicate" and report["rows"][0]["duplicate_of"] == existing


def test_same_vendor_and_number_twice_in_one_manifest(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    rows = [_row(1), _row(2, bill_number="IMP-001")]
    report = _run(app_client, admin_cookies, rows, _pdfs(1, 2), commit=True)
    assert [r["status"] for r in report["rows"]] == ["ok", "duplicate"]
    assert report["rows_created"] == 1


def test_number_used_by_another_vendor_warns(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    make_vendor(app_client, admin_cookies, "Second Vendor")
    _run(app_client, admin_cookies, [_row(1)], _pdfs(1), commit=True)
    report = _run(app_client, admin_cookies, [_row(5, bill_number="IMP-001", vendor_name="Second Vendor")], _pdfs(5))
    assert report["rows"][0]["status"] == "warning"
    assert "bill_number_in_use" in [f["code"] for f in report["rows"][0]["findings"]]


# ── The is_reviewed trap ────────────────────────────────────────────────────
def test_import_capture_source_never_counts_as_reviewed(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Import Vendor Co")
    base = {"vendor_id": vid, "bill_number": "TRAP-1", "issue_date": "2026-01-01", "due_date": "2026-02-01", "currency": "USD",
            "save_as_draft": True, "lines": [{"description": "x", "quantity": 1, "unit_price": 5, "line_total": 5}]}
    for source, expected in (("manual", True), ("upload", False), ("ocr", False), ("import", False)):
        resp = app_client.post(BASE, json={**base, "bill_number": f"TRAP-{source}", "capture_source": source}, cookies=admin_cookies)
        assert resp.status_code == 201, resp.text
        assert resp.json()["is_reviewed"] is expected, source


# ── Extractor cross-check (warning only) ────────────────────────────────────
def test_extractor_cross_check_warns_on_a_mismatched_text_layer_pdf(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    pdf = text_pdf("Import Vendor Co", "IMP-777", 120.0)  # the PDF says IMP-777 / 120.00
    rows = [_row(1, bill_number="IMP-707", total_amount="100.00")]  # the manifest disagrees
    report = _run(app_client, admin_cookies, rows, {"bill-0001.pdf": pdf}, commit=True)
    row = report["rows"][0]
    mismatches = [f for f in row["findings"] if f["code"] == "extractor_mismatch"]
    assert row["status"] == "warning" and len(mismatches) == 2
    assert all(f["level"] == "warning" for f in mismatches)
    assert any("bill_number" in f["message"] for f in mismatches) and any("total_amount" in f["message"] for f in mismatches)
    # never overrides, never blocks
    bill = app_client.get(f"{BASE}/{row['created_id']}", cookies=admin_cookies).json()
    assert bill["bill_number"] == "IMP-707" and bill["total"] == 100.0


def test_extractor_cross_check_is_silent_when_values_agree_or_the_pdf_is_image_only(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    rows = [_row(1), _row(2)]
    files = {"bill-0001.pdf": text_pdf("Import Vendor Co", "IMP-001", 100.0), "bill-0002.pdf": image_only_pdf()}
    report = _run(app_client, admin_cookies, rows, files)
    for row in report["rows"]:
        assert row["status"] == "ok" and not [f for f in row["findings"] if f["code"] == "extractor_mismatch"]


def test_extractor_cross_check_is_skipped_for_photos(app_client, admin_cookies):
    from import_test_helpers import PNG_BYTES

    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    report = _run(app_client, admin_cookies, [_row(1, source_file="photo.png")], {"photo.png": PNG_BYTES})
    assert report["rows"][0]["status"] == "ok"


# ── Reuse of the normal workflow ────────────────────────────────────────────
def test_an_imported_draft_can_be_discarded_with_its_file(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    report = _run(app_client, admin_cookies, [_row(1)], _pdfs(1), commit=True)
    bill_id = report["rows"][0]["created_id"]
    files_with = _upload_dir_files()
    assert app_client.delete(f"{BASE}/{bill_id}", cookies=admin_cookies).status_code == 204
    assert len(_upload_dir_files()) == len(files_with) - 1


def test_review_flags_surface_as_a_warning_and_in_the_notes(app_client, admin_cookies):
    make_vendor(app_client, admin_cookies, "Import Vendor Co")
    report = _run(app_client, admin_cookies, [_row(1, review_flags="total smudged", confidence="0.6")], _pdfs(1), commit=True)
    row = report["rows"][0]
    assert row["status"] == "warning" and "review_flagged" in [f["code"] for f in row["findings"]]
    bill = app_client.get(f"{BASE}/{row['created_id']}", cookies=admin_cookies).json()
    assert "total smudged" in bill["notes"] and bill["extraction_confidence"] == 0.6
