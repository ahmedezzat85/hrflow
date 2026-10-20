"""
be/finance/services/bills_importer.py
Bills importer for the bulk / historical import (D-033, slice I1).

Each row becomes one Draft bill with its PDF/photo attached. Nothing is approved, scheduled or paid; vendors and
categories are never created. A vendor or category that does not match exactly is left empty and flagged
("vendor to confirm"), so the owner decides in the normal Draft workflow.
"""
import os
import re
import uuid
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from finance import bill_status as bs
from finance import import_config as cfg
from finance.import_manifest import parse_amount, parse_iso_date
from finance.import_report import LEVEL_DUPLICATE, LEVEL_ERROR, LEVEL_WARNING, Finding
from finance.models import BillDB, TransactionCategoryDB, VendorDB
from finance.repositories.bills_repository import BillsRepository
from finance.services.bill_extractor import BillPdfExtractor
from finance.services.bills_service import BillActor, BillsService
from finance.services.import_service import ImportActor, KindImporter, RowContext, finding, register_importer

CAPTURE_SOURCE = "import"
DEFAULT_CURRENCY = "EGP"  # the same default the PDF upload uses when the document does not say


def _norm_number(value: Optional[str]) -> str:
    return re.sub(r"[^0-9A-Za-z]", "", value or "").upper()


def _clean_display_name(name: str) -> str:
    """The name shown for the attachment. Display only: the stored file name is generated."""
    base = os.path.basename((name or "").replace("\\", "/"))
    base = re.sub(r"[\x00-\x1f]", "", base).strip()
    return (base or "import")[:255]


