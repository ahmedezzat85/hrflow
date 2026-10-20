"""
be/tests/test_finance_import_invoices.py
Slice I4 of the bulk / historical import (D-033, plan 25): the sales invoices importer and invoice scan storage.

Draft invoices only, scan attached and downloadable with the invoice read permission, no payments or ledger rows,
customers never created.
"""
import importlib.util
import os

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from bill_test_helpers import make_user
from import_test_helpers import build_zip, image_only_pdf, manifest_csv, post_import
from invoice_test_helpers import make_customer

BASE = "/api/finance/invoices"
BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _row(n, customer, **extra):
    row = {"row_ref": f"I-{n:04d}", "source_file": f"inv-{n:04d}.pdf", "customer_name": customer, "invoice_number": f"HIST-{n:04d}",
           "issue_date": "2025-11-02", "due_date": "2025-12-02", "currency": "USD", "description": "Annual licence", "amount": "1200.00"}
    row.update(extra)
    return row


def _files(*numbers):
    return {f"inv-{n:04d}.pdf": image_only_pdf(f"invoice {n}") for n in numbers}


def _run(client, cookies, rows, files, commit=False):
    resp = post_import(client, cookies, "invoices", manifest_csv("invoices", rows), build_zip(files), commit=commit)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _counts():
    from db import get_db_context
    from finance.models import CustomerDB, FinanceAttachmentDB, ImportBatchDB, LedgerTransactionDB, PaymentDB, SalesInvoiceDB

    with get_db_context() as db:
        return {m.__tablename__: db.query(m).count()
                for m in (SalesInvoiceDB, CustomerDB, FinanceAttachmentDB, ImportBatchDB, LedgerTransactionDB, PaymentDB)}


def _codes(row):
    return [f["code"] for f in row["findings"]]


def test_dry_run_writes_nothing(app_client, admin_cookies):
    make_customer(app_client, admin_cookies, "Acme Clinics")
    before = _counts()
    report = _run(app_client, admin_cookies, [_row(1, "Acme Clinics")], _files(1))
    assert report["rows_ok"] == 1 and report["dry_run"] is True
    assert _counts() == before


def test_commit_creates_draft_invoices_with_a_downloadable_scan(app_client, admin_cookies):
    cid = make_customer(app_client, admin_cookies, "Acme Clinics")
    before = _counts()
    rows = [_row(1, "ACME clinics"), _row(2, "Acme Clinics", amount="500.50", vat_rate="14", notes="old contract")]
    report = _run(app_client, admin_cookies, rows, _files(1, 2), commit=True)
    assert report["committed"] is True and report["rows_created"] == 2

    inv = app_client.get(f"{BASE}/{report['rows'][1]['created_id']}", cookies=admin_cookies).json()
    assert inv["status"] == "draft" and inv["customer_id"] == cid and inv["invoice_number"] == "HIST-0002"
    assert inv["issue_date"] == "2025-11-02" and inv["due_date"] == "2025-12-02" and inv["currency"] == "USD"
    assert inv["subtotal"] == 500.5 and inv["vat_rate"] == 14.0 and inv["amount_paid"] == 0.0
    assert inv["lines"][0]["description"] == "Annual licence"
    assert inv["has_scan"] is True and inv["attachment_count"] == 1
    assert "batch" in inv["notes"] and "old contract" in inv["notes"]

    atts = app_client.get(f"{BASE}/{inv['id']}/attachments", cookies=admin_cookies).json()
    assert atts[0]["file_name"] == "inv-0002.pdf" and "storage_ref" not in atts[0]
    dl = app_client.get(f"{BASE}/{inv['id']}/attachments/{atts[0]['id']}/download", cookies=admin_cookies)
    assert dl.status_code == 200 and dl.content.startswith(b"%PDF")

    from db import get_db_context
    from finance.models import FinanceAttachmentDB, SalesInvoiceDB

    with get_db_context() as db:
        assert db.get(SalesInvoiceDB, inv["id"]).import_batch_id == report["batch_id"]
        stored = db.query(FinanceAttachmentDB).filter(FinanceAttachmentDB.sales_invoice_id == inv["id"]).one().storage_ref
        assert "inv-0002" not in stored.replace("\\", "/").rsplit("/", 1)[-1]

    after = _counts()
    assert after["finance_sales_invoices"] == before["finance_sales_invoices"] + 2
    assert after["finance_import_batches"] == before["finance_import_batches"] + 1
    # Drafts only: no customer created, no payment, no ledger row
    for table in ("finance_customers", "finance_payments", "finance_ledger_transactions"):
        assert after[table] == before[table], table


