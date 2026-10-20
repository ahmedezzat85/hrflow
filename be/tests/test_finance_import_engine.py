"""
be/tests/test_finance_import_engine.py
Slice I0 of the bulk / historical import (D-033, plan 25): manifest parsing, file and ZIP safety, batch table
and migration, router permissions per kind, limits, and the dry-run / commit engine (with a stand-in importer;
the real importers are tested with their own slices).
"""
import importlib.util
import io
import os
import stat
import zipfile

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from finance import import_config as cfg
from finance.import_archive import ArchiveRejected, check_document_bytes, open_archive
from finance.import_manifest import (
    ManifestError,
    parse_amount,
    parse_confidence,
    parse_iso_date,
    parse_manifest,
)
from finance.import_report import LEVEL_DUPLICATE, LEVEL_ERROR, LEVEL_WARNING
from finance.services import import_service
from finance.services.import_service import finding
from bill_test_helpers import make_user
from import_test_helpers import (
    JPEG_BYTES,
    PNG_BYTES,
    build_zip,
    image_only_pdf,
    manifest_csv,
    manifest_xlsx,
    post_import,
    text_pdf,
)

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _bill_row(n, **extra):
    row = {"row_ref": f"B-{n:04d}", "source_file": f"bill-{n:04d}.pdf", "vendor_name": "Acme", "bill_number": f"INV-{n}",
           "issue_date": "2026-04-10", "due_date": "2026-05-10", "currency": "USD", "total_amount": "100.00"}
    row.update(extra)
    return row


# ── Manifest parsing ────────────────────────────────────────────────────────
def test_csv_with_bom_and_xlsx_parse_to_the_same_rows():
    rows = [_bill_row(1), _bill_row(2)]
    from_csv = parse_manifest("m.csv", manifest_csv("bills", rows, bom=True), "bills")
    from_xlsx = parse_manifest("m.xlsx", manifest_xlsx("bills", rows), "bills")
    assert [r.values for r in from_csv.rows] == [r.values for r in from_xlsx.rows]
    assert from_csv.rows[0].get("row_ref") == "B-0001"
    assert from_csv.rows[0].line == 2 and from_csv.rows[1].line == 3


def test_xlsx_numeric_and_date_cells_stay_strings_and_iso():
    from datetime import datetime
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["row_ref", "account", "cheque_number", "payee", "amount", "currency", "issue_date"])
    ws.append(["C-1", "Main", 1001, "Payee", 250.5, "EGP", datetime(2026, 3, 5)])
    buf = io.BytesIO()
    wb.save(buf)
    m = parse_manifest("m.xlsx", buf.getvalue(), "cheques")
    v = m.rows[0].values
    assert v["cheque_number"] == "1001" and v["amount"] == "250.5" and v["issue_date"] == "2026-03-05"


def test_manifest_structure_errors():
    with pytest.raises(ManifestError, match="missing required column"):
        parse_manifest("m.csv", manifest_csv("bills", [_bill_row(1)], columns=["row_ref", "vendor_name"]), "bills")
    with pytest.raises(ManifestError, match="no document rows"):
        parse_manifest("m.csv", manifest_csv("bills", []), "bills")
    with pytest.raises(ManifestError, match="empty"):
        parse_manifest("m.csv", b"", "bills")
    with pytest.raises(ManifestError, match="not UTF-8"):
        parse_manifest("m.csv", b"row_ref,vendor_name\n\xff\xfe,x\n", "bills")
    with pytest.raises(ManifestError, match="comma-separated"):
        parse_manifest("m.csv", b"row_ref;vendor_name\nB-1;x\n", "bills")
    with pytest.raises(ManifestError, match=r"\.csv or \.xlsx"):
        parse_manifest("m.txt", b"row_ref\n", "bills")
    with pytest.raises(ManifestError, match="is an Excel workbook"):
        parse_manifest("m.csv", manifest_xlsx("bills", [_bill_row(1)]), "bills")
    with pytest.raises(ManifestError, match="not an Excel workbook"):
        parse_manifest("m.xlsx", b"row_ref,vendor_name\n", "bills")
    with pytest.raises(ManifestError, match="repeated column"):
        parse_manifest("m.csv", b"row_ref,row_ref\nB-1,B-2\n", "bills")


