#!/usr/bin/env python3
"""
scripts/migrate_file_layout.py
Migration CLI for File-Storage Root and Folder Layout (F4 / Plan §4.4).

Moves existing files from legacy paths to layout-v1 relative refs, updates database
records atomically, logs orphan files, and produces an audit CSV report.

Safety features:
- Dry-run by default (--apply required to write).
- Copy -> SHA-256 verify -> update DB record -> remove old file.
- Idempotent: skips records already at target paths.
- Reports missing files and orphan files without destructive actions.
"""
import argparse
import csv
import datetime
import hashlib
import os
import sys
from typing import Dict, List, Optional, Set, Tuple

# Ensure be/ is in sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
BE_DIR = os.path.join(REPO_ROOT, "be")
if BE_DIR not in sys.path:
    sys.path.insert(0, BE_DIR)

import file_layout
from config import Config
from db import get_db_context
from models_db import (
    EmployeeDB,
    EmployeeDocumentDB,
    CompanyDocumentDB,
    SalaryPaymentDocDB,
)
from finance.models import (
    BillDB,
    FinanceChequeDB,
    FinanceAttachmentDB,
    FinanceBankAccountDB,
    SubscriptionChargeDB,
    AccountBalanceCheckpointDB,
    BankStatementImportDB,
    LedgerTransactionDB,
    VendorDB,
    SalesInvoiceDB,
    CustomerDB,
)


def _compute_sha256(filepath: str) -> str:
    hasher = hashlib.sha256()
    with open(filepath, "rb") as fh:
        while True:
            chunk = fh.read(65536)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


