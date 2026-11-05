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

import datetime
import logging
import file_layout
from sqlalchemy.orm import Session

from fastapi import HTTPException

from finance import bill_payment_rules as rules
from finance import bill_status as bs
from finance import import_config as cfg
from finance.import_manifest import parse_amount, parse_iso_date
from finance.import_report import LEVEL_DUPLICATE, LEVEL_ERROR, LEVEL_WARNING, Finding
from finance.models import (
    BankStatementImportDB,
    BillDB,
    FinanceAttachmentDB,
    FinanceBankAccountDB,
    PaymentTypeDB,
    SubscriptionChargeDB,
    SubscriptionDB,
    TransactionCategoryDB,
    VendorDB,
)
from finance.repositories.bills_repository import BillsRepository
from finance.repositories.subscriptions_repository import SubscriptionsRepository
from finance.schemas import BillCreate, BillLineCreate, BillPaymentInline, SubscriptionChargeSettle
from finance.subscription_naming import subscription_bill_number
from finance.services.bill_extractor import BillPdfExtractor
from finance.services.bills_service import BillActor, BillsService
from finance.services.import_service import ImportActor, KindImporter, RowContext, finding, register_importer

logger = logging.getLogger(__name__)

CAPTURE_SOURCE = "import"
SUBSCRIPTION_CATEGORY = "SaaS / Software"  # the category the live subscription settlement gives its bills
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
        self._accounts: Optional[List[FinanceBankAccountDB]] = None
        self._payment_types: Optional[List[PaymentTypeDB]] = None
        self._subscriptions: Optional[List[SubscriptionDB]] = None
        self._projected: Dict[int, float] = {}  # account id -> balance after the paid rows checked so far in this run

    # ------------------------------------------------------------------
    # Lookups (loaded once per run)
    # ------------------------------------------------------------------
    def _account_rows(self) -> List[FinanceBankAccountDB]:
        if self._accounts is None:
            self._accounts = self.db.query(FinanceBankAccountDB).all()
        return self._accounts

    def _payment_type_rows(self) -> List[PaymentTypeDB]:
        if self._payment_types is None:
            self._payment_types = self.db.query(PaymentTypeDB).all()
        return self._payment_types

    def _subscription_rows(self) -> List[SubscriptionDB]:
        if self._subscriptions is None:
            self._subscriptions = self.db.query(SubscriptionDB).all()
        return self._subscriptions

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

        # Subscription and payment (D-052). Both are optional; a payment makes the row an already-paid bill that
        # posts one outflow, and a subscription records that bill as the subscription's charge.
        subscription = self._resolve_subscription(row, err, warn)
        pay = self._resolve_payment(ctx, subscription, err, warn)

        # Dates: ISO or blank. Blank is listed in missing_fields, never guessed.
        dates = {}
        for name in ("issue_date", "due_date"):
            raw = row.get(name)
            if not raw:
                if name == "due_date" and subscription is not None and dates.get("issue_date"):
                    dates[name] = dates["issue_date"]  # a subscription charge is due when it is billed
                    continue
                missing.append(name)
                dates[name] = None
                continue
            try:
                dates[name] = parse_iso_date(raw)
            except ValueError as e:
                err(f"{name}_invalid", f"{name}: {e}")
        if subscription is not None and not dates.get("issue_date") and not any(f.code == "issue_date_invalid" for f in findings):
            err("issue_date_required", "issue_date is required for a subscription charge: it is the billing date")
        if dates.get("issue_date") and dates.get("due_date") and dates["due_date"] < dates["issue_date"]:
            warn("due_before_issue", "due_date is earlier than issue_date")

        # Currency
        currency = (row.get("currency") or "").upper()
        if not currency:
            if subscription is not None:
                currency = (subscription.currency or DEFAULT_CURRENCY).upper()
            elif pay is not None:
                currency = (pay["account"].currency or DEFAULT_CURRENCY).upper()
                warn("currency_defaulted", f"currency is blank; the paying account's {currency} was used")
            else:
                currency = DEFAULT_CURRENCY
                warn("currency_defaulted", f"currency is blank; {DEFAULT_CURRENCY} was used. Check it in the Draft")
        elif currency not in cfg.KNOWN_CURRENCIES:
            err("currency_unknown", f"currency '{row.get('currency')}' is not one of {', '.join(cfg.KNOWN_CURRENCIES)}")
        if subscription is not None and currency != (subscription.currency or "").upper() and currency in cfg.KNOWN_CURRENCIES:
            err("currency_mismatch_subscription", f"currency {currency} differs from the subscription's currency {subscription.currency}")
        if pay is not None and currency in cfg.KNOWN_CURRENCIES and currency != (pay["account"].currency or "").upper():
            err("currency_mismatch", f"currency {currency} differs from the paying account's currency {pay['account'].currency}: a bill is paid from an account in its own currency")

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

        # Bill number. A subscription charge's bill is numbered by the one subscription rule; the vendor's own
        # invoice number from the manifest is kept in the notes.
        vendor_bill_number = None
        bill_number = row.get("bill_number") or None
        if subscription is not None:
            vendor_bill_number = bill_number
            bill_number = subscription_bill_number(subscription.id, subscription.name, dates.get("issue_date") or "") if dates.get("issue_date") else None
        if bill_number is None:
            if subscription is None:
                missing.append("bill_number")
        elif len(bill_number) > 50:
            err("bill_number_too_long", "bill_number is longer than 50 characters")

        # Vendor: exact name (case-insensitive) among active vendors; never created. A subscription brings its own.
        vendor_id = None
        suggested = None
        vendor_name = row.get("vendor_name")
        if subscription is not None:
            vendor_id = subscription.vendor_id
            sub_vendor = next((v for v in self._vendor_rows() if v.id == subscription.vendor_id), None)
            if vendor_name and sub_vendor is not None and (sub_vendor.name or "").strip().lower() != vendor_name.lower():
                warn("vendor_differs_subscription", f"vendor_name '{vendor_name}' differs from the subscription's vendor '{sub_vendor.name}'; the subscription's vendor was used")
        elif not vendor_name:
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
        if not raw_category and subscription is not None:
            category_name = SUBSCRIPTION_CATEGORY
        elif not raw_category:
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
            # not bill columns: what the paid / subscription path needs (popped before the Draft is created)
            "_pay": pay,
            "_subscription": subscription,
            "_vendor_bill_number": vendor_bill_number,
            "_total": total,
        }
        return data, lines, findings

    # ------------------------------------------------------------------
    # Payment and subscription columns (D-052)
    # ------------------------------------------------------------------
    def _resolve_subscription(self, row, err, warn):
        ref = row.get("subscription")
        if not ref:
            return None
        matches = [s for s in self._subscription_rows() if (s.name or "").strip().lower() == ref.lower()]
        if not matches:
            err("subscription_unknown", f"Subscription '{ref}' does not exist (use its exact name); subscriptions are never created by an import")
            return None
        if len(matches) > 1:
            err("subscription_ambiguous", f"More than one subscription is named '{ref}'")
            return None
        return matches[0]

    def _resolve_payment(self, ctx: RowContext, subscription, err, warn):
        """None when the row stays a Draft; otherwise {"account", "payment_type", "date", "reference"}."""
        row = ctx.row
        paid_date_raw, account_ref = row.get("paid_date"), row.get("paid_from_account")
        type_ref, reference = row.get("payment_type"), row.get("payment_reference")
        if not paid_date_raw and not account_ref:
            if type_ref or reference:
                err("payment_incomplete", "payment_type / payment_reference need paid_date and paid_from_account")
            elif subscription is not None:
                err("subscription_needs_payment", "A subscription charge is recorded as paid: fill paid_date and paid_from_account")
            return None
        if not paid_date_raw or not account_ref:
            err("payment_incomplete", "paid_date and paid_from_account must both be filled, or both left blank for a Draft")
            return None

        ok = True
        paid_date = None
        try:
            paid_date = parse_iso_date(paid_date_raw)
        except ValueError as e:
            err("paid_date_invalid", f"paid_date: {e}")
            ok = False

        matches = [a for a in self._account_rows() if (a.account_name or "").strip().lower() == account_ref.lower()]
        if not matches and account_ref.isdigit():
            matches = [a for a in self._account_rows() if a.id == int(account_ref)]
        account = None
        if not matches:
            err("account_unknown", f"Account '{account_ref}' does not exist (use its exact name or id)")
            ok = False
        elif len(matches) > 1:
            err("account_ambiguous", f"More than one account is named '{account_ref}'; use its id")
            ok = False
        else:
            account = matches[0]
            if not account.is_active:
                err("account_inactive", f"Account '{account.account_name}' is inactive")
                ok = False

        if not (ctx.actor.can("finance.bill.pay") and ctx.actor.can("finance.bill.approve")):
            err("payment_permission", "Importing an already-paid bill needs both finance.bill.pay and finance.bill.approve")
            ok = False
        if not ok or account is None:
            return None

        account_type = (account.account_type or "bank").lower()
        allowed = rules.BILL_PAYMENT_TYPE_CODES_BY_ACCOUNT_TYPE.get(account_type, frozenset())
        if type_ref:
            pts = [p for p in self._payment_type_rows() if (p.code or "").lower() == type_ref.lower() or (p.name or "").strip().lower() == type_ref.lower()]
            pt = pts[0] if len(pts) == 1 else None
            if pt is None:
                err("payment_type_unknown", f"Payment type '{type_ref}' was not found (use its code or exact name)")
                return None
        else:
            code = rules.DEFAULT_PAYMENT_TYPE_CODE_BY_ACCOUNT_TYPE.get(account_type)
            pt = next((p for p in self._payment_type_rows() if p.code == code), None)
            if pt is None:
                err("payment_type_unknown", "No default payment type exists for this account; fill payment_type")
                return None
        if not pt.is_active or pt.code not in allowed:
            err("payment_type_not_allowed", f"Payment type '{pt.name}' cannot be used to pay a bill from a {account_type} account")
            return None
        if pt.code == rules.CHEQUE:
            err("payment_type_cheque", "A cheque payment needs a cheque number, which an import does not carry: import the cheque on the cheques tab or use another payment type")
            return None

        closed = (
            self.db.query(BankStatementImportDB)
            .filter(
                BankStatementImportDB.account_id == account.id,
                BankStatementImportDB.period_month == paid_date[:7],
                BankStatementImportDB.status == "closed",
            )
            .first()
        )
        if closed:
            err("period_closed", f"The reconciliation period {paid_date[:7]} is closed for account '{account.account_name}'")
            return None
        issue = row.get("issue_date")
        if issue and paid_date < issue:
            warn("paid_before_issue", "paid_date is earlier than issue_date")
        return {"account": account, "payment_type": pt, "date": paid_date, "reference": (reference or "")[:100]}

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

        if data["_pay"] is not None:
            findings.extend(self._check_paid_row(ctx, data))
        findings.extend(self._extractor_cross_check(ctx, data))
        return findings

    def _check_paid_row(self, ctx: RowContext, data: dict) -> List[Finding]:
        """What creating and paying the bill would be refused for, found before anything is written."""
        out: List[Finding] = []
        pay, total, sub = data["_pay"], data["_total"], data["_subscription"]
        account = pay["account"]
        import hashlib

        if total is None or total <= 0:
            return [finding(LEVEL_ERROR, "total_required_to_pay", "total_amount is required (and above 0) to record a payment")]

        # The same checks a bill must pass to leave Draft (vendor, number, dates, category, duplicates)
        try:
            self.service._validate_leaving_draft(
                vendor_id=data["vendor_id"], bill_number=data["bill_number"], issue_date=data["issue_date"],
                due_date=data["due_date"], category_id=data["category_id"], category=data["category"], total=total,
                file_fingerprint=hashlib.sha256(ctx.entry.data).hexdigest() if ctx.entry is not None else None,
                is_duplicate_override=False, duplicate_override_reason=None,
            )
        except HTTPException as e:
            if isinstance(e.detail, list):
                return [finding(LEVEL_ERROR, "not_ready_to_pay", f"{d.get('msg', 'Invalid')} (a paid bill leaves Draft, so it needs it)") for d in e.detail]
            level = LEVEL_DUPLICATE if e.status_code == 409 else LEVEL_ERROR
            return [finding(level, "duplicate_existing" if level == LEVEL_DUPLICATE else "not_ready_to_pay", str(e.detail))]

        if sub is not None:
            charge = (
                self.db.query(SubscriptionChargeDB)
                .filter(SubscriptionChargeDB.subscription_id == sub.id, SubscriptionChargeDB.billing_date == data["issue_date"])
                .first()
            )
            if charge is not None and charge.status != "expected":
                return [finding(LEVEL_DUPLICATE, "duplicate_existing", f"Subscription '{sub.name}' already has a {charge.status} charge for {data['issue_date']} (charge #{charge.id})")]

        # No overdraft on any account (the settlement rule), counted across the paid rows of this run
        # (skipped for a partial-visibility account, whose balance is not the real one: D-028)
        if (account.visibility or "full") != "partial":
            balance = self._projected.get(account.id, float(account.current_balance or 0.0))
            if round(balance, 4) + 0.0001 < total:
                return [finding(LEVEL_ERROR, "insufficient_balance", f"Account '{account.account_name}' would hold {balance:,.2f} {account.currency} when this row is paid, below {total:,.2f}")]
            self._projected[account.id] = balance - total

        from finance.models import LedgerTransactionDB

        twin = (
            self.db.query(LedgerTransactionDB.id)
            .filter(LedgerTransactionDB.account_id == account.id, LedgerTransactionDB.date == pay["date"],
                    LedgerTransactionDB.direction == "out", LedgerTransactionDB.amount == total)
            .first()
        )
        if twin:
            out.append(finding(LEVEL_WARNING, "possible_existing_ledger_row",
                               f"Account '{account.account_name}' already has an outflow of {total:,.2f} on {pay['date']} (ledger #{twin[0]}). If it is this payment, leave the row out or it is counted twice"))
        out.append(finding(LEVEL_WARNING, cfg.POSTING_CODE,
                           f"Will pay {total:,.2f} {account.currency} from '{account.account_name}' on {pay['date']}: posts one outflow to the ledger"))
        return out

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
        pay, subscription = data.pop("_pay"), data.pop("_subscription")
        vendor_bill_number, total = data.pop("_vendor_bill_number"), data.pop("_total")
        if pay is not None:
            return self._create_paid(ctx, data, pay, subscription, vendor_bill_number, total)

        if ctx.entry is not None:
            import hashlib

            content = ctx.entry.data
            ext = os.path.splitext(ctx.entry.base_name)[1].lower()
            data["file_fingerprint"] = hashlib.sha256(content).hexdigest()
            data["attachment_name"] = _clean_display_name(ctx.entry.base_name)
            data["attachment_url"] = ""

        provenance = f"Imported (batch {ctx.batch_id}, row {ctx.row.get('row_ref')}"
        if ctx.row.get("source_file"):
            provenance += f", file {ctx.row.get('source_file')}"
        provenance += ")."
        if ctx.row.get("review_flags"):
            provenance += f" Review flags: {ctx.row.get('review_flags')}."
        data["notes"] = provenance + (f"\n{ctx.row.get('notes')}" if ctx.row.get("notes") else "")

        try:
            bill = self.service.repo.create(data, lines)
            if ctx.entry is not None:
                vendor_slug = (bill.vendor.name if bill.vendor else data.get("suggested_vendor_name")) or "vendor"
                clean_ext = ext.lstrip(".")
                ref = file_layout.build_ref(
                    "bill",
                    date=bill.issue_date or datetime.date.today(),
                    bill_id=bill.id,
                    vendor_slug=vendor_slug,
                    ext=clean_ext,
                )
                file_layout.save_file(content, ref)
                bill.attachment_url = ref
                self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        actor = BillActor(email=ctx.actor.email, is_super_admin=ctx.actor.is_super_admin, permissions=ctx.actor.permissions)
        self.service._audit(
            "created", bill.id, actor, None, bill.status, f"imported from batch {ctx.batch_id} row {ctx.row.get('row_ref')}"
        )
        return bill.id


    # ------------------------------------------------------------------
    # Commit: already-paid bills and subscription charges (D-052)
    # ------------------------------------------------------------------
    @staticmethod
    def _provenance(ctx: RowContext, extra: str = "") -> str:
        text = f"Imported (batch {ctx.batch_id}, row {ctx.row.get('row_ref')}"
        if ctx.row.get("source_file"):
            text += f", file {ctx.row.get('source_file')}"
        text += ")."
        if ctx.row.get("review_flags"):
            text += f" Review flags: {ctx.row.get('review_flags')}."
        if extra:
            text += f" {extra}"
        if ctx.row.get("notes"):
            text += f"\n{ctx.row.get('notes')}"
        return text

    def _create_paid(self, ctx: RowContext, data: dict, pay: dict, subscription, vendor_bill_number, total) -> int:
        """Create the bill already paid through the bills service (or the subscription settlement), so the payment
        type, currency, balance and duplicate rules apply exactly as for a bill entered by hand."""
        import hashlib

        actor = BillActor(email=ctx.actor.email, is_super_admin=ctx.actor.is_super_admin, permissions=ctx.actor.permissions)
        account, pt = pay["account"], pay["payment_type"]
        extra = f"Vendor invoice no. {vendor_bill_number}." if vendor_bill_number else ""
        notes = self._provenance(ctx, extra)
        fingerprint = hashlib.sha256(ctx.entry.data).hexdigest() if ctx.entry is not None else None

        charge_id, created_charge_here = None, False
        try:
            if subscription is not None:
                bill_id, charge_id, created_charge_here = self._settle_subscription_charge(ctx, subscription, data, pay, total, actor)
            else:
                payload = BillCreate(
                    vendor_id=data["vendor_id"],
                    bill_number=data["bill_number"],
                    category_id=data["category_id"],
                    category=data["category"],
                    issue_date=data["issue_date"],
                    due_date=data["due_date"],
                    currency=data["currency"],
                    notes=notes,
                    capture_source=CAPTURE_SOURCE,
                    extraction_confidence=data["extraction_confidence"],
                    file_fingerprint=fingerprint,
                    attachment_name=_clean_display_name(ctx.entry.base_name) if ctx.entry is not None else None,
                    lines=[BillLineCreate(description=(ctx.row.get("description") or "Invoice total")[:255], quantity=1.0, unit_price=total, line_total=total)],
                    is_paid_now=True,
                    payment=BillPaymentInline(
                        bank_account_id=account.id, payment_type_id=pt.id, amount=total,
                        payment_date=pay["date"], reference=pay["reference"],
                    ),
                )
                bill_id = self.service.create_bill(payload, actor).id
        except HTTPException:
            self.db.rollback()
            self._drop_empty_charge(charge_id, created_charge_here)
            raise
        except Exception:
            self.db.rollback()
            self._drop_empty_charge(charge_id, created_charge_here)
            raise

        # The bill is created and paid. Everything below is bookkeeping around it; a failure must not report the row
        # as failed (it would then be tried again and found as a duplicate).
        try:
            bill = self.db.query(BillDB).filter(BillDB.id == bill_id).first()
            bill.import_batch_id = ctx.batch_id
            bill.capture_source = CAPTURE_SOURCE
            bill.is_reviewed = False
            bill.extraction_confidence = data["extraction_confidence"]
            bill.notes = notes
            if ctx.entry is not None:
                content = ctx.entry.data
                ext = os.path.splitext(ctx.entry.base_name)[1].lower().lstrip(".")
                bill.file_fingerprint = fingerprint
                bill.attachment_name = _clean_display_name(ctx.entry.base_name)
                ref = file_layout.build_ref(
                    "bill", date=bill.issue_date or datetime.date.today(), bill_id=bill.id,
                    vendor_slug=(bill.vendor.name if bill.vendor else "vendor"), ext=ext,
                )
                file_layout.save_file(content, ref)
                bill.attachment_url = ref
                if charge_id is not None:
                    self._attach_charge_proof(ctx, charge_id, subscription, data["issue_date"], ext)
            self.db.commit()
        except Exception:
            self.db.rollback()
            logger.exception("Import row %s: bill %s was created and paid but its provenance or file could not be saved", ctx.row.get("row_ref"), bill_id)
        try:
            self.service._audit("created", bill_id, actor, None, bs.PAID, f"imported from batch {ctx.batch_id} row {ctx.row.get('row_ref')}")
        except Exception:
            pass
        return bill_id

    def _settle_subscription_charge(self, ctx, subscription, data, pay, total, actor):
        """Settle the charge for the billing date (creating it when none exists) with an Already paid bill."""
        from finance.services.subscriptions_service import SubscriptionsService

        srepo = SubscriptionsRepository(self.db)
        charge = (
            self.db.query(SubscriptionChargeDB)
            .filter(SubscriptionChargeDB.subscription_id == subscription.id, SubscriptionChargeDB.billing_date == data["issue_date"])
            .first()
        )
        created_here = False
        if charge is None:
            if not srepo.add_expected_charge(subscription, data["issue_date"]):
                raise ValueError("The subscription charge was created by another request; run the import again")
            charge = (
                self.db.query(SubscriptionChargeDB)
                .filter(SubscriptionChargeDB.subscription_id == subscription.id, SubscriptionChargeDB.billing_date == data["issue_date"])
                .first()
            )
            created_here = True
        elif charge.status != "expected":
            raise ValueError(f"The subscription already has a {charge.status} charge for {data['issue_date']}")
        charge_id = charge.id
        try:
            SubscriptionsService(srepo).settle_charge(
                charge_id,
                SubscriptionChargeSettle(
                    mode="already_paid_bill", bank_account_id=pay["account"].id, payment_type_id=pay["payment_type"].id,
                    payment_date=pay["date"], amount=total, variance_reason="Historical import",
                ),
                actor=actor,
            )
        except Exception:
            self._drop_empty_charge(charge_id, created_here)
            raise
        settled = self.db.query(SubscriptionChargeDB).filter(SubscriptionChargeDB.id == charge_id).first()
        settled.note = self._provenance(ctx)
        self.db.commit()
        return settled.linked_bill_id, charge_id, created_here

    def _drop_empty_charge(self, charge_id, created_here) -> None:
        """A charge this row created and could not settle is removed, so a failed row leaves nothing behind."""
        if not charge_id or not created_here:
            return
        try:
            self.db.rollback()
            charge = self.db.query(SubscriptionChargeDB).filter(SubscriptionChargeDB.id == charge_id).first()
            if charge is not None and charge.status == "expected" and charge.linked_bill_id is None:
                self.db.delete(charge)
                self.db.commit()
        except Exception:
            self.db.rollback()

    def _attach_charge_proof(self, ctx: RowContext, charge_id: int, subscription, billing_date: str, ext: str) -> None:
        """The document is also the charge's proof, so the Subscriptions page shows it as attached."""
        att = FinanceAttachmentDB(
            subscription_charge_id=charge_id,
            file_name=_clean_display_name(ctx.entry.base_name),
            file_size=len(ctx.entry.data),
            mime_type="application/pdf" if ext == "pdf" else "application/octet-stream",
            storage_ref="pending",
            uploaded_by=ctx.actor.email,
        )
        self.db.add(att)
        self.db.flush()
        ref = file_layout.build_ref(
            "subscription_proof", subscription_id=subscription.id, name=subscription.name,
            charge_date=billing_date, att_id=att.id, ext=ext, date=billing_date,
        )
        file_layout.save_file(ctx.entry.data, ref)
        att.storage_ref = ref
        charge = self.db.query(SubscriptionChargeDB).filter(SubscriptionChargeDB.id == charge_id).first()
        charge.proof_status = "attached"
        charge.proof_note = None


register_importer("bills", lambda db, actor: BillsImporter(db, actor))
