"""
be/finance/services/bills_service.py
Business logic and validation for Vendor Bills and outgoing Payments.
"""
from typing import List, Optional
from fastapi import HTTPException, status

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
    PaymentCreate,
    PaymentResponse,
)
from finance.models import BillDB, PaymentDB


VALID_BILL_STATUSES = {
    "inbox",
    "needs_coding",
    "needs_approval",
    "ready_to_pay",
    "scheduled",
    "paid",
    "exceptions",
    "void",
    "unpaid",
    "overdue",
}
VALID_PAYMENT_METHODS = {"bank_transfer", "cash", "card", "other"}
VALID_DIRECTIONS = {"incoming", "outgoing"}


class BillsService:
    def __init__(self, repo: BillsRepository):
        self.repo = repo

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
        return BillResponse(
            id=bill.id,
            vendor_id=bill.vendor_id,
            vendor_name=vendor_name,
            bill_number=bill.bill_number,
            category=bill.category,
            issue_date=bill.issue_date,
            due_date=bill.due_date,
            status=bill.status,
            currency=bill.currency,
            subtotal=bill.subtotal,
            tax_amount=bill.tax_amount,
            total=bill.total,
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
        limit: int = 50,
        offset: int = 0,
    ) -> List[BillResponse]:
        if status and status not in VALID_BILL_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{status}'. Must be one of: {', '.join(VALID_BILL_STATUSES)}",
            )
        bills = self.repo.list_all(
            status=status, queue=queue, vendor_id=vendor_id, search=search, limit=limit, offset=offset
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

    def create_bill(self, payload: BillCreate) -> BillResponse:
        if payload.status not in VALID_BILL_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")

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

        # AC 1: Uploaded bills do not become payable until required fields are reviewed
        initial_status = payload.status
        is_rev = payload.is_reviewed if payload.is_reviewed is not None else True
        if payload.capture_source in ("upload", "ocr"):
            is_rev = False
            if initial_status in ("ready_to_pay", "paid"):
                initial_status = "inbox"

        data = payload.model_dump(exclude={"lines"}) if hasattr(payload, "model_dump") else payload.dict(exclude={"lines"})
        data["status"] = initial_status
        data["is_reviewed"] = is_rev

        lines_data = [
            (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
            for ln in payload.lines
        ]
        bill = self.repo.create(data, lines_data)
        return self._bill_to_response(bill)

    def update_bill(self, bill_id: int, payload: BillUpdate) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if bill.status == "void":
            raise HTTPException(status_code=400, detail="Cannot update a voided bill")

        if payload.status and payload.status not in VALID_BILL_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")

        # AC 1: Uploaded/unreviewed bills cannot move directly to ready_to_pay or paid without being reviewed
        target_status = payload.status or bill.status
        is_rev = payload.is_reviewed if payload.is_reviewed is not None else bill.is_reviewed
        if target_status in ("ready_to_pay", "paid") and not is_rev:
            raise HTTPException(
                status_code=400,
                detail="Uploaded bills must be reviewed and coded before moving to ready_to_pay or paid status.",
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

        if payload.direction != "outgoing":
            raise HTTPException(status_code=400, detail="Bill payments must be direction=outgoing")

        if payload.method not in VALID_PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail=f"Invalid payment method '{payload.method}'")

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        data["related_bill_id"] = bill_id  # always tie to this bill

        try:
            payment = self.repo.record_payment(data)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

        return self._payment_to_response(payment)
