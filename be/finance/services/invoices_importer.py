"""
be/finance/services/invoices_importer.py
Sales invoices importer for the bulk / historical import (D-033, slice I4).

Rows become DRAFT sales invoices with the scan attached (finance_attachments.sales_invoice_id). Nothing is sent,
paid or posted; customers are never created. An invoice cannot be stored without a customer, number and dates
(NOT NULL columns), so those are required: an unknown customer is an error, not an empty field.
"""
import os
import uuid
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from finance import import_config as cfg
from finance.import_archive import detect_content_type
from finance.import_manifest import parse_amount, parse_iso_date
from finance.import_report import LEVEL_DUPLICATE, LEVEL_ERROR, LEVEL_WARNING, Finding
from finance.models import CustomerDB
from finance.repositories.invoices_repository import InvoicesRepository
from finance.schemas import SalesInvoiceCreate, SalesInvoiceLineCreate
from finance.services.import_service import ImportActor, RowContext, finding, register_importer
from finance.services.invoices_service import InvoicesService
from finance.services.subscriptions_service import FINANCE_UPLOADS_DIR

REQUIRED_FIELDS = ("customer_name", "invoice_number", "issue_date", "due_date")
_MIME = {"pdf": "application/pdf", "png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp", "heic": "image/heic"}


def _display_name(name: str) -> str:
    base = os.path.basename((name or "").replace("\\", "/"))
    return "".join(ch for ch in base if ch >= " ").strip()[:255] or "invoice-scan"


