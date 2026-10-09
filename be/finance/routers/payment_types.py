"""
be/finance/routers/payment_types.py
Router for Payment Types (Phase 0).
Full CRUD (with deactivation for delete) gated with RBAC:
- finance.account.read (list, get)
- finance.account.write (create, update, deactivate)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.permissions import AccessContext, get_access_context, require_permission
from finance.schemas import PaymentTypeCreate, PaymentTypeUpdate, PaymentTypeResponse
from finance.services.payment_types_service import PaymentTypesService
from finance.deps import get_payment_types_service

router = APIRouter(prefix="/api/finance/payment-types", tags=["Finance - Payment Types"])


def _payment_types_guard(
    usage: Optional[str] = Query(None, description="bill_payment: only the types a vendor-bill payment may use"),
    access: AccessContext = Depends(get_access_context),
) -> AccessContext:
    """finance.account.read, or finance.bill.read when only the bill_payment types are requested."""
    perms = access.permissions
    if "finance.account.read" in perms or (usage == "bill_payment" and "finance.bill.read" in perms):
        return access
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Permission denied: 'finance.account.read' required",
    )


_payment_types_guard.hrflow_permission = "finance.account.read"


@router.get("", response_model=List[PaymentTypeResponse])
def list_payment_types(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    usage: Optional[str] = Query(None, description="bill_payment: only the types a vendor-bill payment may use"),
    account_type: Optional[str] = Query(None, description="bank | cash (with usage=bill_payment)"),
    access: AccessContext = Depends(_payment_types_guard),
    service: PaymentTypesService = Depends(get_payment_types_service),
):
    """Lists payment types. Bill payers (finance.bill.read) may list the bill_payment types."""
    return service.list_payment_types(is_active=is_active, usage=usage, account_type=account_type)


@router.get("/{pt_id}", response_model=PaymentTypeResponse)
def get_payment_type(
    pt_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: PaymentTypesService = Depends(get_payment_types_service),
):
    """Fetches a specific payment type by ID."""
    return service.get_payment_type(pt_id)


@router.post("", response_model=PaymentTypeResponse, status_code=status.HTTP_201_CREATED)
def create_payment_type(
    payload: PaymentTypeCreate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: PaymentTypesService = Depends(get_payment_types_service),
):
    """Creates a new payment type."""
    return service.create_payment_type(payload)


@router.patch("/{pt_id}", response_model=PaymentTypeResponse)
def update_payment_type(
    pt_id: int,
    payload: PaymentTypeUpdate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: PaymentTypesService = Depends(get_payment_types_service),
):
    """Updates an existing payment type."""
    return service.update_payment_type(pt_id, payload)


@router.delete("/{pt_id}", response_model=PaymentTypeResponse)
def deactivate_payment_type(
    pt_id: int,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: PaymentTypesService = Depends(get_payment_types_service),
):
    """Deactivates a payment type."""
    return service.deactivate_payment_type(pt_id)