def test_unknown_columns_warn_and_blank_rows_are_skipped():
    cols = list(parse_manifest("m.csv", manifest_csv("bills", [_bill_row(1)]), "bills").headers) + ["internal"]
    data = manifest_csv("bills", [_bill_row(1), {}, _bill_row(2)], columns=cols)
    m = parse_manifest("m.csv", data, "bills")
    assert len(m.rows) == 2 and "internal" in m.warnings[0]


def test_document_limit_is_enforced(monkeypatch):
    monkeypatch.setattr(cfg, "MAX_DOCUMENTS_PER_RUN", 2)
    with pytest.raises(ManifestError, match="more than 2 documents"):
        parse_manifest("m.csv", manifest_csv("bills", [_bill_row(i) for i in range(1, 4)]), "bills")


def test_cell_parsers():
    assert parse_iso_date("2026-02-28") == "2026-02-28"
    for bad in ("2026-02-30", "28/02/2026", "2026-2-3", ""):
        with pytest.raises(ValueError):
            parse_iso_date(bad)
    assert parse_amount("1200.50") == 1200.5
    for bad in ("1,200.50", "EGP 5", "1e3", "", "12,5"):
        with pytest.raises(ValueError):
            parse_amount(bad)
    assert parse_confidence("") is None and parse_confidence("0.85") == 0.85
    for bad in ("1.5", "-0.1", "high"):
        with pytest.raises(ValueError):
            parse_confidence(bad)


# ── ZIP and file safety ─────────────────────────────────────────────────────
def test_valid_archive_matches_case_insensitively_and_ignores_junk():
    z = build_zip({"Bill-0001.PDF": text_pdf("A", "1", 5), "sub/scan.png": PNG_BYTES,
                   "__MACOSX/._bill": b"x", ".DS_Store": b"x", "Thumbs.db": b"x"})
    a = open_archive(z)
    assert set(a.entries) == {"bill-0001.pdf", "scan.png"}
    assert a.find("bill-0001.pdf").problem is None and a.find("SCAN.PNG").problem is None
    assert a.find("missing.pdf") is None


@pytest.mark.parametrize("name", ["../evil.pdf", "a/../../evil.pdf", "/abs/evil.pdf", "C:/evil.pdf", "a\\..\\evil.pdf"])
def test_path_traversal_and_absolute_paths_reject_the_archive(name):
    with pytest.raises(ArchiveRejected, match="unsafe path"):
        open_archive(build_zip({name: text_pdf("A", "1", 5)}))


def test_symlink_nested_archive_and_encrypted_entries_reject_the_archive():
    link = zipfile.ZipInfo("link.pdf")
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    with pytest.raises(ArchiveRejected, match="symbolic link"):
        open_archive(build_zip({}, extra=[link]))

    with pytest.raises(ArchiveRejected, match="nested archive"):
        open_archive(build_zip({"inner.zip": b"x"}))
    with pytest.raises(ArchiveRejected, match="nested archive"):
        open_archive(build_zip({"disguised.pdf": b"PK\x03\x04rest"}))

    # set the "encrypted" bit in the central directory record of a valid entry
    raw = bytearray(build_zip({"secret.pdf": text_pdf("A", "1", 5)}))
    cd = raw.index(b"PK")
    raw[cd + 8] |= 0x1
    with pytest.raises(ArchiveRejected, match="encrypted"):
        open_archive(bytes(raw))


def test_not_a_zip_and_damaged_zip():
    with pytest.raises(ArchiveRejected, match="not a ZIP"):
        open_archive(b"%PDF-1.4 not a zip")
    with pytest.raises(ArchiveRejected, match="empty"):
        open_archive(b"")
    with pytest.raises(ArchiveRejected, match="damaged"):
        open_archive(build_zip({"a.pdf": text_pdf("A", "1", 5)})[:-30])