class InvoicesImporter:
    def __init__(self, db: Session, actor: ImportActor):
        from repositories.sql.audit import SqlAuditRepository

        self.db = db
        self.actor = actor
        self.audit = SqlAuditRepository()
        self.repo = InvoicesRepository(db)
        self.service = InvoicesService(self.repo)
        self._customers: Optional[List[CustomerDB]] = None
        self._seen: Dict[str, int] = {}

    def _customer_rows(self) -> List[CustomerDB]:
        if self._customers is None:
            self._customers = self.db.query(CustomerDB).all()
        return self._customers

    def _resolve(self, ctx: RowContext):
        row = ctx.row
        findings: List[Finding] = []

        def err(code, msg):
            findings.append(finding(LEVEL_ERROR, code, msg))

        def warn(code, msg):
            findings.append(finding(LEVEL_WARNING, code, msg))

        blank = [f for f in REQUIRED_FIELDS if not row.get(f)]
        if blank:
            err("required_missing", f"{', '.join(blank)} is required for a sales invoice")

        customer = None
        name = row.get("customer_name")
        if name:
            matches = [c for c in self._customer_rows() if (c.name or "").strip().lower() == name.lower()]
            active = [c for c in matches if c.is_active]
            if len(active) == 1:
                customer = active[0]
            elif len(active) > 1:
                err("customer_ambiguous", f"More than one active customer is named '{name}'")
            elif matches:
                err("customer_inactive", f"Customer '{name}' is inactive")
            else:
                err("customer_unknown", f"Customer '{name}' does not exist; customers are never created by an import")

        dates = {}
        for field in ("issue_date", "due_date"):
            if row.get(field):
                try:
                    dates[field] = parse_iso_date(row.get(field))
                except ValueError as e:
                    err(f"{field}_invalid", f"{field}: {e}")
        if dates.get("issue_date") and dates.get("due_date") and dates["due_date"] < dates["issue_date"]:
            err("due_before_issue", "due_date cannot precede issue_date")

        currency = (row.get("currency") or "").upper()
        if not currency:
            if customer is not None and customer.default_currency:
                currency = customer.default_currency.upper()
                warn("currency_defaulted", f"currency is blank; the customer's default {currency} was used")
            else:
                err("currency_missing", "currency is required (the customer has no default currency)")
        elif currency not in cfg.KNOWN_CURRENCIES:
            err("currency_unknown", f"currency '{row.get('currency')}' is not one of {', '.join(cfg.KNOWN_CURRENCIES)}")

        number = row.get("invoice_number")
        if number and len(number) > 50:
            err("invoice_number_too_long", "invoice_number is longer than 50 characters")

        amount = None
        if not row.get("amount"):
            warn("amount_missing", "amount is blank: the Draft has no lines. Add them in the Draft")
        else:
            try:
                amount = parse_amount(row.get("amount"))
                if amount <= 0:
                    err("amount_not_positive", "amount must be greater than 0")
            except ValueError as e:
                err("amount_invalid", f"amount: {e}")

        vat_rate = None
        if row.get("vat_rate"):
            try:
                vat_rate = parse_amount(row.get("vat_rate"))
                if not 0 <= vat_rate <= 100:
                    err("vat_rate_invalid", "vat_rate must be between 0 and 100")
            except ValueError as e:
                err("vat_rate_invalid", f"vat_rate: {e}")

        if ctx.entry is None:
            warn("no_scan", "No source file: the Draft has no scan attached")

        if any(f.level == LEVEL_ERROR for f in findings):
            return None, findings
        return {"customer": customer, "invoice_number": number, "issue_date": dates["issue_date"], "due_date": dates["due_date"],
                "currency": currency, "amount": amount, "vat_rate": vat_rate, "description": row.get("description")}, findings

    # ------------------------------------------------------------------
    def check_row(self, ctx: RowContext) -> List[Finding]:
        data, findings = self._resolve(ctx)
        if data is None:
            return findings
        number = data["invoice_number"]
        existing = self.repo.get_by_number(number)
        if existing:
            if existing.customer_id == data["customer"].id:
                findings.append(
                    finding(LEVEL_DUPLICATE, "duplicate_existing", f"Invoice {number} already exists for this customer as invoice #{existing.id}")
                )
            else:
                findings.append(
                    finding(LEVEL_ERROR, "invoice_number_in_use", f"Invoice number '{number}' is already used by invoice #{existing.id} (another customer)")
                )
            return findings
        key = number.strip().lower()
        if key in self._seen:
            findings.append(finding(LEVEL_DUPLICATE, "duplicate_in_manifest", f"Same invoice number as line {self._seen[key]}"))
            return findings
        self._seen[key] = ctx.row.line
        return findings

    def create_row(self, ctx: RowContext) -> int:
        data, _findings = self._resolve(ctx)
        if data is None:
            raise ValueError("Row is not importable")

        provenance = f"Imported (batch {ctx.batch_id}, row {ctx.row.get('row_ref')}"
        if ctx.row.get("source_file"):
            provenance += f", file {ctx.row.get('source_file')}"
        provenance += ")."
        if ctx.confidence is not None:
            provenance += f" Confidence {ctx.confidence:g}."
        if ctx.row.get("review_flags"):
            provenance += f" Review flags: {ctx.row.get('review_flags')}."
        notes = provenance + (f"\n{ctx.row.get('notes')}" if ctx.row.get("notes") else "")

        lines = []
        if data["amount"] is not None:
            lines = [SalesInvoiceLineCreate(
                description=(data["description"] or "Invoice total")[:255], quantity=1.0,
                unit_price=data["amount"], line_total=data["amount"],
            )]
        payload = SalesInvoiceCreate(
            customer_id=data["customer"].id,
            invoice_number=data["invoice_number"],
            issue_date=data["issue_date"],
            due_date=data["due_date"],
            currency=data["currency"],
            vat_rate=data["vat_rate"],
            notes=notes,
            lines=lines,
        )

        path = None
        if ctx.entry is not None:
            ext = os.path.splitext(ctx.entry.base_name)[1].lower()
            os.makedirs(FINANCE_UPLOADS_DIR, exist_ok=True)
            path = os.path.join(FINANCE_UPLOADS_DIR, f"{uuid.uuid4().hex}{ext}")
            with open(path, "wb") as fh:
                fh.write(ctx.entry.data)
        try:
            invoice = self.service.create_invoice(payload, import_batch_id=ctx.batch_id)
            if path is not None:
                mime = _MIME.get(detect_content_type(ctx.entry.data[:16]) or "", "application/octet-stream")
                self.repo.add_attachment(
                    invoice_id=invoice.id,
                    file_name=_display_name(ctx.entry.base_name),
                    file_size=len(ctx.entry.data),
                    mime_type=mime,
                    storage_ref=path,
                    uploaded_by=ctx.actor.email,
                )
        except Exception:
            self.db.rollback()
            if path:
                try:
                    os.remove(path)
                except OSError:
                    pass
            raise

        try:
            self.audit.log(
                "invoice.created", ctx.actor.email, "invoice", invoice.id,
                f"draft; imported from batch {ctx.batch_id} row {ctx.row.get('row_ref')}",
            )
        except Exception:
            pass
        return invoice.id


register_importer("invoices", lambda db, actor: InvoicesImporter(db, actor))
