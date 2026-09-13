"""
be/finance/routers/bills.py
Production router for Vendor Bills (Accounts Payable).
Full CRUD + payment recording, gated with RBAC permissions:
 - finance.bill.read  (list, get, list payments)
 - finance.bill.write (create, update, void, record payment)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status

from core.permissions import require_permission
from finance.schemas import (
    BillCreate,
    BillUpdate,
    BillResponse,
    PaymentCreate,
    PaymentResponse,
)
from finance.services.bills_service import BillsService
from finance.deps import get_bills_service

router = APIRouter(prefix="/api/finance/bills", tags=["Finance - Vendor Bills"])


@router.get("", response_model=List[BillResponse])
def list_vendor_bills(
    status: Optional[str] = Query(None, description="Filter by status: unpaid|paid|overdue|void"),
    vendor_id: Optional[int] = Query(None, description="Filter by vendor ID"),
    search: Optional[str] = Query(None, description="Search by bill number or vendor name"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.bill.read")),
    service: BillsService = Depends(get_bills_service),
):
    """List vendor bills with optional status, vendor, and search filters."""
    return service.list_bills(
        status=status, vendor_id=vendor_id, search=search, limit=limit, offset=offset
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
):
    """Create a new vendor bill with optional line items."""
    return service.create_bill(payload)


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
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: BillsService = Depends(get_bills_service),
):
    """Void a bill (irreversible soft-delete via status change)."""
    return service.void_bill(bill_id)


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
):
    """
    Record an outgoing payment against a vendor bill.
    Automatically adjusts the bank account balance and marks the bill
    as 'paid' once total payments >= bill total.
    """
    return service.record_payment(bill_id, payload)