class BillsImporter:
    def __init__(self, db: Session, actor: ImportActor):
        from repositories.sql.audit import SqlAuditRepository

        self.db = db
        self.actor = actor
        self.service = BillsService(BillsRepository(db), audit=SqlAuditRepository())
        self._vendors: Optional[List[VendorDB]] = None
        self._categories: Optional[Dict[str, TransactionCategoryDB]] = None
        self._seen_keys: Dict[tuple, int] = {}

    # ------------------------------------------------------------------
    # Lookups (loaded once per run)
    # ------------------------------------------------------------------
    def _vendor_rows(self) -> List[VendorDB]:
        if self._vendors is None:
            self._vendors = self.db.query(VendorDB).all()
        return self._vendors

    def _category_map(self) -> Dict[str, TransactionCategoryDB]:
        if self._categories is None:
            self._categories = {
                (c.name or "").strip().lower(): c
                for c in self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.is_active == True).all()  # noqa: E712
            }
        return self._categories

    # ------------------------------------------------------------------
    # Row resolution: shared by the dry run and the commit
    # ------------------------------------------------------------------
    def _resolve(self, ctx: RowContext):
        """Returns (data, lines_data, findings). `data` is None when the row cannot be imported."""
        row = ctx.row
        findings: List[Finding] = []
        missing: List[str] = []

        def err(code, msg):
            findings.append(finding(LEVEL_ERROR, code, msg))

        def warn(code, msg):
            findings.append(finding(LEVEL_WARNING, code, msg))

        # Dates: ISO or blank. Blank is listed in missing_fields, never guessed.
        dates = {}
        for name in ("issue_date", "due_date"):
            raw = row.get(name)
            if not raw:
                missing.append(name)
                dates[name] = None
                continue
            try:
                dates[name] = parse_iso_date(raw)
            except ValueError as e:
                err(f"{name}_invalid", f"{name}: {e}")
        if dates.get("issue_date") and dates.get("due_date") and dates["due_date"] < dates["issue_date"]:
            warn("due_before_issue", "due_date is earlier than issue_date")

        # Currency
        currency = (row.get("currency") or "").upper()
        if not currency:
            currency = DEFAULT_CURRENCY
            warn("currency_defaulted", f"currency is blank; {DEFAULT_CURRENCY} was used. Check it in the Draft")
        elif currency not in cfg.KNOWN_CURRENCIES:
            err("currency_unknown", f"currency '{row.get('currency')}' is not one of {', '.join(cfg.KNOWN_CURRENCIES)}")

        # Total
        total = None
        raw_total = row.get("total_amount")
        if not raw_total:
            missing.append("total")
        else:
            try:
                total = parse_amount(raw_total)
                if total <= 0:
                    err("total_not_positive", "total_amount must be greater than 0")
            except ValueError as e:
                err("total_amount_invalid", f"total_amount: {e}")

        # Bill number
        bill_number = row.get("bill_number") or None
        if bill_number is None:
            missing.append("bill_number")
        elif len(bill_number) > 50:
            err("bill_number_too_long", "bill_number is longer than 50 characters")

        # Vendor: exact name (case-insensitive) among active vendors; never created
        vendor_id = None
        suggested = None
        vendor_name = row.get("vendor_name")
        if not vendor_name:
            missing.append("vendor")
        else:
            matches = [v for v in self._vendor_rows() if (v.name or "").strip().lower() == vendor_name.lower()]
            active = [v for v in matches if v.is_active]
            if len(active) == 1:
                vendor_id = active[0].id
            else:
                suggested = vendor_name[:255]
                if len(active) > 1:
                    warn("vendor_ambiguous", f"More than one active vendor is named '{vendor_name}'; choose one in the Draft")
                elif matches:
                    warn("vendor_inactive", f"Vendor '{vendor_name}' is inactive; choose a vendor in the Draft")
                else:
                    warn("vendor_unknown", f"Vendor '{vendor_name}' does not exist; it was not created. Choose a vendor in the Draft")

        # Category: exact name among active categories; never created
        category_id, category_name = None, None
        raw_category = row.get("category")
        if not raw_category:
            missing.append("category")
        else:
            cat = self._category_map().get(raw_category.lower())
            if cat:
                category_id, category_name = cat.id, cat.name
            else:
                missing.append("category")
                warn("category_unknown", f"Category '{raw_category}' does not exist; it was not created. Choose one in the Draft")

        # A Draft needs a vendor or an attachment (D-019)
        if vendor_id is None and ctx.entry is None:
            err("vendor_or_file_required", "A Draft needs a known vendor or a source file")

        if any(f.level == LEVEL_ERROR for f in findings):
            return None, [], findings

        description = row.get("description") or "Invoice total"
        lines = []
        if total is not None:
            lines = [{"description": description[:255], "quantity": 1.0, "unit_price": total, "line_total": total}]

        data = {
            "status": bs.DRAFT,
            "capture_source": CAPTURE_SOURCE,
            "is_reviewed": False,
            "created_by": ctx.actor.email,
            "vendor_id": vendor_id,
            "vendor_to_confirm": vendor_id is None,
            "suggested_vendor_name": suggested,
            "bill_number": bill_number,
            "issue_date": dates.get("issue_date"),
            "due_date": dates.get("due_date"),
            "currency": currency,
            "category_id": category_id,
            "category": category_name,
            "extraction_confidence": ctx.confidence,
            "missing_fields": ",".join(missing) if missing else None,
            "import_batch_id": ctx.batch_id,
        }
        return data, lines, findings

    # ------------------------------------------------------------------
    # Dry run
    # ------------------------------------------------------------------
    def check_row(self, ctx: RowContext) -> List[Finding]:
        data, _lines, findings = self._resolve(ctx)
        if data is None:
            return findings

        if ctx.entry is not None:
            import hashlib

            fingerprint = hashlib.sha256(ctx.entry.data).hexdigest()
            dup = (
                self.db.query(BillDB)
                .filter(BillDB.file_fingerprint == fingerprint, BillDB.status != bs.VOID)
                .first()
            )
            if dup:
                findings.append(finding(LEVEL_DUPLICATE, "duplicate_existing", f"This file is already attached to bill #{dup.id}"))
                return findings

        number = data["bill_number"]
        if number:
            key = (data["vendor_id"] or (data["suggested_vendor_name"] or "").lower(), _norm_number(number))
            if data["vendor_id"] is not None:
                dup = (
                    self.db.query(BillDB)
                    .filter(BillDB.vendor_id == data["vendor_id"], BillDB.bill_number == number, BillDB.status != bs.VOID)
                    .first()
                )
                if dup:
                    findings.append(
                        finding(LEVEL_DUPLICATE, "duplicate_existing", f"Vendor and bill number already exist as bill #{dup.id}")
                    )
                    return findings
            if key in self._seen_keys:
                findings.append(
                    finding(LEVEL_DUPLICATE, "duplicate_in_manifest", f"Same vendor and bill number as line {self._seen_keys[key]}")
                )
                return findings
            self._seen_keys[key] = ctx.row.line
            other = self.db.query(BillDB).filter(BillDB.bill_number == number, BillDB.status != bs.VOID).first()
            if other:
                findings.append(
                    finding(
                        LEVEL_WARNING,
                        "bill_number_in_use",
                        f"Bill number '{number}' is already used by bill #{other.id} (another vendor); submitting this Draft will need a different number",
                    )
                )

        findings.extend(self._extractor_cross_check(ctx, data))
        return findings

    @staticmethod
    def _extractor_cross_check(ctx: RowContext, data: dict) -> List[Finding]:
        """Free second opinion on the transcription (plan 25, I1). Warning only: it never changes a value, never
        blocks a row, and is silent for anything that has no text layer."""
        entry = ctx.entry
        if entry is None or not entry.base_name.lower().endswith(".pdf"):
            return []
        try:
            extraction = BillPdfExtractor.parse_document(content=entry.data, filename=entry.base_name, known_vendors=[])
        except Exception:
            return []
        if not extraction.is_readable:
            return []
        missing = set(extraction.missing_fields or [])
        out: List[Finding] = []

        def mismatch(label, pdf_value, manifest_value):
            out.append(
                finding(
                    LEVEL_WARNING,
                    "extractor_mismatch",
                    f"{label}: the PDF text says '{pdf_value}' but the manifest says '{manifest_value}'",
                )
            )

        if data["bill_number"] and extraction.bill_number and "bill_number" not in missing:
            if _norm_number(extraction.bill_number) != _norm_number(data["bill_number"]):
                mismatch("bill_number", extraction.bill_number, data["bill_number"])
        manifest_total = ctx.row.get("total_amount")
        if manifest_total and extraction.total is not None and "total" not in missing:
            try:
                if abs(extraction.total - parse_amount(manifest_total)) > 0.01:
                    mismatch("total_amount", f"{extraction.total:.2f}", manifest_total)
            except ValueError:
                pass
        for name in ("issue_date", "due_date"):
            pdf_value = getattr(extraction, name)
            if data[name] and pdf_value and name not in missing and pdf_value != data[name]:
                mismatch(name, pdf_value, data[name])
        return out

    # ------------------------------------------------------------------
    # Commit
    # ------------------------------------------------------------------
    def create_row(self, ctx: RowContext) -> int:
        data, lines, _findings = self._resolve(ctx)
        if data is None:
            raise ValueError("Row is not importable")

        path = None
        if ctx.entry is not None:
            import hashlib

            content = ctx.entry.data
            ext = os.path.splitext(ctx.entry.base_name)[1].lower()
            data["file_fingerprint"] = hashlib.sha256(content).hexdigest()
            data["attachment_name"] = _clean_display_name(ctx.entry.base_name)
            path = self.service.write_file(f"{uuid.uuid4().hex}{ext}", content)
            data["attachment_url"] = path

        provenance = f"Imported (batch {ctx.batch_id}, row {ctx.row.get('row_ref')}"
        if ctx.row.get("source_file"):
            provenance += f", file {ctx.row.get('source_file')}"
        provenance += ")."
        if ctx.row.get("review_flags"):
            provenance += f" Review flags: {ctx.row.get('review_flags')}."
        data["notes"] = provenance + (f"\n{ctx.row.get('notes')}" if ctx.row.get("notes") else "")

        try:
            bill = self.service.repo.create(data, lines)
        except Exception:
            self.db.rollback()
            if path:
                try:
                    os.remove(path)
                except OSError:
                    pass
            raise
        actor = BillActor(email=ctx.actor.email, is_super_admin=ctx.actor.is_super_admin, permissions=ctx.actor.permissions)
        self.service._audit(
            "created", bill.id, actor, None, bill.status, f"imported from batch {ctx.batch_id} row {ctx.row.get('row_ref')}"
        )
        return bill.id


register_importer("bills", lambda db, actor: BillsImporter(db, actor))
