"""
be/finance/routers/subscriptions.py
Router for Recurring Vendor Subscriptions, Charges, and Attachments (Phase 6).
Gated with RBAC permissions:
- finance.subscription.read
- finance.subscription.write
"""
import os
from typing import List, Optional
from fastapi import (
    APIRouter,
    Depends,
    Query,
    status,
    UploadFile,
    File,
    Form,
    HTTPException,
)
from fastapi.responses import FileResponse

from core.permissions import require_permission
from finance.schemas import (
    SubscriptionCreate,
    SubscriptionUpdate,
    SubscriptionResponse,
    SubscriptionChargeCreate,
    SubscriptionChargeResponse,
    FinanceAttachmentResponse,
)
from finance.services.subscriptions_service import SubscriptionsService
from finance.deps import get_subscriptions_service

router = APIRouter(prefix="/api/finance", tags=["Finance - Subscriptions & Attachments"])


@router.get("/subscriptions", response_model=List[SubscriptionResponse])
def list_subscriptions(
    is_active: Optional[bool] = Query(None, description="Filter active status"),
    vendor_id: Optional[int] = Query(None, description="Filter by vendor ID"),
    current_user: dict = Depends(require_permission("finance.subscription.read")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """List recurring vendor subscriptions."""
    return service.list_subscriptions(is_active=is_active, vendor_id=vendor_id)


@router.post("/subscriptions", response_model=SubscriptionResponse, status_code=status.HTTP_201_CREATED)
def create_subscription(
    data: SubscriptionCreate,
    current_user: dict = Depends(require_permission("finance.subscription.write")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """Create a new recurring vendor subscription."""
    return service.create_subscription(data)


@router.get("/subscriptions/{subscription_id}", response_model=SubscriptionResponse)
def get_subscription(
    subscription_id: int,
    current_user: dict = Depends(require_permission("finance.subscription.read")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """Retrieve details of a single subscription."""
    return service.get_subscription(subscription_id)


@router.patch("/subscriptions/{subscription_id}", response_model=SubscriptionResponse)
def update_subscription(
    subscription_id: int,
    data: SubscriptionUpdate,
    current_user: dict = Depends(require_permission("finance.subscription.write")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """Update subscription parameters (renewal date, amount, active status)."""
    return service.update_subscription(subscription_id, data)


@router.get("/subscriptions/{subscription_id}/charges", response_model=List[SubscriptionChargeResponse])
def list_subscription_charges(
    subscription_id: int,
    current_user: dict = Depends(require_permission("finance.subscription.read")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """List historical charges logged for a specific subscription."""
    return service.list_charges(subscription_id=subscription_id)


@router.post("/subscriptions/{subscription_id}/charges", response_model=SubscriptionChargeResponse, status_code=status.HTTP_201_CREATED)
async def log_subscription_charge(
    subscription_id: int,
    amount: float = Form(..., description="Actual charge amount"),
    billing_date: str = Form(..., description="Charge date (YYYY-MM-DD)"),
    currency: str = Form("USD", description="Currency"),
    note: Optional[str] = Form("", description="Charge notes or memo"),
    bank_account_id: Optional[int] = Form(None, description="Bank account paying the charge"),
    file: Optional[UploadFile] = File(None, description="Receipt or invoice attachment"),
    current_user: dict = Depends(require_permission("finance.subscription.write")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """
    Log an actual subscription charge (fixed or variable), optionally recording
    a bank ledger outflow and attaching supporting invoice/receipt files.
    """
    charge_data = SubscriptionChargeCreate(
        subscription_id=subscription_id,
        amount=amount,
        billing_date=billing_date,
        currency=currency,
        note=note or "",
        bank_account_id=bank_account_id,
    )
    user_email = current_user.get("email") or current_user.get("name") or "system"
    return await service.log_charge(charge_data, file=file, created_by=user_email)


@router.get("/attachments/{attachment_id}/download")
def download_finance_attachment(
    attachment_id: int,
    current_user: dict = Depends(require_permission("finance.subscription.read")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """Download a private finance attachment (receipt/invoice)."""
    att = service.get_attachment(attachment_id)
    if not os.path.exists(att.storage_ref):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment file not found on disk",
        )

    return FileResponse(
        path=att.storage_ref,
        filename=att.file_name,
        media_type=att.mime_type,
    )