def test_per_file_problems_do_not_reject_the_archive():
    z = build_zip({
        "notes.txt": b"hello",  # type not allowed
        "fake.pdf": PNG_BYTES,  # magic bytes do not match the extension
        "empty.pdf": b"",
        "good.jpg": JPEG_BYTES,
    })
    a = open_archive(z)
    assert "not allowed" in a.find("notes.txt").problem
    assert "does not match" in a.find("fake.pdf").problem
    assert "empty" in a.find("empty.pdf").problem
    assert a.find("good.jpg").problem is None
    assert check_document_bytes("x.heic", b"\x00\x00\x00\x18ftypheic" + b"\x00" * 8) is None


def test_zip_bomb_limits(monkeypatch):
    big = {"a.pdf": b"%PDF" + b"\x00" * 4000, "b.pdf": b"%PDF" + b"\x00" * 4000}
    monkeypatch.setattr(cfg, "MAX_UNCOMPRESSED_BYTES", 5000)
    with pytest.raises(ArchiveRejected, match="expands to more than"):
        open_archive(build_zip(big))

    monkeypatch.undo()
    monkeypatch.setattr(cfg, "MAX_ARCHIVE_ENTRIES", 1)
    with pytest.raises(ArchiveRejected, match="more than 1 files"):
        open_archive(build_zip(big))

    # a single file over the per-file cap fails that file only
    monkeypatch.undo()
    monkeypatch.setattr(cfg, "MAX_FILE_BYTES", 1000)
    a = open_archive(build_zip({"a.pdf": b"%PDF" + b"\x00" * 4000, "ok.pdf": b"%PDF-1"}))
    assert "larger than" in a.find("a.pdf").problem and a.find("ok.pdf").problem is None


def test_declared_size_lies_cannot_smuggle_extra_bytes(monkeypatch):
    """The reader stops at the declared size, so a lie shows up as a damaged entry instead of extra data."""
    z = build_zip({"a.pdf": b"%PDF" + bytes(4000)})
    real_infolist = zipfile.ZipFile.infolist

    def lying(self):
        infos = real_infolist(self)
        for i in infos:
            i.file_size = 10  # declared small, actually large
        return infos

    monkeypatch.setattr(zipfile.ZipFile, "infolist", lying)
    with pytest.raises(ArchiveRejected, match="damaged"):
        open_archive(z)


def test_same_base_name_in_two_folders_is_ambiguous():
    a = open_archive(build_zip({"x/bill.pdf": text_pdf("A", "1", 5), "y/bill.pdf": text_pdf("A", "2", 6)}))
    assert a.ambiguous == ["bill.pdf"]


# ── Migration ───────────────────────────────────────────────────────────────
def _migration():
    path = os.path.join(BE_DIR, "migrations", "versions", "0041_import_batches.py")
    spec = importlib.util.spec_from_file_location("mig_0041", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_upgrades_idempotently_and_downgrades(tmp_path):
    mod = _migration()
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'm.db'}")
    with engine.begin() as conn:
        for t in mod.TARGET_TABLES:
            conn.execute(sa.text(f"CREATE TABLE {t} (id INTEGER PRIMARY KEY, name VARCHAR(20))"))
            conn.execute(sa.text(f"INSERT INTO {t} (id, name) VALUES (1, 'keep')"))

    for _ in range(2):
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                mod.upgrade()

    insp = sa.inspect(engine)
    assert "finance_import_batches" in insp.get_table_names()
    for t in mod.TARGET_TABLES:
        assert "import_batch_id" in {c["name"] for c in insp.get_columns(t)}
    with engine.begin() as conn:
        assert conn.execute(sa.text("SELECT import_batch_id FROM finance_bills WHERE id = 1")).scalar() is None

    for _ in range(2):  # downgrade is idempotent too
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                mod.downgrade()
    insp = sa.inspect(engine)
    assert "finance_import_batches" not in insp.get_table_names()
    for t in mod.TARGET_TABLES:
        assert "import_batch_id" not in {c["name"] for c in insp.get_columns(t)}
    with engine.begin() as conn:
        assert conn.execute(sa.text("SELECT name FROM finance_bills WHERE id = 1")).scalar() == "keep"