def test_scan_download_needs_the_invoice_read_permission(app_client, admin_cookies, employee_cookies):
    make_customer(app_client, admin_cookies, "Acme Clinics")
    report = _run(app_client, admin_cookies, [_row(1, "Acme Clinics")], _files(1), commit=True)
    iid = report["rows"][0]["created_id"]
    aid = app_client.get(f"{BASE}/{iid}/attachments", cookies=admin_cookies).json()[0]["id"]
    url = f"{BASE}/{iid}/attachments/{aid}/download"
    assert app_client.get(url).status_code == 401
    assert app_client.get(url, cookies=employee_cookies).status_code == 403
    assert app_client.get(f"{BASE}/{iid}/attachments", cookies=employee_cookies).status_code == 403
    reader = make_user("inv-reader@hrflow.test", ["finance.invoice.read"])
    assert app_client.get(url, cookies=reader).status_code == 200
    assert app_client.get(f"{BASE}/{iid}/attachments/999999/download", cookies=admin_cookies).status_code == 404
    assert app_client.get(f"{BASE}/999999/attachments", cookies=admin_cookies).status_code == 404


def test_customer_is_never_created_and_required_fields_are_enforced(app_client, admin_cookies):
    make_customer(app_client, admin_cookies, "Acme Clinics")
    before = _counts()
    rows = [
        _row(1, "Nobody Inc"),
        _row(2, ""),
        _row(3, "Acme Clinics", invoice_number=""),
        _row(4, "Acme Clinics", issue_date=""),
        _row(5, "Acme Clinics", due_date="2025-10-01"),
        _row(6, "Acme Clinics", amount="0"),
        _row(7, "Acme Clinics", amount="1,200"),
        _row(8, "Acme Clinics", currency="XXX"),
        _row(9, "Acme Clinics", vat_rate="140"),
    ]
    report = _run(app_client, admin_cookies, rows, _files(*range(1, 10)), commit=True)
    assert [r["status"] for r in report["rows"]] == ["error"] * 9
    assert "customer_unknown" in _codes(report["rows"][0])
    for i in (1, 2, 3):
        assert "required_missing" in _codes(report["rows"][i])
    assert "due_before_issue" in _codes(report["rows"][4])
    assert "amount_not_positive" in _codes(report["rows"][5]) and "amount_invalid" in _codes(report["rows"][6])
    assert "currency_unknown" in _codes(report["rows"][7]) and "vat_rate_invalid" in _codes(report["rows"][8])
    assert report["committed"] is False and _counts() == before


def test_inactive_customer_is_refused(app_client, admin_cookies):
    cid = make_customer(app_client, admin_cookies, "Dormant Co")
    from db import get_db_context
    from finance.models import CustomerDB

    with get_db_context() as db:
        db.get(CustomerDB, cid).is_active = False
        db.commit()
    report = _run(app_client, admin_cookies, [_row(1, "Dormant Co")], _files(1))
    assert _codes(report["rows"][0]) == ["customer_inactive"]


