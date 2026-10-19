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

from core.permissions import AccessContext, get_access_context, require_permission
from finance.schemas import (
    SubscriptionChargeSettle,
    SubscriptionChargeSkip,
    SubscriptionChargeProof,
    GenerateChargesResult,
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


# --- Subscriptions v2 (X5, D-031). These fixed paths come before /subscriptions/{subscription_id}. ---

@router.get("/subscriptions/charges", response_model=List[SubscriptionChargeResponse])
def list_all_subscription_charges(
    status_filter: Optional[str] = Query(None, alias="status", description="expected | settled | skipped"),
    proof_status: Optional[str] = Query(None, description="attached | pending | unavailable"),
    proofs_missing: bool = Query(False, description="Only charges whose expected proof is still pending"),
    subscription_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    book: Optional[str] = Query(None, description="local | overseas | consolidated; by the paying account's book. Omitted = all"),
    current_user: dict = Depends(require_permission("finance.subscription.read")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """Charges across all subscriptions with status and proof filters."""
    return service.list_charges_v2(subscription_id, status_filter, proof_status, proofs_missing, date_from, date_to, book)


@router.post("/subscriptions/generate-charges", response_model=GenerateChargesResult)
def generate_due_subscription_charges(
    current_user: dict = Depends(require_permission("finance.subscription.write")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """Creates an expected charge for every due cycle that has none yet. Safe to call repeatedly."""
    return service.generate_due_charges()


@router.post("/subscriptions/charges/{charge_id}/settle", response_model=SubscriptionChargeResponse)
def settle_subscription_charge(
    charge_id: int,
    payload: SubscriptionChargeSettle,
    current_user: dict = Depends(require_permission("finance.subscription.write")),
    access: AccessContext = Depends(get_access_context),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """Settles an expected charge by linking an existing payment, or by creating an Already paid bill."""
    from finance.services.bills_service import BillActor
    actor = BillActor(email=access.email, is_super_admin=access.is_super_admin, permissions=frozenset(access.permissions))
    return service.settle_charge(charge_id, payload, actor=actor)


@router.post("/subscriptions/charges/{charge_id}/skip", response_model=SubscriptionChargeResponse)
def skip_subscription_charge(
    charge_id: int,
    payload: SubscriptionChargeSkip,
    current_user: dict = Depends(require_permission("finance.subscription.write")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    return service.skip_charge(charge_id, payload)


@router.patch("/subscriptions/charges/{charge_id}/proof", response_model=SubscriptionChargeResponse)
def set_subscription_charge_proof(
    charge_id: int,
    payload: SubscriptionChargeProof,
    current_user: dict = Depends(require_permission("finance.subscription.write")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """Marks the proof pending or unavailable (with a reason). Proof never blocks a charge."""
    return service.set_proof(charge_id, payload)


@router.post("/subscriptions/charges/{charge_id}/proof-file", response_model=SubscriptionChargeResponse)
async def upload_subscription_charge_proof(
    charge_id: int,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_permission("finance.subscription.write")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    user_email = current_user.get("email") or current_user.get("name") or "system"
    return await service.add_proof_file(charge_id, file, uploaded_by=user_email)


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
    create_bill: Optional[bool] = Form(False, description="Whether to generate/match a vendor bill"),
    variance_reason: Optional[str] = Form(None, description="Explanation for price or usage variance"),
    note: Optional[str] = Form("", description="Charge notes or memo"),
    bank_account_id: Optional[int] = Form(None, description="Bank account paying the charge"),
    file: Optional[UploadFile] = File(None, description="Receipt or invoice attachment"),
    current_user: dict = Depends(require_permission("finance.subscription.write")),
    service: SubscriptionsService = Depends(get_subscriptions_service),
):
    """
    Log an actual subscription charge (fixed or variable), optionally recording
    a bank ledger outflow, generating a linked bill, and attaching supporting invoice/receipt files.
    """
    charge_data = SubscriptionChargeCreate(
        subscription_id=subscription_id,
        amount=amount,
        billing_date=billing_date,
        currency=currency,
        create_bill=create_bill or False,
        variance_reason=variance_reason,
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
