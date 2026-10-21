"""
be/tests/test_file_layout.py
Unit tests for be/file_layout.py (F1 of docs/file-storage/26-file-storage-layout-plan.md).
"""
import datetime
import json
import os
from unittest.mock import patch

import pytest

import file_layout


def test_get_files_root_call_time_resolution(monkeypatch, tmp_path):
    """Verifies that get_files_root resolves at call-time from HRFLOW_FILES_ROOT, falling back to LOCAL_STORAGE_PATH."""
    # 1. Custom HRFLOW_FILES_ROOT
    custom_root = tmp_path / "custom_files_root"
    monkeypatch.setenv("HRFLOW_FILES_ROOT", str(custom_root))
    assert file_layout.get_files_root() == str(custom_root.resolve())

    # 2. Fallback to LOCAL_STORAGE_PATH
    monkeypatch.delenv("HRFLOW_FILES_ROOT", raising=False)
    local_root = tmp_path / "legacy_storage_path"
    monkeypatch.setenv("LOCAL_STORAGE_PATH", str(local_root))
    assert file_layout.get_files_root() == str(local_root.resolve())

    # 3. Default fallback
    monkeypatch.delenv("LOCAL_STORAGE_PATH", raising=False)
    default_root = file_layout.get_files_root()
    assert default_root.endswith("storage")


