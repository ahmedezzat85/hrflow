"""
be/finance/routers/bills.py
Production router for Vendor Bills (Accounts Payable).
Full CRUD + payment recording, gated with RBAC permissions:
 - finance.bill.read  (list, get, list payments)
 - finance.bill.write (create, update, void, submit, withdraw, schedule)
 - finance.bill.approve (approve / reject)
 - finance.bill.pay (record and reverse payments)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status, UploadFile, File
from fastapi.responses import FileResponse

from core.permissions import AccessContext, get_access_context, require_permission
from finance.schemas import (
    BillCreate,
    BillUpdate,
    BillResponse,
    BillDuplicateCheckRequest,
    BillDuplicateCheckResponse,
    BillQueueCountsResponse,
    BillApprovalRequest,
    BillScheduleRequest,
    BillVoidRequest,
    BillUploadResponse,
    BillCategoryQualityReportResponse,
    BillDocumentExtractionResponse,
    BillPaymentCreate,
    PaymentResponse,
    PaymentReversalRequest,
)
from finance.services.bills_service import BillActor, BillsService
from finance.deps import get_bills_service, get_idempotency_key, get_idempotency_service
from finance.services.idempotency import IdempotencyService

router = APIRouter(prefix="/api/finance/bills", tags=["Finance - Vendor Bills"])


def _actor(access: AccessContext) -> BillActor:
    return BillActor(
        email=access.email,
        is_super_admin=access.is_super_admin,
        permissions=frozenset(access.permissions),
    )


@router.post("/extract", response_model=BillDocumentExtractionResponse)
async def extract_bill_document(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: BillsService = Depends(get_bills_service),
):
    """
    FUX-413: Extract text, dates, amounts, bill number, vendor, and lines from an uploaded PDF.
    Does not auto-promote or approve the bill. Reviews are strictly required.
    """
    return await service.extract_document(file=file)


@router.post("/upload", response_model=BillUploadResponse)
async def upload_bill_drafts(
    files: List[UploadFile] = File(...),
    current_user: dict = Depends(require_permission("finance.bill.write")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
):
    """
    Upload several PDFs or photos at once. Each file becomes its own Draft with its own vendor match;
    a weak match leaves the vendor empty and flags "vendor to confirm". Never creates a vendor.
    """
    return await service.upload_drafts(files, actor=_actor(access))


@router.get("/category-quality-report", response_model=BillCategoryQualityReportResponse)
def get_bill_category_quality_report(
    current_user: dict = Depends(require_permission("finance.bill.read")),
    service: BillsService = Depends(get_bills_service),
):
    """FUX-411: Audit report identifying bills whose category was historically unmatched or 'Other'."""
    return service.get_category_quality_report()


@router.get("/queue-counts", response_model=BillQueueCountsResponse)
def get_bill_queue_counts(
    vendor_id: Optional[int] = Query(None, description="Optional vendor filter"),
    current_user: dict = Depends(require_permission("finance.bill.read")),
    service: BillsService = Depends(get_bills_service),
):
    """Return counts for each AP Inbox queue tab."""
    return service.get_queue_counts(vendor_id=vendor_id)


@router.post("/check-duplicate", response_model=BillDuplicateCheckResponse)
def check_bill_duplicate(
    payload: BillDuplicateCheckRequest,
    current_user: dict = Depends(require_permission("finance.bill.read")),
    service: BillsService = Depends(get_bills_service),
):
    """Check for duplicate bill candidates based on vendor, bill number, amount, or file fingerprint."""
    return service.check_duplicates(payload)


@router.get("", response_model=List[BillResponse])
def list_vendor_bills(
    status: Optional[str] = Query(None, description="Filter by status: draft|pending_approval|rejected|approved|scheduled|partially_paid|paid|void"),
    queue: Optional[str] = Query(None, description="Status queue: one of the eight statuses, or all (everything except void)"),
    overdue: Optional[bool] = Query(None, description="true: only open bills whose due date has passed"),
    vendor_id: Optional[int] = Query(None, description="Filter by vendor ID"),
    search: Optional[str] = Query(None, description="Search by bill number, vendor name, or department"),
    has_attachment: Optional[bool] = Query(None, description="Filter bills having or missing attachment"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.bill.read")),
    service: BillsService = Depends(get_bills_service),
):
    """List vendor bills with optional queue, status, vendor, and search filters."""
    return service.list_bills(
        status=status,
        queue=queue,
        vendor_id=vendor_id,
        search=search,
        has_attachment=has_attachment,
        limit=limit,
        offset=offset,
        overdue=overdue,
    )


@router.get("/{bill_id}", response_model=BillResponse)
def get_vendor_bill(
    bill_id: int,
    current_user: dict = Depends(require_permission("finance.bill.read")),
    service: BillsService = Depends(get_bills_service),
):
    """Fetch a single bill by ID (includes all line items)."""
    return service.get_bill(bill_id)


@router.post("", response_model=BillResponse, status_code=status.HTTP_201_CREATED)
def create_vendor_bill(
    payload: BillCreate,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
    idempotency_key: Optional[str] = Depends(get_idempotency_key),
    idempotency: IdempotencyService = Depends(get_idempotency_service),
):
    """Create a new vendor bill with optional line items."""
    user_email = current_user.get("email") or current_user.get("sub") or "user"
    return idempotency.execute_idempotent(
        idempotency_key=idempotency_key,
        user_email=user_email,
        endpoint_path="/api/finance/bills:create",
        operation_fn=lambda: service.create_bill(payload, actor=_actor(access)),
    )


@router.post("/{bill_id}/approve", response_model=BillResponse)
def approve_vendor_bill(
    bill_id: int,
    payload: BillApprovalRequest,
    current_user: dict = Depends(require_permission("finance.bill.approve")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
):
    """
    Approve or reject a vendor bill.
    Enforces segregation of duties (no self-approval) and approver authorization limits.
    """
    return service.approve_bill(bill_id, payload, actor=_actor(access))


@router.post("/{bill_id}/submit", response_model=BillResponse)
def submit_vendor_bill(
    bill_id: int,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
):
    """Submit a Draft (or resubmit a Rejected) bill for approval."""
    return service.submit_bill(bill_id, actor=_actor(access))


@router.post("/{bill_id}/withdraw", response_model=BillResponse)
def withdraw_vendor_bill(
    bill_id: int,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
):
    """Withdraw a Pending approval bill back to Draft."""
    return service.withdraw_bill(bill_id, actor=_actor(access))


@router.post("/{bill_id}/schedule", response_model=BillResponse)
def schedule_vendor_bill(
    bill_id: int,
    payload: BillScheduleRequest,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
):
    """
    Schedule an approved vendor bill for future payment.
    """
    return service.schedule_bill(bill_id, payload, actor=_actor(access))


@router.put("/{bill_id}", response_model=BillResponse)
def update_vendor_bill(
    bill_id: int,
    payload: BillUpdate,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
):
    """Update a bill's fields and/or replace its line items."""
    return service.update_bill(bill_id, payload, actor=_actor(access))