# ── Router: authentication and permission per kind ──────────────────────────
def _package(n=2):
    rows = [_bill_row(i) for i in range(1, n + 1)]
    files = {f"bill-{i:04d}.pdf": text_pdf("Acme", f"INV-{i}", 100.0) for i in range(1, n + 1)}
    return manifest_csv("bills", rows), build_zip(files)


def test_unauthenticated_and_wrong_permission_callers(app_client, admin_cookies, employee_cookies):
    manifest, archive = _package()
    for kind in cfg.KINDS:
        for commit in (False, True):
            assert post_import(app_client, None, kind, manifest, archive, commit).status_code == 401
            assert post_import(app_client, employee_cookies, kind, manifest, archive, commit).status_code == 403
    assert app_client.get("/api/finance/imports/limits").status_code == 401
    assert app_client.get("/api/finance/imports/limits", cookies=employee_cookies).status_code == 403

    bills_only = make_user("bills-only@hrflow.test", ["finance.bill.write"])
    cheques_only = make_user("cheques-only@hrflow.test", ["finance.account.write"])
    invoices_only = make_user("invoices-only@hrflow.test", ["finance.invoice.write"])
    expect = {"bills": bills_only, "cheques": cheques_only, "invoices": invoices_only}
    for kind, cookies in expect.items():
        for other_kind in cfg.KINDS:
            code = post_import(app_client, cookies, other_kind, manifest, archive).status_code
            if other_kind == kind:
                assert code == 200, (kind, code)
            else:
                assert code == 403, (kind, other_kind, code)
        limits = app_client.get("/api/finance/imports/limits", cookies=cookies).json()
        assert limits["kinds"] == [kind]
    # reading bills is not enough to import them
    reader = make_user("bill-reader@hrflow.test", ["finance.bill.read"])
    assert post_import(app_client, reader, "bills", manifest, archive).status_code == 403
    assert post_import(app_client, admin_cookies, "payroll", manifest, archive).status_code == 404


def test_limits_endpoint_for_admin(app_client, admin_cookies):
    body = app_client.get("/api/finance/imports/limits", cookies=admin_cookies).json()
    assert body["kinds"] == list(cfg.KINDS)
    assert body["max_documents_per_run"] == 50 and body["max_request_bytes"] == 24 * 1024 * 1024
    assert ".pdf" in body["allowed_extensions"] and body["low_confidence_threshold"] == 0.8


# ── Limits ──────────────────────────────────────────────────────────────────
def test_over_limit_requests_are_refused_with_the_documented_message(app_client, admin_cookies, monkeypatch):
    manifest, archive = _package()
    monkeypatch.setattr(cfg, "MAX_REQUEST_BYTES", 500)
    resp = post_import(app_client, admin_cookies, "bills", manifest, archive)
    assert resp.status_code == 413
    assert "Split the batch" in resp.json()["detail"] and "compress" in resp.json()["detail"]

    monkeypatch.undo()
    monkeypatch.setattr(cfg, "MAX_MANIFEST_BYTES", 50)
    resp = post_import(app_client, admin_cookies, "bills", manifest, archive)
    assert resp.status_code == 413 and "manifest" in resp.json()["detail"]


def test_package_errors_come_back_in_the_report(app_client, admin_cookies):
    manifest, archive = _package()
    bad_zip = post_import(app_client, admin_cookies, "bills", manifest, b"not a zip").json()
    assert bad_zip["file_errors"] and "not a ZIP" in bad_zip["file_errors"][0] and bad_zip["rows"] == []
    bad_manifest = post_import(app_client, admin_cookies, "bills", b"row_ref\nB-1\n", archive).json()
    assert "missing required column" in bad_manifest["file_errors"][0]
    # a commit with package errors writes nothing and says so
    committed = post_import(app_client, admin_cookies, "bills", b"row_ref\nB-1\n", archive, commit=True).json()
    assert committed["committed"] is False and committed["batch_id"] is None


