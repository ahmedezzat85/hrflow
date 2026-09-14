"""
be/finance/routers/bills.py
Production router for Vendor Bills (Accounts Payable).
Full CRUD + payment recording, gated with RBAC permissions:
 - finance.bill.read  (list, get, list payments)
 - finance.bill.write (create, update, void, record payment)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status, UploadFile, File
from fastapi.responses import FileResponse

from core.permissions import require_permission
from finance.schemas import (
    BillCreate,
    BillUpdate,
    BillResponse,
    BillDuplicateCheckRequest,
    BillDuplicateCheckResponse,
    BillQueueCountsResponse,
    BillApprovalRequest,
    BillScheduleRequest,
    PaymentCreate,
    PaymentResponse,
    PaymentReversalRequest,
)
from finance.services.bills_service import BillsService
from finance.deps import get_bills_service, get_idempotency_key, get_idempotency_service
from finance.services.idempotency import IdempotencyService

router = APIRouter(prefix="/api/finance/bills", tags=["Finance - Vendor Bills"])


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
    status: Optional[str] = Query(None, description="Filter by status: inbox|needs_coding|needs_approval|ready_to_pay|scheduled|paid|exceptions|void"),
    queue: Optional[str] = Query(None, description="AP Inbox work queue: inbox|needs_coding|needs_approval|ready_to_pay|scheduled|paid|exceptions|all"),
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
        operation_fn=lambda: service.create_bill(payload, current_user=current_user),
    )


@router.post("/{bill_id}/approve", response_model=BillResponse)
def approve_vendor_bill(
    bill_id: int,
    payload: BillApprovalRequest,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: BillsService = Depends(get_bills_service),
):
    """
    Approve or reject a vendor bill.
    Enforces segregation of duties (no self-approval) and approver authorization limits.
    """
    return service.approve_bill(bill_id, payload, current_user=current_user)


@router.post("/{bill_id}/schedule", response_model=BillResponse)
def schedule_vendor_bill(
    bill_id: int,
    payload: BillScheduleRequest,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: BillsService = Depends(get_bills_service),
):
    """
    Schedule an approved vendor bill for future payment.
    """
    return service.schedule_bill(bill_id, payload)


@router.put("/{bill_id}", response_model=BillResponse)
def update_vendor_bill(
    bill_id: int,
    payload: BillUpdate,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: BillsService = Depends(get_bills_service),
):
    """Update a bill's fields and/or replace its line items."""
    return service.update_bill(bill_id, payload)


@router.delete("/{bill_id}", response_model=BillResponse)
def void_vendor_bill(
    bill_id: int,
    reason: Optional[str] = Query(None, description="Reason for voiding the bill"),
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: BillsService = Depends(get_bills_service),
):
    """Void a bill (irreversible soft-delete via status change)."""
    return service.void_bill(bill_id, reason=reason)


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
    payload: PaymentCreate,
    current_user: dict = Depends(require_permission("finance.bill.write")),
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
        operation_fn=lambda: service.record_payment(bill_id, payload),
    )


@router.post(
    "/{bill_id}/payments/{payment_id}/reverse",
    response_model=PaymentResponse,
)
def reverse_bill_payment(
    bill_id: int,
    payment_id: int,
    payload: PaymentReversalRequest,
    current_user: dict = Depends(require_permission("finance.bill.write")),
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
        current_user=current_user,
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