@router.delete("/{bill_id}", status_code=status.HTTP_204_NO_CONTENT)
def discard_vendor_bill(
    bill_id: int,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
):
    """Discard draft: permanently deletes a Draft, its lines and its file. Any other bill returns 409;
    cancelling a bill is POST /bills/{id}/void with a reason."""
    service.discard_bill(bill_id, actor=_actor(access))


@router.post("/{bill_id}/void", response_model=BillResponse)
def void_vendor_bill_action(
    bill_id: int,
    payload: BillVoidRequest,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
):
    """Void a bill with a reason."""
    return service.void_bill(bill_id, reason=payload.reason, actor=_actor(access))


# ── Payments ──────────────────────────────────────────────────────────────────

@router.get("/{bill_id}/payments", response_model=List[PaymentResponse])
def list_bill_payments(
    bill_id: int,
    current_user: dict = Depends(require_permission("finance.bill.read")),
    service: BillsService = Depends(get_bills_service),
):
    """List all outgoing payments recorded against this bill."""
    return service.list_payments(bill_id)


@router.post(
    "/{bill_id}/payments",
    response_model=PaymentResponse,
    status_code=status.HTTP_201_CREATED,
)
def record_bill_payment(
    bill_id: int,
    payload: BillPaymentCreate,
    current_user: dict = Depends(require_permission("finance.bill.pay")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
    idempotency_key: Optional[str] = Depends(get_idempotency_key),
    idempotency: IdempotencyService = Depends(get_idempotency_service),
):
    """
    Record an outgoing payment against a vendor bill.
    Automatically adjusts the bank account balance and marks the bill
    as 'paid' once total payments >= bill total.
    """
    user_email = current_user.get("email") or current_user.get("sub") or "user"
    return idempotency.execute_idempotent(
        idempotency_key=idempotency_key,
        user_email=user_email,
        endpoint_path=f"/api/finance/bills:{bill_id}:payments",
        operation_fn=lambda: service.record_payment(bill_id, payload, actor=_actor(access)),
    )


@router.post(
    "/{bill_id}/payments/{payment_id}/reverse",
    response_model=PaymentResponse,
)
def reverse_bill_payment(
    bill_id: int,
    payment_id: int,
    payload: PaymentReversalRequest,
    current_user: dict = Depends(require_permission("finance.bill.pay")),
    access: AccessContext = Depends(get_access_context),
    service: BillsService = Depends(get_bills_service),
):
    """
    Atomically reverse a recorded bill payment.
    Restores the bank account balance and creates a corresponding reversal ledger entry.
    """
    return service.reverse_payment(
        bill_id=bill_id,
        payment_id=payment_id,
        req=payload,
        actor=_actor(access),
    )


# ── Attachments (FUX-407) ─────────────────────────────────────────────────────

@router.post("/{bill_id}/attachment", response_model=BillResponse)
async def upload_bill_attachment(
    bill_id: int,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: BillsService = Depends(get_bills_service),
):
    """
    Upload or replace a document attachment on a vendor bill.
    Stores the binary file on disk, generates SHA-256 fingerprint, and updates bill metadata.
    """
    return await service.upload_attachment(bill_id=bill_id, file=file)


@router.get("/{bill_id}/attachment")
def get_bill_attachment(
    bill_id: int,
    current_user: dict = Depends(require_permission("finance.bill.read")),
    service: BillsService = Depends(get_bills_service),
):
    """
    Download or stream the stored document attachment for a vendor bill.
    """
    file_path, filename, media_type = service.get_attachment_file(bill_id)
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=media_type,
    )


@router.delete("/{bill_id}/attachment", response_model=BillResponse)
def delete_bill_attachment(
    bill_id: int,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: BillsService = Depends(get_bills_service),
):
    """
    Delete the attached document from a vendor bill and remove storage references.
    """
    return service.delete_attachment(bill_id=bill_id)