# ── Engine: dry run, commit, structural checks (stand-in importer) ──────────
class FakeImporter:
    """Creates nothing real; records calls so the engine's contract can be asserted."""
    created = []

    def __init__(self, db, actor):
        self.db = db

    def check_row(self, ctx):
        out = []
        if ctx.row.get("bill_number") == "INV-DUP":
            out.append(finding(LEVEL_DUPLICATE, "duplicate_existing", "Already imported as bill #77"))
        if ctx.row.get("bill_number") == "INV-WARN":
            out.append(finding(LEVEL_WARNING, "vendor_unknown", "Vendor not found"))
        if ctx.row.get("bill_number") == "INV-BAD":
            out.append(finding(LEVEL_ERROR, "bad", "Bad row"))
        return out

    def create_row(self, ctx):
        if ctx.row.get("bill_number") == "INV-BOOM":
            raise RuntimeError("secret internal detail")
        FakeImporter.created.append((ctx.row.get("row_ref"), ctx.batch_id, ctx.entry.base_name if ctx.entry else None))
        return 1000 + len(FakeImporter.created)


def _counts():
    from db import get_db_context
    from finance.models import ImportBatchDB

    with get_db_context() as db:
        return db.query(ImportBatchDB).count()


def test_dry_run_writes_nothing_and_reports_every_row(app_client, admin_cookies, monkeypatch):
    monkeypatch.setitem(import_service._IMPORTERS, "bills", FakeImporter)
    FakeImporter.created = []
    rows = [_bill_row(1), _bill_row(2, bill_number="INV-DUP"), _bill_row(3, bill_number="INV-WARN"),
            _bill_row(4, bill_number="INV-BAD")]
    files = {f"bill-{i:04d}.pdf": text_pdf("Acme", f"INV-{i}", 100.0 + i) for i in range(1, 5)}
    before = _counts()
    report = post_import(app_client, admin_cookies, "bills", manifest_csv("bills", rows), build_zip(files)).json()
    assert _counts() == before and FakeImporter.created == []
    assert report["dry_run"] is True and report["committed"] is False and report["batch_id"] is None
    assert [r["status"] for r in report["rows"]] == ["ok", "duplicate", "warning", "error"]
    assert (report["rows_ok"], report["rows_warning"], report["rows_error"], report["rows_duplicate"]) == (1, 1, 1, 1)
    assert report["rows"][1]["duplicate_of"] == 77


def test_structural_checks(app_client, admin_cookies, monkeypatch):
    monkeypatch.setitem(import_service._IMPORTERS, "bills", FakeImporter)
    shared = text_pdf("Acme", "S", 50.0)
    rows = [
        _bill_row(1),
        _bill_row(2, row_ref="B-0001"),  # repeated row_ref
        _bill_row(3, source_file="missing.pdf"),  # not in the ZIP
        _bill_row(4, source_file="bill-0001.pdf"),  # repeated source_file
        _bill_row(5, source_file="copy-a.pdf"),
        _bill_row(6, source_file="copy-b.pdf"),  # same bytes as copy-a
        _bill_row(7, source_file="bad.pdf"),  # magic bytes mismatch
        _bill_row(8, confidence="2"),  # confidence out of range
        _bill_row(9, row_ref="", source_file=""),  # no row_ref
    ]
    files = {"bill-0001.pdf": text_pdf("Acme", "INV-1", 100.0), "copy-a.pdf": shared, "copy-b.pdf": shared,
             "bad.pdf": PNG_BYTES, "orphan.pdf": text_pdf("Acme", "ORPHAN", 9.0)}
    report = post_import(app_client, admin_cookies, "bills", manifest_csv("bills", rows), build_zip(files)).json()
    by_line = {r["line"]: r for r in report["rows"]}
    codes = {line: [f["code"] for f in r["findings"]] for line, r in by_line.items()}
    assert report["rows"][0]["status"] == "ok"
    assert "duplicate_row_ref" in codes[3]
    assert "source_file_missing" in codes[4] and by_line[4]["status"] == "error"
    assert "duplicate_source_file" in codes[5] and by_line[5]["status"] == "duplicate"
    assert codes[6] == [] and "duplicate_file_content" in codes[7]
    assert "source_file_invalid" in codes[8]
    assert "confidence_invalid" in codes[9]
    assert "row_ref_missing" in codes[10]
    assert report["unreferenced_files"] == ["orphan.pdf"]
    assert any("not referenced" in w for w in report["file_warnings"])