def test_duplicates_and_idempotent_recommit(app_client, admin_cookies):
    make_customer(app_client, admin_cookies, "Acme Clinics")
    other = make_customer(app_client, admin_cookies, "Other Clinics")
    rows = [_row(1, "Acme Clinics"), _row(2, "Acme Clinics", invoice_number="HIST-0001")]
    first = _run(app_client, admin_cookies, rows, _files(1, 2), commit=True)
    assert [r["status"] for r in first["rows"]] == ["ok", "duplicate"]
    assert "duplicate_in_manifest" in _codes(first["rows"][1])

    before = _counts()
    again = _run(app_client, admin_cookies, [_row(1, "Acme Clinics")], _files(1), commit=True)
    assert again["rows"][0]["status"] == "duplicate" and again["rows"][0]["duplicate_of"] == first["rows"][0]["created_id"]
    assert again["committed"] is False and _counts() == before

    # the number is globally unique: another customer's row with it is an error, not a silent second invoice
    clash = _run(app_client, admin_cookies, [_row(5, "Other Clinics", invoice_number="HIST-0001")], _files(5))
    assert clash["rows"][0]["status"] == "error" and "invoice_number_in_use" in _codes(clash["rows"][0])
    assert other


def test_blank_currency_amount_and_scan_are_warnings_not_guesses(app_client, admin_cookies):
    cid = make_customer(app_client, admin_cookies, "Acme Clinics")
    app_client.put(f"/api/finance/customers/{cid}", json={"default_currency": "EGP"}, cookies=admin_cookies)
    rows = [_row(1, "Acme Clinics", currency="", amount="", source_file="")]
    report = _run(app_client, admin_cookies, rows, {}, commit=True)
    row = report["rows"][0]
    assert row["status"] == "warning"
    assert {"currency_defaulted", "amount_missing", "no_scan"} <= set(_codes(row))
    inv = app_client.get(f"{BASE}/{row['created_id']}", cookies=admin_cookies).json()
    assert inv["lines"] == [] and inv["total"] == 0 and inv["has_scan"] is False and inv["currency"] == "EGP"


def test_one_bad_row_never_blocks_the_rest(app_client, admin_cookies):
    make_customer(app_client, admin_cookies, "Acme Clinics")
    rows = [_row(1, "Nobody Inc"), _row(2, "Acme Clinics")]
    report = _run(app_client, admin_cookies, rows, _files(1, 2), commit=True)
    assert [r["status"] for r in report["rows"]] == ["error", "ok"] and report["rows_created"] == 1


def test_only_the_invoice_write_permission_is_needed(app_client, admin_cookies):
    make_customer(app_client, admin_cookies, "Acme Clinics")
    cookies = make_user("inv-importer@hrflow.test", ["finance.invoice.write", "finance.invoice.read"])
    assert _run(app_client, cookies, [_row(1, "Acme Clinics")], _files(1), commit=True)["rows_created"] == 1
    denied = make_user("inv-denied@hrflow.test", ["finance.bill.write"])
    assert post_import(app_client, denied, "invoices", manifest_csv("invoices", [_row(2, "Acme Clinics")]), build_zip(_files(2))).status_code == 403


def test_migration_0042_adds_and_removes_the_invoice_scan_column(tmp_path):
    path = os.path.join(BE_DIR, "migrations", "versions", "0042_invoice_scans.py")
    spec = importlib.util.spec_from_file_location("mig_0042", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'm.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE finance_sales_invoices (id INTEGER PRIMARY KEY)"))
        conn.execute(sa.text(
            "CREATE TABLE finance_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, file_name VARCHAR(255) NOT NULL, "
            "storage_ref VARCHAR(500) NOT NULL)"
        ))
        conn.execute(sa.text("INSERT INTO finance_attachments (file_name, storage_ref) VALUES ('keep.pdf', 'x')"))
    for _ in range(2):
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                mod.upgrade()
    assert "sales_invoice_id" in {c["name"] for c in sa.inspect(engine).get_columns("finance_attachments")}
    for _ in range(2):
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                mod.downgrade()
    assert "sales_invoice_id" not in {c["name"] for c in sa.inspect(engine).get_columns("finance_attachments")}
    with engine.begin() as conn:
        assert conn.execute(sa.text("SELECT file_name FROM finance_attachments")).scalar() == "keep.pdf"
