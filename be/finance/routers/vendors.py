"""
be/finance/routers/vendors.py
Production router for Finance Vendors.
Full CRUD wired to VendorsService and gated with RBAC permissions:
- finance.vendor.read (list, get)
- finance.vendor.write (create, update, deactivate)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request, HTTPException, status

from core.permissions import require_permission, get_current_user_permissions
from finance.schemas import (
    VendorCreate,
    VendorUpdate,
    VendorResponse,
    VendorPaymentInstructionCreate,
    VendorPaymentInstructionUpdate,
    VendorPaymentInstructionResponse,
    VendorPaymentInstructionVerifyRequest,
    VendorDuplicateCheckRequest,
    VendorDuplicateCandidate,
    Vendor360Response,
)
from finance.services.vendors_service import VendorsService
from finance.deps import get_vendors_service

router = APIRouter(prefix="/api/finance/vendors", tags=["Finance - Vendors"])


@router.post("/check-duplicate", response_model=List[VendorDuplicateCandidate])
def check_vendor_duplicate(
    payload: VendorDuplicateCheckRequest,
    current_user: dict = Depends(require_permission("finance.vendor.read")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Detects potential duplicate vendors by normalized name, tax ID, or contact email."""
    return service.check_duplicates(payload)


@router.get("", response_model=List[VendorResponse])
def list_vendors(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    category: Optional[str] = Query(None, description="Filter by category"),
    search: Optional[str] = Query(None, description="Search by name, email, category, or tax ID"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.vendor.read")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Lists finance vendors."""
    return service.list_vendors(is_active=is_active, category=category, search=search, limit=limit, offset=offset)


@router.get("/{vendor_id}", response_model=VendorResponse)
def get_vendor(
    vendor_id: int,
    current_user: dict = Depends(require_permission("finance.vendor.read")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Fetches a specific vendor by ID."""
    return service.get_vendor(vendor_id)


@router.get("/{vendor_id}/360", response_model=Vendor360Response)
def get_vendor_360(
    vendor_id: int,
    request: Request,
    reveal: bool = Query(False, description="Reveal unmasked payment details if authorized"),
    current_user: dict = Depends(require_permission("finance.vendor.read")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Returns 360 profile summary for a vendor with spend metrics and payment instructions."""
    if reveal:
        perms = get_current_user_permissions(request, current_user=current_user, db=service.repo.db)
        if "*" not in perms and "finance.vendor_payment.reveal" not in perms:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: 'finance.vendor_payment.reveal' required to reveal unmasked payment data",
            )
    return service.get_vendor_360(vendor_id, reveal=reveal)


@router.post("", response_model=VendorResponse, status_code=status.HTTP_201_CREATED)
def create_vendor(
    payload: VendorCreate,
    current_user: dict = Depends(require_permission("finance.vendor.write")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Creates a new vendor."""
    return service.create_vendor(payload)


@router.put("/{vendor_id}", response_model=VendorResponse)
def update_vendor(
    vendor_id: int,
    payload: VendorUpdate,
    current_user: dict = Depends(require_permission("finance.vendor.write")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Updates an existing vendor."""
    return service.update_vendor(vendor_id, payload)


@router.delete("/{vendor_id}", response_model=VendorResponse)
def deactivate_vendor(
    vendor_id: int,
    current_user: dict = Depends(require_permission("finance.vendor.write")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Deactivates (soft-deletes) an existing vendor."""
    return service.soft_delete_vendor(vendor_id)


# ==========================================
# Payment Instructions Endpoints
# ==========================================
@router.get("/{vendor_id}/payment-instructions", response_model=List[VendorPaymentInstructionResponse])
def list_vendor_payment_instructions(
    vendor_id: int,
    request: Request,
    reveal: bool = Query(False, description="Reveal unmasked payment details if authorized"),
    current_user: dict = Depends(require_permission("finance.vendor.read")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Lists payment instructions for a vendor. Masked by default unless reveal is authorized."""
    if reveal:
        perms = get_current_user_permissions(request, current_user=current_user, db=service.repo.db)
        if "*" not in perms and "finance.vendor_payment.reveal" not in perms:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: 'finance.vendor_payment.reveal' required to reveal unmasked payment data",
            )
    return service.list_payment_instructions(vendor_id, reveal=reveal)


@router.post("/{vendor_id}/payment-instructions", response_model=VendorPaymentInstructionResponse, status_code=status.HTTP_201_CREATED)
def create_vendor_payment_instruction(
    vendor_id: int,
    payload: VendorPaymentInstructionCreate,
    request: Request,
    current_user: dict = Depends(require_permission("finance.vendor.read")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Creates a new payment instruction for a vendor. Requires write/manage permission."""
    perms = get_current_user_permissions(request, current_user=current_user, db=service.repo.db)
    if "*" not in perms and "finance.vendor_payment.manage" not in perms and "finance.vendor.write" not in perms:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied: 'finance.vendor_payment.manage' or 'finance.vendor.write' required",
        )
    actor_email = current_user.get("email", "system")
    return service.create_payment_instruction(vendor_id, payload, actor_email)


@router.put("/{vendor_id}/payment-instructions/{instruction_id}", response_model=VendorPaymentInstructionResponse)
def update_vendor_payment_instruction(
    vendor_id: int,
    instruction_id: int,
    payload: VendorPaymentInstructionUpdate,
    request: Request,
    current_user: dict = Depends(require_permission("finance.vendor.read")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Updates an existing payment instruction for a vendor."""
    perms = get_current_user_permissions(request, current_user=current_user, db=service.repo.db)
    if "*" not in perms and "finance.vendor_payment.manage" not in perms and "finance.vendor.write" not in perms:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied: 'finance.vendor_payment.manage' or 'finance.vendor.write' required",
        )
    actor_email = current_user.get("email", "system")
    return service.update_payment_instruction(vendor_id, instruction_id, payload, actor_email)


@router.post("/{vendor_id}/payment-instructions/{instruction_id}/verify", response_model=VendorPaymentInstructionResponse)
def verify_vendor_payment_instruction(
    vendor_id: int,
    instruction_id: int,
    payload: VendorPaymentInstructionVerifyRequest,
    request: Request,
    current_user: dict = Depends(require_permission("finance.vendor.read")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Verifies or rejects a payment instruction for a vendor."""
    perms = get_current_user_permissions(request, current_user=current_user, db=service.repo.db)
    if "*" not in perms and "finance.vendor_payment.verify" not in perms and "finance.vendor.write" not in perms:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied: 'finance.vendor_payment.verify' or 'finance.vendor.write' required",
        )
    actor_email = current_user.get("email", "system")
    return service.verify_payment_instruction(vendor_id, instruction_id, payload, actor_email)

