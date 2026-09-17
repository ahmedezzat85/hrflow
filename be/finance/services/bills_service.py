"""
be/finance/services/bills_service.py
Business logic and validation for Vendor Bills and outgoing Payments.
"""
import os
import uuid
import hashlib
import mimetypes
from datetime import datetime
from typing import List, Optional, Tuple
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
    PaymentCreate,
    PaymentResponse,
    PaymentReversalRequest,
)
from finance.models import BillDB, PaymentDB, VendorDB


VALID_BILL_STATUSES = {
    "inbox",
    "needs_coding",
    "needs_approval",
    "ready_to_pay",
    "scheduled",
    "paid",
    "partially_paid",
    "exceptions",
    "void",
    "unpaid",
    "overdue",
}
VALID_PAYMENT_METHODS = {"bank_transfer", "cash", "card", "other"}
VALID_DIRECTIONS = {"incoming", "outgoing"}


BILL_UPLOADS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads", "finance_bills"
)


class BillsService:
    def __init__(self, repo: BillsRepository):
        self.repo = repo
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
    ) -> List[BillResponse]:
        if status and status not in VALID_BILL_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{status}'. Must be one of: {', '.join(VALID_BILL_STATUSES)}",
            )
        bills = self.repo.list_all(
            status=status,
            queue=queue,
            vendor_id=vendor_id,
            search=search,
            has_attachment=has_attachment,
            limit=limit,
            offset=offset,
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

    def create_bill(
        self, payload: BillCreate, current_user: Optional[dict] = None
    ) -> BillResponse:
        if payload.status not in VALID_BILL_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")

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

        # FUX-408: Integrity Guard - Paid status cannot be set directly without settlement
        if payload.status in ("paid", "partially_paid") and not payload.is_paid_now:
            raise HTTPException(
                status_code=400,
                detail="Paid or partially paid status cannot be set directly. It is derived from recorded settlements.",
            )

        # FUX-408: Combined create-and-pay validation
        if payload.is_paid_now:
            if not payload.payment:
                raise HTTPException(
                    status_code=400,
                    detail="Payment details (bank account, payment date) are required when 'is_paid_now' is True.",
                )
            if payload.requires_approval and payload.approval_status != "approved":
                raise HTTPException(
                    status_code=400,
                    detail="Bill requires approval before payment can be recorded.",
                )

        # AC 1: Uploaded bills do not become payable until required fields are reviewed
        initial_status = payload.status
        is_rev = payload.is_reviewed if payload.is_reviewed is not None else True
        if payload.capture_source in ("upload", "ocr"):
            is_rev = False
            if initial_status in ("ready_to_pay", "paid"):
                initial_status = "inbox"
        elif payload.is_paid_now:
            # When creating and paying simultaneously, set initial working status to ready_to_pay
            initial_status = "ready_to_pay"

        data = payload.model_dump(exclude={"lines", "is_paid_now", "payment"}) if hasattr(payload, "model_dump") else payload.dict(exclude={"lines", "is_paid_now", "payment"})
        data["status"] = initial_status
        data["is_reviewed"] = is_rev

        user_email = (current_user.get("email") or current_user.get("sub")) if current_user else None
        if user_email and not data.get("created_by"):
            data["created_by"] = user_email

        lines_data = [
            (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
            for ln in payload.lines
        ]
        bill = self.repo.create(data, lines_data)

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
        self, bill_id: int, req: BillApprovalRequest, current_user: dict
    ) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if bill.status in ("void", "paid"):
            raise HTTPException(status_code=400, detail=f"Cannot approve bill in '{bill.status}' status")

        user_email = (current_user.get("email") or current_user.get("sub") or "admin").strip()

        # AC 2: Segregation of duties - prevent self-approval
        if bill.created_by and bill.created_by.strip().lower() == user_email.lower():
            raise HTTPException(
                status_code=400,
                detail="Self-approval is prohibited by segregation of duties policy.",
            )

        # AC 2: Approver authorization limit check
        if req.approver_limit is not None and bill.total > req.approver_limit:
            raise HTTPException(
                status_code=400,
                detail=f"Bill total (${bill.total:,.2f}) exceeds approver authorization limit (${req.approver_limit:,.2f}).",
            )

        decision = req.decision.strip().lower()
        if decision == "approve":
            updates = {
                "approval_status": "approved",
                "approved_by": user_email,
                "approved_at": datetime.utcnow(),
                "approval_comment": req.comment,
                "status": "ready_to_pay",
            }
        elif decision == "reject":
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
                "status": "exceptions",
            }
        else:
            raise HTTPException(
                status_code=400, detail=f"Invalid decision '{req.decision}'. Must be 'approve' or 'reject'."
            )

        updated = self.repo.update(bill_id, updates)
        return self._bill_to_response(updated)

    def schedule_bill(self, bill_id: int, req: BillScheduleRequest) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if bill.status in ("void", "paid"):
            raise HTTPException(status_code=400, detail=f"Cannot schedule bill in '{bill.status}' status")

        # AC 1: Cannot move to scheduled before required approvals complete
        if bill.requires_approval and bill.approval_status != "approved":
            raise HTTPException(
                status_code=400,
                detail="Bill requires approval before it can be scheduled for payment.",
            )

        updates = {
            "scheduled_payment_date": req.scheduled_payment_date,
            "status": "scheduled",
        }
        if req.notes:
            existing = bill.notes or ""
            updates["notes"] = f"{existing}\n[Scheduled: {req.scheduled_payment_date} - {req.notes}]".strip()

        updated = self.repo.update(bill_id, updates)
        return self._bill_to_response(updated)

    def update_bill(self, bill_id: int, payload: BillUpdate) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if bill.status == "void":
            raise HTTPException(status_code=400, detail="Cannot update a voided bill")

        if payload.status and payload.status not in VALID_BILL_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")

        # FUX-408: Integrity Guard - Paid status cannot be directly set via bill update
        if payload.status in ("paid", "partially_paid"):
            raise HTTPException(
                status_code=400,
                detail="Bill status cannot be directly updated to paid or partially paid. Record a payment via settlement instead.",
            )

        # AC 1: Uploaded/unreviewed bills cannot move directly to ready_to_pay or paid without being reviewed
        target_status = payload.status or bill.status
        is_rev = payload.is_reviewed if payload.is_reviewed is not None else bill.is_reviewed
        if target_status in ("ready_to_pay", "paid") and not is_rev:
            raise HTTPException(
                status_code=400,
                detail="Uploaded bills must be reviewed and coded before moving to ready_to_pay or paid status.",
            )

        # AC 1: A bill cannot move to Ready to Pay before required approvals complete
        if (
            target_status in ("ready_to_pay", "paid")
            and bill.requires_approval
            and bill.approval_status != "approved"
        ):
            raise HTTPException(
                status_code=400,
                detail="Bill requires approval before moving to ready_to_pay or paid status.",
            )

        data = payload.model_dump(exclude_unset=True, exclude={"lines"}) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True, exclude={"lines"})
        lines_data = None
        if payload.lines is not None:
            lines_data = [
                (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
                for ln in payload.lines
            ]

        updated = self.repo.update(bill_id, data, lines_data)
        return self._bill_to_response(updated)

    def void_bill(self, bill_id: int, reason: Optional[str] = None) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")
        if bill.status == "void":
            raise HTTPException(status_code=400, detail="Bill is already voided")
        if bill.status == "paid":
            raise HTTPException(status_code=400, detail="Cannot void a paid bill. Record a vendor credit instead.")

        if reason and reason.strip():
            existing_notes = bill.notes or ""
            updated_notes = f"{existing_notes}\n[Void reason: {reason.strip()}]".strip()
            self.repo.update(bill_id, {"notes": updated_notes})

        voided = self.repo.void_bill(bill_id)
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

    def record_payment(self, bill_id: int, payload: PaymentCreate) -> PaymentResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if bill.status in ("void",):
            raise HTTPException(status_code=400, detail="Cannot record payment against a voided bill")

        # AC 1: Cannot pay unapproved bill that requires approval
        if (
            bill.requires_approval
            and bill.approval_status != "approved"
            and bill.status not in ("ready_to_pay", "scheduled", "paid")
        ):
            raise HTTPException(
                status_code=400,
                detail="Bill requires approval before payment can be recorded.",
            )

        if payload.direction != "outgoing":
            raise HTTPException(status_code=400, detail="Bill payments must be direction=outgoing")

        if payload.method not in VALID_PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail=f"Invalid payment method '{payload.method}'")

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        data["related_bill_id"] = bill_id  # always tie to this bill

        try:
            payment = self.repo.record_payment(data)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return self._payment_to_response(payment)

    def reverse_payment(
        self, bill_id: int, payment_id: int, req: PaymentReversalRequest, current_user: dict
    ) -> PaymentResponse:
        user_email = (current_user.get("email") or current_user.get("sub") or "admin").strip()
        try:
            payment = self.repo.reverse_payment(
                bill_id=bill_id,
                payment_id=payment_id,
                reason=req.reason,
                reversed_by=user_email,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

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