def test_ensure_meta_creates_layout_and_readme(tmp_path):
    """Verifies _meta/layout.json and _meta/README.txt are created in the root."""
    file_layout.ensure_meta(str(tmp_path))
    meta_json = tmp_path / "_meta" / "layout.json"
    readme_txt = tmp_path / "_meta" / "README.txt"

    assert meta_json.is_file()
    assert readme_txt.is_file()

    with open(meta_json, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data.get("layout_version") == 1

    with open(readme_txt, "r", encoding="utf-8") as f:
        content = f.read()
    assert "Managed by HRFlow" in content


def test_slugify_windows_safe_and_reserved_names():
    """Verifies slugification strips accents, handles special characters and Windows reserved names."""
    # Normalization & accents
    assert file_layout.slugify("Hélène & François / Medical") == "helene-francois-medical"
    assert file_layout.slugify("ACME Supplies (Pvt) Ltd.") == "acme-supplies-pvt-ltd"

    # Windows reserved device names
    assert file_layout.slugify("CON") == "_con"
    assert file_layout.slugify("nul") == "_nul"
    assert file_layout.slugify("aux") == "_aux"
    assert file_layout.slugify("com1") == "_com1"
    assert file_layout.slugify("lpt3") == "_lpt3"

    # Trailing dots/spaces and length clamping
    assert file_layout.slugify("...my slug...") == "my-slug"
    long_text = "a" * 100
    assert len(file_layout.slugify(long_text)) <= file_layout.MAX_SLUG_LENGTH

    # Empty fallback
    assert file_layout.slugify("") == "unknown"
    assert file_layout.slugify("---") == "item"


def test_account_folder_formatting():
    """Verifies bank account vs cash account folder formatting."""
    # Bank account with bank name and currency
    bank_folder = file_layout.build_account_folder(
        account_id=7, bank_name="Commercial International Bank", currency="USD"
    )
    assert bank_folder == "7-commercial-international-usd"

    # Cash account (no bank name)
    cash_folder = file_layout.build_account_folder(
        account_id=2, bank_name=None, account_name="Main Office Cash", currency="EGP"
    )
    assert cash_folder == "2-main-office-cash"


def test_build_ref_all_kinds():
    """Verifies build_ref generates correct POSIX refs for every supported domain kind."""
    # 1. Vendor bill
    ref = file_layout.build_ref("bill", year=2026, month=9, bill_id=123, vendor_slug="acme-supplies", ext="pdf")
    assert ref == "finance/2026/bills/2026-09/bill-123__acme-supplies.pdf"

    # 2. Sales invoice
    ref = file_layout.build_ref("sales_invoice", year=2026, month=4, invoice_id=45, customer_name="Global Health", ext="pdf")
    assert ref == "finance/2026/sales-invoices/2026-04/inv-45__global-health.pdf"

    # 3. Cheque
    ref = file_layout.build_ref(
        "cheque", year=2026, account_folder="7-cib-usd", cheque_number="004592", att_id=88, ext="jpg"
    )
    assert ref == "finance/2026/cheques/7-cib-usd/chq-004592__88.jpg"

    # 4. Bank statement
    ref = file_layout.build_ref(
        "statement", year=2026, account_folder="7-cib-usd", period="2026-08", att_id=14, ext="csv"
    )
    assert ref == "finance/2026/statements/7-cib-usd/2026-08__14.csv"

    # 5. Subscription proof
    ref = file_layout.build_ref(
        "subscription_proof", year=2026, subscription_id=3, slug="github-enterprise",
        charge_date="2026-08-15", att_id=22, ext="pdf"
    )
    assert ref == "finance/2026/subscriptions/3-github-enterprise/2026-08-15__proof-22.pdf"

    # 6. Ledger attachment
    ref = file_layout.build_ref(
        "ledger_attachment", year=2026, month=7, transaction_id=501, att_id=99, ext="png"
    )
    assert ref == "finance/2026/ledger-attachments/2026-07/txn-501__99.png"

    # 7. Balance checkpoint
    ref = file_layout.build_ref(
        "balance_checkpoint", year=2026, account_folder="2-cash-egp", checkpoint_id=12, att_id=7, ext="pdf"
    )
    assert ref == "finance/2026/balance-checkpoints/2-cash-egp/chkpt-12__7.pdf"

    # 8. Import batch
    ref = file_layout.build_ref("import_batch", batch_id="b-20260901", filename="statement_sept.csv")
    assert ref == "finance/imports/b-20260901/statement-sept.csv"

    # 9. Employee document
    ref = file_layout.build_ref("employee_document", employee_id=101, employee_name="Jane Doe", filename="contract.pdf")
    assert ref == "hr/employees/101-jane-doe/documents/contract.pdf"

    # 10. Employee bank proof
    ref = file_layout.build_ref("employee_bank_proof", employee_id=101, employee_name="Jane Doe", filename="iban_proof.png")
    assert ref == "hr/employees/101-jane-doe/bank-account-proofs/iban-proof.png"

    # 11. Salary payment doc (HR)
    ref = file_layout.build_ref(
        "salary_payment_doc", year=2026, month=8, doc_number="V-2026-08-101",
        employee_id=101, employee_name="Jane Doe", ext="pdf"
    )
    assert ref == "hr/salary-payment-docs/2026/2026-08/v-2026-08-101__101-jane-doe.pdf"

    # 12. Company document
    ref = file_layout.build_ref("company_document", filename="Health_Insurance_Policy_2026.pdf")
    assert ref == "hr/company-documents/health-insurance-policy-2026.pdf"


def test_build_ref_max_length_clamping():
    """Ensures build_ref enforces MAX_REF_LENGTH (200 characters)."""
    very_long_vendor = "v" * 150
    ref = file_layout.build_ref("bill", year=2026, month=10, bill_id=999999, vendor_slug=very_long_vendor, ext="pdf")
    assert len(ref) <= file_layout.MAX_REF_LENGTH
    assert ref.startswith("finance/2026/bills/2026-10/bill-999999__")
    assert ref.endswith(".pdf")


def test_resolve_path_traversal_rejection(tmp_path):
    """Verifies that directory traversal attempts are strictly rejected."""
    with pytest.raises(ValueError, match="path traversal"):
        file_layout.resolve_path("../outside.pdf", root=str(tmp_path))

    with pytest.raises(ValueError, match="path traversal"):
        file_layout.resolve_path("finance/../../etc/passwd", root=str(tmp_path))

    with pytest.raises(ValueError, match="path traversal"):
        file_layout.resolve_path("finance\\..\\..\\windows\\system32", root=str(tmp_path))


def test_resolve_path_symlink_escape_rejection(tmp_path):
    """Verifies symlink escapes pointing outside root are rejected."""
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    secret_file = outside_dir / "secret.txt"
    secret_file.write_text("classified")

    root_dir = tmp_path / "files_root"
    root_dir.mkdir()

    symlink_target = root_dir / "symlink_escape.txt"

    secret_real = os.path.abspath(str(secret_file))

    def mock_realpath(path, **kwargs):
        if "symlink_escape" in str(path):
            return secret_real
        return os.path.abspath(path)

    with patch("os.path.islink", return_value=True), \
         patch("os.path.realpath", side_effect=mock_realpath):
        with pytest.raises(ValueError, match="Symlink escape attempt"):
            file_layout.resolve_path("symlink_escape.txt", root=str(root_dir))


def test_save_read_exists_delete_lifecycle(tmp_path):
    """Verifies atomic save_file, read_file, exists_file, and delete_file."""
    content = b"PDF-TEST-CONTENT-12345"
    ref = "finance/2026/bills/2026-09/bill-10__acme.pdf"

    # Save
    saved_ref = file_layout.save_file(content, ref, root=str(tmp_path))
    assert saved_ref == ref

    # Exists & Read
    assert file_layout.exists_file(ref, root=str(tmp_path))
    read_data = file_layout.read_file(ref, root=str(tmp_path))
    assert read_data == content

    # Verify _meta was created
    assert (tmp_path / "_meta" / "layout.json").is_file()

    # Delete
    deleted = file_layout.delete_file(ref, root=str(tmp_path))
    assert deleted is True
    assert not file_layout.exists_file(ref, root=str(tmp_path))

    # Deleting non-existent file returns False
    assert file_layout.delete_file(ref, root=str(tmp_path)) is False


def test_legacy_fallback_resolution(tmp_path, monkeypatch):
    """Verifies legacy paths (absolute paths, legacy folders) are resolved if not yet in layout-v1."""
    root_dir = tmp_path / "root"
    root_dir.mkdir()
    legacy_bills = root_dir / "finance_bills"
    legacy_bills.mkdir()

    old_bill_file = legacy_bills / "old_uuid_bill.pdf"
    old_bill_file.write_bytes(b"old-bill-content")

    # 1. Bare legacy ref under legacy subfolder
    resolved = file_layout.resolve_path("old_uuid_bill.pdf", root=str(root_dir), must_exist=True)
    assert resolved == str(old_bill_file.resolve())

    # 2. Absolute legacy path
    abs_resolved = file_layout.resolve_path(str(old_bill_file), root=str(root_dir), must_exist=True)
    assert abs_resolved == str(old_bill_file.resolve())

    # 3. Environment legacy directory fallback
    legacy_attachments = tmp_path / "legacy_fin_attachments"
    legacy_attachments.mkdir()
    old_scan = legacy_attachments / "scan_123.pdf"
    old_scan.write_bytes(b"old-scan-content")

    monkeypatch.setenv("FINANCE_UPLOADS_DIR", str(legacy_attachments))
    resolved_scan = file_layout.resolve_path("scan_123.pdf", root=str(root_dir), must_exist=True)
    assert resolved_scan == str(old_scan.resolve())