def test_commit_creates_row_by_row_and_one_bad_row_never_blocks_the_batch(app_client, admin_cookies, monkeypatch):
    monkeypatch.setitem(import_service._IMPORTERS, "bills", FakeImporter)
    FakeImporter.created = []
    rows = [_bill_row(1), _bill_row(2, bill_number="INV-BOOM"), _bill_row(3, bill_number="INV-DUP"),
            _bill_row(4, bill_number="INV-WARN")]
    files = {f"bill-{i:04d}.pdf": text_pdf("Acme", f"INV-{i}", 100.0 + i) for i in range(1, 5)}
    before = _counts()
    resp = post_import(app_client, admin_cookies, "bills", manifest_csv("bills", rows), build_zip(files), commit=True)
    assert resp.status_code == 200
    report = resp.json()
    assert report["committed"] is True and report["batch_id"] and _counts() == before + 1
    statuses = [r["status"] for r in report["rows"]]
    assert statuses == ["ok", "error", "duplicate", "warning"]
    assert report["rows"][0]["created_id"] and report["rows"][3]["created_id"]
    assert report["rows"][1]["created_id"] is None
    assert "secret internal detail" not in resp.text  # unexpected errors are not leaked
    assert [c[0] for c in FakeImporter.created] == ["B-0001", "B-0004"]
    assert all(c[1] == report["batch_id"] for c in FakeImporter.created)
    assert (report["rows_created"], report["rows_failed"]) == (2, 2)

    from db import get_db_context
    from finance.models import ImportBatchDB

    with get_db_context() as db:
        b = db.get(ImportBatchDB, report["batch_id"])
        assert (b.kind, b.rows_total, b.rows_created, b.rows_failed) == ("bills", 4, 2, 2)
        assert b.created_by == "admin@hrflow.test" and b.manifest_name == "manifest.csv" and b.archive_name == "package.zip"


def test_commit_with_nothing_importable_creates_no_batch(app_client, admin_cookies, monkeypatch):
    monkeypatch.setitem(import_service._IMPORTERS, "bills", FakeImporter)
    rows = [_bill_row(1, bill_number="INV-BAD")]
    before = _counts()
    report = post_import(app_client, admin_cookies, "bills", manifest_csv("bills", rows),
                         build_zip({"bill-0001.pdf": text_pdf("Acme", "X", 1.0)}), commit=True).json()
    assert report["committed"] is False and report["batch_id"] is None and _counts() == before


def test_kind_without_an_importer_validates_the_package_and_refuses_commit(app_client, admin_cookies, monkeypatch):
    monkeypatch.delitem(import_service._IMPORTERS, "bills", raising=False)
    manifest, archive = _package()
    dry = post_import(app_client, admin_cookies, "bills", manifest, archive).json()
    assert any("not available yet" in w for w in dry["file_warnings"]) and dry["rows_ok"] == 2
    assert post_import(app_client, admin_cookies, "bills", manifest, archive, commit=True).status_code == 501


def test_xlsx_manifest_through_the_endpoint(app_client, admin_cookies, monkeypatch):
    monkeypatch.setitem(import_service._IMPORTERS, "bills", FakeImporter)
    rows = [_bill_row(1)]
    resp = post_import(app_client, admin_cookies, "bills", manifest_xlsx("bills", rows),
                       build_zip({"bill-0001.pdf": text_pdf("Acme", "INV-1", 1.0)}), manifest_name="m.xlsx")
    assert resp.status_code == 200 and resp.json()["rows_ok"] == 1


def test_image_only_pdf_and_text_pdf_are_both_accepted_as_documents():
    assert check_document_bytes("a.pdf", image_only_pdf()) is None
    assert check_document_bytes("a.pdf", text_pdf("A", "1", 2.0)) is None