class FileMigrator:
    def __init__(self, root: Optional[str] = None, apply: bool = False, verbose: bool = False):
        self.root = os.path.abspath(root or file_layout.get_files_root())
        self.apply = apply
        self.verbose = verbose
        self.report_rows: List[Dict[str, str]] = []
        self.all_db_refs: Set[str] = set()

    def log(self, msg: str):
        if self.verbose:
            print(msg)

    def record(self, entity_type: str, entity_id: str, old_ref: str, new_ref: str, status: str, sha256: str = "", error: str = ""):
        row = {
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "old_ref": old_ref or "",
            "new_ref": new_ref or "",
            "status": status,
            "sha256": sha256 or "",
            "error": error or "",
        }
        self.report_rows.append(row)
        if self.verbose or status not in ("already_migrated",):
            prefix = "[APPLY]" if self.apply else "[DRY-RUN]"
            print(f"{prefix} {entity_type} #{entity_id}: {status} (old='{old_ref}' -> new='{new_ref}') {error}")

    def migrate_single_record(
        self,
        entity_type: str,
        entity_id: str,
        old_ref: Optional[str],
        new_ref: str,
        db_updater_fn,
    ):
        clean_old = (old_ref or "").strip()
        if not clean_old:
            self.record(entity_type, entity_id, clean_old, new_ref, "empty_ref")
            return

        self.all_db_refs.add(clean_old)
        self.all_db_refs.add(new_ref)

        norm_old = clean_old.replace("\\", "/").lstrip("/")
        norm_new = new_ref.replace("\\", "/").lstrip("/")

        # Check if already migrated
        new_path = os.path.join(self.root, os.path.normpath(norm_new))
        if norm_old == norm_new and os.path.isfile(new_path):
            sha = _compute_sha256(new_path)
            self.record(entity_type, entity_id, clean_old, new_ref, "already_migrated", sha256=sha)
            return

        # Locate old file on disk
        old_path = None
        try:
            old_path = file_layout.resolve_path(clean_old, root=self.root, must_exist=True)
        except (FileNotFoundError, ValueError):
            old_path = None

        if not old_path or not os.path.isfile(old_path):
            self.record(entity_type, entity_id, clean_old, new_ref, "missing_disk_file", error="File not found at legacy path")
            return

        old_sha = _compute_sha256(old_path)

        if not self.apply:
            self.record(entity_type, entity_id, clean_old, new_ref, "dry_run_pending", sha256=old_sha)
            return

        # Perform migration safely
        try:
            with open(old_path, "rb") as fh:
                content = fh.read()

            file_layout.save_file(content, new_ref, root=self.root)
            new_sha = _compute_sha256(new_path)

            if old_sha != new_sha:
                if os.path.exists(new_path):
                    os.remove(new_path)
                self.record(entity_type, entity_id, clean_old, new_ref, "error", error=f"SHA-256 mismatch: old={old_sha} new={new_sha}")
                return

            # Update DB
            db_updater_fn(new_ref)

            # Remove old file if it differs from new path
            if os.path.abspath(old_path) != os.path.abspath(new_path):
                try:
                    os.remove(old_path)
                except OSError as err:
                    self.log(f"Warning: could not remove old file '{old_path}': {err}")

            self.record(entity_type, entity_id, clean_old, new_ref, "migrated", sha256=new_sha)

        except Exception as exc:
            self.record(entity_type, entity_id, clean_old, new_ref, "error", error=str(exc))

    def run_migrations(self, db) -> Dict[str, int]:
        file_layout.ensure_meta(self.root)

        # 1. Finance Bills
        bills = db.query(BillDB).filter(BillDB.scan.has(FinanceAttachmentDB.storage_ref != "")).all()
        for b in bills:
            vendor_name = b.vendor.name if b.vendor else (b.suggested_vendor_name or "vendor")
            clean_name = b.attachment_name or b.attachment_url or "bill.pdf"
            ext = os.path.splitext(clean_name)[1].lstrip(".") or "pdf"
            new_ref = file_layout.build_ref(
                "bill",
                date=b.issue_date or b.created_at,
                bill_id=b.id,
                vendor_slug=vendor_name,
                ext=ext,
            )

            def _update_bill(r, bill=b):
                bill.attachment_url = r
                db.commit()

            self.migrate_single_record("BillDB", str(b.id), b.attachment_url, new_ref, _update_bill)

        # 2. Finance Attachments
        atts = db.query(FinanceAttachmentDB).filter(FinanceAttachmentDB.bill_id.is_(None), FinanceAttachmentDB.storage_ref.isnot(None), FinanceAttachmentDB.storage_ref != "", FinanceAttachmentDB.storage_ref != "pending").all()
        for a in atts:
            clean_name = a.file_name or a.storage_ref or "file.pdf"
            ext = os.path.splitext(clean_name)[1].lstrip(".") or "pdf"
            new_ref = None

            if a.cheque_id and a.cheque:
                chq = a.cheque
                acc = chq.account
                acc_folder = file_layout.build_account_folder(
                    account_id=acc.id if acc else chq.account_id,
                    bank_name=acc.bank_name if acc else None,
                    currency=acc.currency if acc else None,
                    account_name=acc.account_name if acc else None,
                )
                new_ref = file_layout.build_ref(
                    "cheque",
                    date=chq.fiscal_year or chq.issue_date,
                    account_folder=acc_folder,
                    cheque_number=chq.cheque_number,
                    cheque_id=chq.id,
                    att_id=a.id,
                    ext=ext,
                )
            elif a.checkpoint_id:
                cp = db.query(AccountBalanceCheckpointDB).filter(AccountBalanceCheckpointDB.id == a.checkpoint_id).first()
                acc = cp.account if cp else None
                acc_folder = file_layout.build_account_folder(
                    account_id=acc.id if acc else (cp.account_id if cp else 0),
                    bank_name=acc.bank_name if acc else None,
                    currency=acc.currency if acc else None,
                    account_name=acc.account_name if acc else None,
                )
                new_ref = file_layout.build_ref(
                    "balance_checkpoint",
                    date=cp.date if cp else None,
                    account_folder=acc_folder,
                    checkpoint_id=cp.id if cp else a.checkpoint_id,
                    att_id=a.id,
                    ext=ext,
                )
            elif a.sales_invoice_id:
                inv = a.sales_invoice or db.query(SalesInvoiceDB).filter(SalesInvoiceDB.id == a.sales_invoice_id).first()
                cust_name = inv.customer.name if (inv and inv.customer) else "customer"
                new_ref = file_layout.build_ref(
                    "sales_invoice",
                    date=inv.issue_date if inv else None,
                    invoice_id=inv.id if inv else a.sales_invoice_id,
                    customer_name=cust_name,
                    ext=ext,
                )
            elif a.ledger_transaction_id and a.ledger_transaction:
                tx = a.ledger_transaction
                new_ref = file_layout.build_ref(
                    "ledger_attachment",
                    date=tx.date or tx.created_at,
                    transaction_id=tx.id,
                    att_id=a.id,
                    ext=ext,
                )
            elif a.statement_import_id and a.statement_import:
                st = a.statement_import
                acc = st.bank_account
                acc_folder = file_layout.build_account_folder(
                    account_id=acc.id if acc else st.account_id,
                    bank_name=acc.bank_name if acc else None,
                    currency=acc.currency if acc else None,
                    account_name=acc.account_name if acc else None,
                )
                new_ref = file_layout.build_ref(
                    "statement",
                    date=st.period_month,
                    account_folder=acc_folder,
                    period=st.period_month,
                    att_id=a.id,
                    ext=ext,
                )
            elif a.subscription_charge_id and a.subscription_charge:
                sc = a.subscription_charge
                sub = sc.subscription
                sub_id = sub.id if sub else sc.subscription_id
                sub_slug = sub.name if sub else "subscription"
                new_ref = file_layout.build_ref(
                    "subscription_proof",
                    date=sc.billing_date,
                    subscription_id=sub_id,
                    slug=sub_slug,
                    charge_date=sc.billing_date,
                    att_id=a.id,
                    ext=ext,
                )
            elif a.import_batch_id:
                new_ref = file_layout.build_ref(
                    "import_batch",
                    batch_id=a.import_batch_id,
                    filename=a.file_name,
                    att_id=a.id,
                    ext=ext,
                )

            if new_ref:
                def _update_att(r, att=a):
                    att.storage_ref = r
                    db.commit()

                self.migrate_single_record("FinanceAttachmentDB", str(a.id), a.storage_ref, new_ref, _update_att)

        # 3. Employee Documents
        emp_docs = db.query(EmployeeDocumentDB).filter(EmployeeDocumentDB.drive_file_id.isnot(None), EmployeeDocumentDB.drive_file_id != "").all()
        for ed in emp_docs:
            emp = ed.employee
            emp_name = emp.name if emp else "employee"
            new_ref = file_layout.build_ref(
                "employee_document",
                employee_id=ed.employee_id,
                employee_name=emp_name,
                filename=ed.name,
            )

            def _update_emp_doc(r, doc=ed):
                doc.drive_file_id = r
                db.commit()

            self.migrate_single_record("EmployeeDocumentDB", str(ed.id), ed.drive_file_id, new_ref, _update_emp_doc)

        # 4. Company Documents
        comp_docs = db.query(CompanyDocumentDB).filter(CompanyDocumentDB.drive_file_id.isnot(None), CompanyDocumentDB.drive_file_id != "").all()
        for cd in comp_docs:
            new_ref = file_layout.build_ref(
                "company_document",
                filename=cd.name,
            )

            def _update_comp_doc(r, doc=cd):
                doc.drive_file_id = r
                db.commit()

            self.migrate_single_record("CompanyDocumentDB", str(cd.id), cd.drive_file_id, new_ref, _update_comp_doc)

        # 5. Salary Payment Docs
        sal_docs = db.query(SalaryPaymentDocDB).filter(SalaryPaymentDocDB.drive_file_id.isnot(None), SalaryPaymentDocDB.drive_file_id != "").all()
        for sd in sal_docs:
            clean_name = sd.document_name or sd.drive_file_id or "doc.docx"
            ext = os.path.splitext(clean_name)[1].lstrip(".") or "docx"
            new_ref = file_layout.build_ref(
                "salary_payment_doc",
                year=sd.payment_year,
                month=sd.payment_month,
                doc_number=sd.invoice_number,
                employee_id=sd.employee_id,
                employee_name=sd.employee_name,
                ext=ext,
            )

            def _update_sal_doc(r, doc=sd):
                doc.drive_file_id = r
                db.commit()

            self.migrate_single_record("SalaryPaymentDocDB", str(sd.id), sd.drive_file_id, new_ref, _update_sal_doc)

        return self.get_summary()

    def scan_orphans(self) -> int:
        """Finds files on disk under root that have no corresponding record in the database."""
        orphan_count = 0
        ignore_dirs = {"_meta", "_incoming", ".git", "__pycache__", ".pytest_cache"}

        for dirpath, dirnames, filenames in os.walk(self.root):
            rel_dir = os.path.relpath(dirpath, self.root)
            parts = rel_dir.replace("\\", "/").split("/")
            if any(p in ignore_dirs for p in parts if p and p != "."):
                continue

            for f in filenames:
                full_path = os.path.join(dirpath, f)
                rel_posix = os.path.relpath(full_path, self.root).replace("\\", "/")

                # Skip root meta files
                if rel_posix.startswith("_meta/") or rel_posix.startswith("_incoming/"):
                    continue

                if rel_posix not in self.all_db_refs:
                    # Also check if base name or normalized path is known
                    orphan_count += 1
                    sha = _compute_sha256(full_path)
                    self.record("DiskOrphan", "0", rel_posix, "", "orphan_disk_file", sha256=sha)

        return orphan_count

    def get_summary(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for r in self.report_rows:
            st = r["status"]
            counts[st] = counts.get(st, 0) + 1
        return counts

    def write_csv_report(self, report_path: Optional[str] = None) -> str:
        if not report_path:
            meta_migrations = os.path.join(self.root, "_meta", "migrations")
            os.makedirs(meta_migrations, exist_ok=True)
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            mode = "apply" if self.apply else "dryrun"
            report_path = os.path.join(meta_migrations, f"{timestamp}_{mode}_migration.csv")
        else:
            os.makedirs(os.path.dirname(os.path.abspath(report_path)), exist_ok=True)

        fieldnames = ["entity_type", "entity_id", "old_ref", "new_ref", "status", "sha256", "error"]
        with open(report_path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames)
            writer.writeheader()
            for r in self.report_rows:
                writer.writerow(r)

        return report_path


def main():
    parser = argparse.ArgumentParser(description="HRFlow File Storage Layout Migration Tool (F4)")
    parser.add_argument("--apply", action="store_true", help="Perform real migration (default is dry-run)")
    parser.add_argument("--root", type=str, default=None, help="Root folder override (defaults to HRFLOW_FILES_ROOT)")
    parser.add_argument("--report", type=str, default=None, help="Path for CSV output report")
    parser.add_argument("--skip-orphans", action="store_true", help="Skip scanning disk for orphan files")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose console output")

    args = parser.parse_args()

    print(f"=== HRFlow File Storage Layout Migration CLI ===")
    print(f"Mode: {'APPLY (live migration)' if args.apply else 'DRY RUN (preview only)'}")
    print(f"Root: {args.root or file_layout.get_files_root()}")
    print("-" * 50)

    migrator = FileMigrator(root=args.root, apply=args.apply, verbose=args.verbose)

    with get_db_context() as db:
        summary = migrator.run_migrations(db)

    if not args.skip_orphans:
        print("\nScanning for disk orphans...")
        migrator.scan_orphans()

    report_file = migrator.write_csv_report(args.report)

    print("\n" + "=" * 50)
    print("MIGRATION SUMMARY:")
    for status, count in sorted(migrator.get_summary().items()):
        print(f"  {status:<20}: {count}")
    print(f"\nAudit Report written to: {report_file}")
    print("=" * 50)


if __name__ == "__main__":
    main()
