"""
be/finance/services/bills_service.py
Business logic and validation for Vendor Bills and outgoing Payments.
"""
import os
import uuid
import hashlib
import mimetypes
from datetime import datetime
from dataclasses import dataclass, field
from typing import FrozenSet, List, Optional, Tuple
from fastapi import HTTPException, status, UploadFile

from finance.repositories.bills_repository import BillsRepository
from finance.schemas import (
    BillCreate,
    BillUpdate,
    BillResponse,
    BillLineResponse,
    BillDuplicateCheckRequest,
    BillDuplicateCheckResponse,
    BillDuplicateCandidate,
    BillQueueCountsResponse,
    BillApprovalRequest,
    BillScheduleRequest,
    BillCategoryQualityReportItem,
    BillCategoryQualityReportResponse,
    BillDocumentExtractionResponse,
    PaymentCreate,
    PaymentResponse,
    PaymentReversalRequest,
)
from finance.models import BillDB, PaymentDB, VendorDB
from finance.services.bill_extractor import BillPdfExtractor
from finance import bill_status as bs
from finance.bill_status import VALID_BILL_STATUSES, InvalidBillTransition

VALID_PAYMENT_METHODS = {"bank_transfer", "cash", "card", "other"}
VALID_DIRECTIONS = {"incoming", "outgoing"}


@dataclass(frozen=True)
class BillActor:
    """Who is acting on a bill: identity plus the permissions that decide approval and payment rules."""

    email: str
    is_super_admin: bool = False
    permissions: FrozenSet[str] = field(default_factory=frozenset)

    def can(self, key: str) -> bool:
        return self.is_super_admin or key in self.permissions


SYSTEM_ACTOR = BillActor(email="system", is_super_admin=True)

BILL_UPLOADS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads", "finance_bills"
)


