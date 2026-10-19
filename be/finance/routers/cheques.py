"""
be/finance/routers/cheques.py
Router for Cheques and Cheque Register (Phase 5).
Handles cheque issuance, status lifecycle (cleared, bounced, voided), and register listing.
Gated by RBAC permissions:
- finance.account.read (list, get)
- finance.account.write (issue, update status)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse

from core.permissions import AccessContext, get_access_context, require_permission
from finance.schemas import (
    ChequeCreate,
    ChequeStatusUpdate,
    ChequeReplaceRequest,
    ChequeResponse,
    ChequeAttachmentResponse,
    NextChequeNumberResponse,
)
from finance.services.cheques_service import ChequesService
from finance.deps import get_cheques_service, get_idempotency_key, get_idempotency_service
from finance.services.idempotency import IdempotencyService

router = APIRouter(prefix="/api/finance/cheques", tags=["Finance - Cheques"])


@router.get("", response_model=List[ChequeResponse])
def list_cheques(
    fiscal_year: Optional[int] = Query(None, description="Filter by fiscal year (e.g. 2026)"),
    status: Optional[str] = Query(None, description="Filter by status: draft | issued | outstanding | cleared | bounced | stopped | voided | replaced"),
    account_id: Optional[int] = Query(None, description="Filter by bank account ID"),
    payee: Optional[str] = Query(None, description="Filter by payee name"),
    search: Optional[str] = Query(None, description="Search cheque number, payee, or notes"),
    has_scan: Optional[bool] = Query(None, description="true = only cheques with a scan, false = only cheques missing a scan"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: ChequesService = Depends(get_cheques_service),
):
    """Lists cheques in the register with filtering options."""
    return service.list_cheques(
        fiscal_year=fiscal_year,
        status=status,
        account_id=account_id,
        payee=payee,
        search=search,
        limit=limit,
        offset=offset,
        has_scan=has_scan,
    )


@router.get("/next-number", response_model=NextChequeNumberResponse)
def next_cheque_number(
    account_id: int = Query(..., description="Bank account the cheque will be drawn on"),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: ChequesService = Depends(get_cheques_service),
):
    """Suggests the next cheque number for an account (last numeric serial + 1, zero padding preserved)."""
    return service.suggest_next_number(account_id)


@router.get("/{cheque_id}", response_model=ChequeResponse)
def get_cheque(
    cheque_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: ChequesService = Depends(get_cheques_service),
):
    """Gets details of a single cheque by ID."""
    return service.get_cheque(cheque_id)


@router.post("", response_model=ChequeResponse, status_code=status.HTTP_201_CREATED)
def issue_cheque(
    payload: ChequeCreate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    access: AccessContext = Depends(get_access_context),
    service: ChequesService = Depends(get_cheques_service),
    idempotency_key: Optional[str] = Depends(get_idempotency_key),
    idempotency: IdempotencyService = Depends(get_idempotency_service),
):
    """Issues or drafts a new cheque, generating continuous ledger transactions and updating balances."""
    if payload.linked_bill_id and not (access.is_super_admin or "finance.bill.pay" in access.permissions):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied: 'finance.bill.pay' required to pay a vendor bill",
        )
    user_email = (current_user.get("email") or current_user.get("sub")) if isinstance(current_user, dict) else "user"
    return idempotency.execute_idempotent(
        idempotency_key=idempotency_key,
        user_email=user_email,
        endpoint_path="/api/finance/cheques:issue",
        operation_fn=lambda: service.issue_cheque(payload, created_by=user_email),
    )


@router.patch("/{cheque_id}/status", response_model=ChequeResponse)
def update_cheque_status(
    cheque_id: int,
    payload: ChequeStatusUpdate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: ChequesService = Depends(get_cheques_service),
    idempotency_key: Optional[str] = Depends(get_idempotency_key),
    idempotency: IdempotencyService = Depends(get_idempotency_service),
):
    """Updates cheque status (outstanding, cleared, bounced, stopped, voided), performing ledger updates or reversals."""
    user_email = (current_user.get("email") or current_user.get("sub")) if isinstance(current_user, dict) else "user"
    return idempotency.execute_idempotent(
        idempotency_key=idempotency_key,
        user_email=user_email,
        endpoint_path=f"/api/finance/cheques:{cheque_id}:status:{payload.status}",
        operation_fn=lambda: service.update_cheque_status(cheque_id, payload),
    )


@router.post("/{cheque_id}/replace", response_model=ChequeResponse, status_code=status.HTTP_201_CREATED)
def replace_cheque(
    cheque_id: int,
    payload: ChequeReplaceRequest,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: ChequesService = Depends(get_cheques_service),
    idempotency_key: Optional[str] = Depends(get_idempotency_key),
    idempotency: IdempotencyService = Depends(get_idempotency_service),
):
    """Replaces a cheque with a new serial number, reversing old cheque ledger entries and linking both records."""
    user_email = (current_user.get("email") or current_user.get("sub")) if isinstance(current_user, dict) else "user"
    return idempotency.execute_idempotent(
        idempotency_key=idempotency_key,
        user_email=user_email,
        endpoint_path=f"/api/finance/cheques:{cheque_id}:replace",
        operation_fn=lambda: service.replace_cheque(cheque_id, payload, created_by=user_email),
    )


# --- Cheque scans (D-032). Read = finance.account.read, write = finance.account.write (same as the cheque register). ---

@router.post("/{cheque_id}/attachments", response_model=List[ChequeAttachmentResponse], status_code=status.HTTP_201_CREATED)
async def upload_cheque_attachments(
    cheque_id: int,
    files: List[UploadFile] = File(..., description="One or more scan files"),
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: ChequesService = Depends(get_cheques_service),
):
    user_email = (current_user.get("email") or current_user.get("sub")) if isinstance(current_user, dict) else "user"
    return await service.upload_attachments(cheque_id, files, uploaded_by=user_email)


@router.get("/{cheque_id}/attachments", response_model=List[ChequeAttachmentResponse])
def list_cheque_attachments(
    cheque_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: ChequesService = Depends(get_cheques_service),
):
    return service.list_attachments(cheque_id)


@router.get("/{cheque_id}/attachments/{attachment_id}/download")
def download_cheque_attachment(
    cheque_id: int,
    attachment_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: ChequesService = Depends(get_cheques_service),
):
    path, filename, media_type = service.get_attachment_file(cheque_id, attachment_id)
    return FileResponse(path=path, filename=filename, media_type=media_type)


@router.delete("/{cheque_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cheque_attachment(
    cheque_id: int,
    attachment_id: int,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: ChequesService = Depends(get_cheques_service),
):
    service.delete_attachment(cheque_id, attachment_id)