class BillsService:
    def __init__(self, repo: BillsRepository, audit=None):
        self.repo = repo
        self.audit = audit
        os.makedirs(BILL_UPLOADS_DIR, exist_ok=True)

    # ------------------------------------------------------------------
    # Serialization helpers
    # ------------------------------------------------------------------
    def _bill_to_response(self, bill: BillDB) -> BillResponse:
        lines = [
            BillLineResponse(
                id=ln.id,
                bill_id=ln.bill_id,
                description=ln.description,
                quantity=ln.quantity,
                unit_price=ln.unit_price,
                line_total=ln.line_total,
            )
            for ln in (bill.lines or [])
        ]
        vendor_name = bill.vendor.name if bill.vendor else None
        cat_name = bill.transaction_category.name if getattr(bill, "transaction_category", None) else bill.category
        paid = bill.amount_paid or 0.0
        remaining = max(0.0, round((bill.total or 0.0) - paid, 2))
        return BillResponse(
            id=bill.id,
            vendor_id=bill.vendor_id,
            vendor_name=vendor_name,
            bill_number=bill.bill_number,
            category_id=bill.category_id,
            category=cat_name,
            category_name=cat_name,
            issue_date=bill.issue_date,
            due_date=bill.due_date,
            status=bill.status,
            is_overdue=bs.is_overdue(bill.status, bill.due_date),
            allowed_actions=bs.allowed_actions(bill.status),
            void_reason=bill.void_reason,
            voided_by=bill.voided_by,
            voided_at=bill.voided_at,
            currency=bill.currency,
            subtotal=bill.subtotal,
            tax_amount=bill.tax_amount,
            total=bill.total,
            remaining_balance=remaining,
            notes=bill.notes,
            capture_source=bill.capture_source or "manual",
            extraction_confidence=bill.extraction_confidence,
            missing_fields=bill.missing_fields,
            department=bill.department,
            legal_entity=bill.legal_entity or "Voyance Health Inc",
            attachment_url=bill.attachment_url,
            attachment_name=bill.attachment_name,
            file_fingerprint=bill.file_fingerprint,
            is_reviewed=bill.is_reviewed,
            is_duplicate_override=bill.is_duplicate_override,
            duplicate_override_reason=bill.duplicate_override_reason,
            created_by=bill.created_by,
            requires_approval=bill.requires_approval or False,
            approval_status=bill.approval_status,
            approved_by=bill.approved_by,
            approved_at=bill.approved_at,
            approval_comment=bill.approval_comment,
            scheduled_payment_date=bill.scheduled_payment_date,
            amount_paid=paid,
            created_at=bill.created_at,
            lines=lines,
        )

    def _payment_to_response(self, payment: PaymentDB) -> PaymentResponse:
        bank_name = (
            payment.bank_account.account_name
            if payment.bank_account
            else None
        )
        return PaymentResponse(
            id=payment.id,
            direction=payment.direction,
            related_invoice_id=payment.related_invoice_id,
            related_bill_id=payment.related_bill_id,
            amount=payment.amount,
            currency=payment.currency,
            payment_date=payment.payment_date,
            bank_account_id=payment.bank_account_id,
            bank_account_name=bank_name,
            method=payment.method,
            reference=payment.reference or "",
            is_reversed=payment.is_reversed,
            reversed_at=payment.reversed_at,
            reversed_by=payment.reversed_by,
            reversal_reason=payment.reversal_reason,
            created_at=payment.created_at,
        )

    # ------------------------------------------------------------------
    # Bill CRUD & AP Inbox
    # ------------------------------------------------------------------
    def list_bills(
        self,
        status: Optional[str] = None,
        queue: Optional[str] = None,
        vendor_id: Optional[int] = None,
        search: Optional[str] = None,
        has_attachment: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
        overdue: Optional[bool] = None,
    ) -> List[BillResponse]:
        if status and status not in VALID_BILL_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{status}'. Must be one of: {', '.join(bs.BILL_STATUSES)}",
            )
        bills = self.repo.list_all(
            status=status,
            queue=queue,
            vendor_id=vendor_id,
            search=search,
            has_attachment=has_attachment,
            limit=limit,
            offset=offset,
            overdue=overdue,
        )
        return [self._bill_to_response(b) for b in bills]

    def get_queue_counts(self, vendor_id: Optional[int] = None) -> BillQueueCountsResponse:
        counts = self.repo.get_queue_counts(vendor_id=vendor_id)
        return BillQueueCountsResponse(**counts)

    def check_duplicates(self, req: BillDuplicateCheckRequest) -> BillDuplicateCheckResponse:
        raw_candidates = self.repo.find_duplicate_candidates(
            vendor_id=req.vendor_id,
            bill_number=req.bill_number,
            issue_date=req.issue_date,
            total=req.total,
            file_fingerprint=req.file_fingerprint,
            exclude_id=req.exclude_id,
        )
        candidates = [BillDuplicateCandidate(**c) for c in raw_candidates]
        return BillDuplicateCheckResponse(candidates=candidates)

    def get_bill(self, bill_id: int) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")
        return self._bill_to_response(bill)

    def _audit(self, action: str, bill_id: int, actor: BillActor, from_status: Optional[str], to_status: Optional[str], reason: Optional[str] = None) -> None:
        """One activity entry per bill action: who, when (timestamp), from/to status, reason."""
        if not self.audit:
            return
        details = f"{from_status or '-'} -> {to_status or '-'}"
        if reason and reason.strip():
            details += f"; reason: {reason.strip()}"
        try:
            self.audit.log(f"bill.{action}", actor.email, "bill", bill_id, details)
        except Exception:
            pass

    def _transition(
        self,
        bill: BillDB,
        action: str,
        extra: Optional[dict] = None,
        actor: Optional[BillActor] = None,
        reason: Optional[str] = None,
    ) -> BillDB:
        """Apply a status action through BILL_TRANSITIONS. Unsupported actions return 409."""
        try:
            target = bs.next_status(action, bill.status)
        except InvalidBillTransition as e:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.detail())
        previous = bill.status
        updated = self.repo.set_status(bill.id, target, extra)
        self._audit(action, bill.id, actor or SYSTEM_ACTOR, previous, target, reason)
        return updated

    def create_bill(self, payload: BillCreate, actor: BillActor) -> BillResponse:
        # Inactive vendor validation: Inactive vendors remain on history but are excluded from new bills
        vendor = self.repo.db.query(VendorDB).filter(VendorDB.id == payload.vendor_id).first()
        if not vendor:
            raise HTTPException(status_code=400, detail=f"Vendor with ID {payload.vendor_id} not found")
        if not vendor.is_active:
            raise HTTPException(status_code=400, detail=f"Vendor '{vendor.name}' is inactive and cannot be assigned to new bills")

        existing = self.repo.get_by_number(payload.bill_number)
        if existing and not payload.is_duplicate_override:
            raise HTTPException(
                status_code=400,
                detail=f"Bill number '{payload.bill_number}' is already in use",
            )

        # Duplicate detection check
        calc_total = sum(
            ln.line_total if ln.line_total else (ln.quantity * ln.unit_price)
            for ln in payload.lines
        )
        duplicates = self.repo.find_duplicate_candidates(
            vendor_id=payload.vendor_id,
            bill_number=payload.bill_number,
            issue_date=payload.issue_date,
            total=calc_total,
            file_fingerprint=payload.file_fingerprint,
        )
        if duplicates and not payload.is_duplicate_override:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Potential duplicate bill detected ({duplicates[0]['matched_field']}: {duplicates[0]['matching_value']}). Authorized override required.",
            )

        if payload.is_duplicate_override and not (payload.duplicate_override_reason and payload.duplicate_override_reason.strip()):
            raise HTTPException(
                status_code=400,
                detail="A valid reason is required when overriding a duplicate bill detection.",
            )

        # FUX-408: Combined create-and-pay validation
        if payload.is_paid_now:
            if not payload.payment:
                raise HTTPException(
                    status_code=400,
                    detail="Payment details (bank account, payment date) are required when 'is_paid_now' is True.",
                )
            if not actor.can("finance.bill.pay"):
                raise HTTPException(status_code=403, detail="Permission denied: 'finance.bill.pay' required to record an already-paid bill")
            if not actor.can("finance.bill.approve"):
                raise HTTPException(status_code=403, detail="Permission denied: 'finance.bill.approve' required to record an already-paid bill")

        # An approver's (or super admin's) bill is Approved on save and marked auto-approved;
        # everyone else's starts as Draft and goes through submit -> approve.
        auto_approved = actor.can("finance.bill.approve")
        initial_status = bs.APPROVED if auto_approved else bs.DRAFT
        is_rev = payload.capture_source not in ("upload", "ocr")

        data = payload.model_dump(exclude={"lines", "is_paid_now", "payment"}) if hasattr(payload, "model_dump") else payload.dict(exclude={"lines", "is_paid_now", "payment"})
        data["status"] = initial_status
        data["is_reviewed"] = is_rev
        data["created_by"] = actor.email
        if auto_approved:
            data["approval_status"] = "auto"
            data["approved_by"] = actor.email
            data["approved_at"] = datetime.utcnow()

        lines_data = [
            (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
            for ln in payload.lines
        ]
        bill = self.repo.create(data, lines_data)
        self._audit("created", bill.id, actor, None, bill.status)

        # FUX-408: Execute settlement atomically if is_paid_now is True
        if payload.is_paid_now and payload.payment:
            pay_amt = payload.payment.amount if payload.payment.amount is not None else bill.total
            payment_dict = {
                "bank_account_id": payload.payment.bank_account_id,
                "amount": pay_amt,
                "payment_date": payload.payment.payment_date,
                "method": payload.payment.method or "bank_transfer",
                "reference": payload.payment.reference or bill.bill_number,
                "related_bill_id": bill.id,
                "currency": bill.currency or "USD",
                "direction": "outgoing",
            }
            try:
                self.repo.record_payment(payment_dict)
            except Exception as e:
                # If payment fails, repo already raises or fails. Re-raise as HTTPException for clean client error
                if isinstance(e, HTTPException):
                    raise e
                raise HTTPException(status_code=400, detail=f"Failed to record settlement: {str(e)}")

            # Reload bill with updated amount_paid and status
            bill = self.repo.get_by_id(bill.id)

        return self._bill_to_response(bill)

    def approve_bill(
        self, bill_id: int, req: BillApprovalRequest, actor: BillActor
    ) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        user_email = actor.email
        decision = (req.decision or "").strip().lower()
        if decision not in ("approve", "reject"):
            raise HTTPException(
                status_code=400, detail=f"Invalid decision '{req.decision}'. Must be 'approve' or 'reject'."
            )
        try:
            bs.next_status(decision, bill.status)
        except InvalidBillTransition as e:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.detail())

        # Segregation of duties: a creator may not approve their own bill unless super admin
        if (
            bill.created_by
            and bill.created_by.strip().lower() == user_email.lower()
            and not actor.is_super_admin
        ):
            raise HTTPException(
                status_code=400,
                detail="Self-approval is prohibited by segregation of duties policy.",
            )

        # Approver authorization limit check
        if req.approver_limit is not None and bill.total > req.approver_limit:
            raise HTTPException(
                status_code=400,
                detail=f"Bill total (${bill.total:,.2f}) exceeds approver authorization limit (${req.approver_limit:,.2f}).",
            )

        if decision == "approve":
            updates = {
                "approval_status": "approved",
                "approved_by": user_email,
                "approved_at": datetime.utcnow(),
                "approval_comment": req.comment,
            }
        else:
            if not req.comment or not req.comment.strip():
                raise HTTPException(
                    status_code=400,
                    detail="A comment or reason is required when rejecting a bill.",
                )
            updates = {
                "approval_status": "rejected",
                "approved_by": user_email,
                "approved_at": datetime.utcnow(),
                "approval_comment": req.comment.strip(),
            }

        updated = self._transition(bill, decision, updates, actor=actor, reason=req.comment)
        return self._bill_to_response(updated)

    def submit_bill(self, bill_id: int, actor: BillActor) -> BillResponse:
        """Draft or Rejected -> Pending approval. Clears the previous decision."""
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")
        updated = self._transition(
            bill,
            "submit",
            {"approval_status": "pending", "approved_by": None, "approved_at": None, "approval_comment": None},
            actor=actor,
        )
        return self._bill_to_response(updated)

    def withdraw_bill(self, bill_id: int, actor: BillActor) -> BillResponse:
        """Pending approval -> Draft, by the submitter (or a super admin)."""
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")
        if bill.status == bs.PENDING_APPROVAL and not actor.is_super_admin and (
            (bill.created_by or "").strip().lower() != actor.email.strip().lower()
        ):
            raise HTTPException(status_code=403, detail="Only the submitter can withdraw this bill")
        updated = self._transition(bill, "withdraw", {"approval_status": None}, actor=actor)
        return self._bill_to_response(updated)

    def schedule_bill(self, bill_id: int, req: BillScheduleRequest, actor: BillActor) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        updates = {"scheduled_payment_date": req.scheduled_payment_date}
        if req.notes:
            existing = bill.notes or ""
            updates["notes"] = f"{existing}\n[Scheduled: {req.scheduled_payment_date} - {req.notes}]".strip()

        updated = self._transition(bill, "schedule", updates, actor=actor, reason=req.scheduled_payment_date)
        return self._bill_to_response(updated)

    def update_bill(self, bill_id: int, payload: BillUpdate, actor: BillActor) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if bill.status == "void":
            raise HTTPException(status_code=400, detail="Cannot update a voided bill")

        data = payload.model_dump(exclude_unset=True, exclude={"lines"}) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True, exclude={"lines"})
        lines_data = None
        if payload.lines is not None:
            lines_data = [
                (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
                for ln in payload.lines
            ]

        # A material change (vendor, currency or lines/amount) to an Approved or Scheduled bill by a user
        # who cannot approve sends it back to Pending approval and clears the schedule.
        material = False
        if data.get("vendor_id") is not None and data["vendor_id"] != bill.vendor_id:
            material = True
        if data.get("currency") is not None and data["currency"] != bill.currency:
            material = True
        if lines_data is not None:
            old_lines = sorted((ln.description.strip(), round(ln.quantity, 4), round(ln.unit_price, 4)) for ln in (bill.lines or []))
            new_lines = sorted(
                (ln["description"].strip(), round(ln.get("quantity", 1.0), 4), round(ln.get("unit_price", 0.0), 4))
                for ln in lines_data
            )
            if old_lines != new_lines:
                material = True
        send_back = material and bill.status in (bs.APPROVED, bs.SCHEDULED) and not actor.can("finance.bill.approve")

        previous = bill.status
        updated = self.repo.update(bill_id, data, lines_data)
        if send_back:
            updated = self._transition(
                updated,
                "send_back",
                {
                    "scheduled_payment_date": None,
                    "approval_status": "pending",
                    "approved_by": None,
                    "approved_at": None,
                    "approval_comment": None,
                },
                actor=actor,
                reason="Material edit by a user without approval rights",
            )
        else:
            self._audit("updated", bill_id, actor, previous, updated.status)
        return self._bill_to_response(updated)

    def void_bill(
        self, bill_id: int, reason: Optional[str] = None, actor: BillActor = SYSTEM_ACTOR
    ) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")
        try:
            bs.next_status("void", bill.status)
        except InvalidBillTransition as e:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.detail())
        if self.repo.count_unreversed_payments(bill_id) > 0 or (bill.amount_paid or 0.0) > 0.001:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "has_unreversed_payments",
                    "message": "Cannot void a bill that has unreversed payments. Reverse the payments first.",
                    "current_status": bill.status,
                    "allowed_actions": bs.allowed_actions(bill.status),
                },
            )
        voided_by = actor.email
        voided = self._transition(
            bill,
            "void",
            {
                "void_reason": reason.strip() if reason and reason.strip() else None,
                "voided_by": voided_by,
                "voided_at": datetime.utcnow(),
            },
            actor=actor,
            reason=reason,
        )
        return self._bill_to_response(voided)

    # ------------------------------------------------------------------
    # Payment (outgoing) on a bill
    # ------------------------------------------------------------------
    def list_payments(self, bill_id: int) -> List[PaymentResponse]:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")
        payments = self.repo.list_payments(bill_id)
        return [self._payment_to_response(p) for p in payments]

    def record_payment(self, bill_id: int, payload: PaymentCreate, actor: BillActor = SYSTEM_ACTOR) -> PaymentResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if payload.direction != "outgoing":
            raise HTTPException(status_code=400, detail="Bill payments must be direction=outgoing")

        if bill.status not in (bs.APPROVED, bs.SCHEDULED, bs.PARTIALLY_PAID):
            try:
                bs.next_status("pay", bill.status)
            except InvalidBillTransition as e:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.detail())

        if payload.method not in VALID_PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail=f"Invalid payment method '{payload.method}'")

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        data["related_bill_id"] = bill_id  # always tie to this bill

        try:
            payment = self.repo.record_payment(data)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        refreshed = self.repo.get_by_id(bill_id)
        self._audit("payment_recorded", bill_id, actor, bill.status, refreshed.status if refreshed else None, f"{payload.amount}")
        return self._payment_to_response(payment)

    def reverse_payment(
        self, bill_id: int, payment_id: int, req: PaymentReversalRequest, actor: BillActor
    ) -> PaymentResponse:
        user_email = actor.email
        try:
            payment = self.repo.reverse_payment(
                bill_id=bill_id,
                payment_id=payment_id,
                reason=req.reason,
                reversed_by=user_email,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        refreshed = self.repo.get_by_id(bill_id)
        self._audit("payment_reversed", bill_id, actor, None, refreshed.status if refreshed else None, req.reason)
        return self._payment_to_response(payment)

    # ------------------------------------------------------------------
    # Document Attachment Storage (FUX-407)
    # ------------------------------------------------------------------
    async def upload_attachment(self, bill_id: int, file: UploadFile) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="A valid file is required for attachment upload.")

        safe_filename = os.path.basename(file.filename)
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file cannot be empty.")

        fingerprint = hashlib.sha256(content).hexdigest()
        unique_name = f"{uuid.uuid4().hex}_{safe_filename}"
        file_path = os.path.join(BILL_UPLOADS_DIR, unique_name)

        with open(file_path, "wb") as f:
            f.write(content)

        # Store persistent local file path in attachment_url
        updated = self.repo.update_attachment(
            bill_id=bill_id,
            attachment_name=safe_filename,
            attachment_url=file_path,
            file_fingerprint=fingerprint,
        )
        return self._bill_to_response(updated)

    def get_attachment_file(self, bill_id: int) -> Tuple[str, str, str]:
        """Returns (file_path, filename, media_type) for streaming attachment."""
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if not bill.attachment_url:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} has no attachment")

        file_path = bill.attachment_url
        if not os.path.isabs(file_path):
            file_path = os.path.join(BILL_UPLOADS_DIR, file_path)

        if not os.path.isfile(file_path):
            raise HTTPException(status_code=404, detail="Attachment file not found on disk")

        filename = bill.attachment_name or os.path.basename(file_path)
        mime_type, _ = mimetypes.guess_type(filename)
        mime_type = mime_type or "application/octet-stream"

        return file_path, filename, mime_type

    def delete_attachment(self, bill_id: int) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if not bill.attachment_url and not bill.attachment_name:
            raise HTTPException(status_code=400, detail="Bill has no attachment to delete")

        # Optionally remove local file from disk if it exists
        if bill.attachment_url:
            file_path = bill.attachment_url
            if not os.path.isabs(file_path):
                file_path = os.path.join(BILL_UPLOADS_DIR, file_path)
            try:
                if os.path.isfile(file_path):
                    os.remove(file_path)
            except OSError:
                pass

        updated = self.repo.delete_attachment(bill_id)
        return self._bill_to_response(updated)

    def get_category_quality_report(self) -> BillCategoryQualityReportResponse:
        report_data = self.repo.get_category_quality_report()
        items = [
            BillCategoryQualityReportItem(**item)
            for item in report_data["unmatched_bills"]
        ]
        return BillCategoryQualityReportResponse(
            total_bills=report_data["total_bills"],
            matched_count=report_data["matched_count"],
            unmatched_count=report_data["unmatched_count"],
            unmatched_bills=items,
        )

    # ------------------------------------------------------------------
    # Document Text & Structured Field Extraction (FUX-413)
    # ------------------------------------------------------------------
    async def extract_document(self, file: UploadFile) -> BillDocumentExtractionResponse:
        """
        Extract text, dates, amounts, bill number, vendor, and line items from a PDF.
        Returns extraction confidence and missing fields. If document is unreadable (scanned),
        returns is_readable=False without fabricating mock values.
        """
        if not file or not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A valid document file is required for extraction.",
            )

        content = await file.read()
        if len(content) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty.",
            )

        known_vendors = []
        try:
            if hasattr(self.repo, "db") and self.repo.db:
                vendors = self.repo.db.query(VendorDB).all()
                known_vendors = [{"id": v.id, "name": v.name} for v in vendors if v.name]
        except Exception:
            pass

        try:
            return BillPdfExtractor.parse_document(
                content=content,
                filename=file.filename,
                known_vendors=known_vendors,
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )


