"""
be/finance/routers/cheques.py
Router for Cheques and Cheque Register (Phase 5).
Handles cheque issuance, status lifecycle (cleared, bounced, voided), and register listing.
Gated by RBAC permissions:
- finance.account.read (list, get)
- finance.account.write (issue, update status)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status

from core.permissions import require_permission
from finance.schemas import (
    ChequeCreate,
    ChequeStatusUpdate,
    ChequeResponse,
)
from finance.services.cheques_service import ChequesService
from finance.deps import get_cheques_service

router = APIRouter(prefix="/api/finance/cheques", tags=["Finance - Cheques"])


@router.get("", response_model=List[ChequeResponse])
def list_cheques(
    fiscal_year: Optional[int] = Query(None, description="Filter by fiscal year (e.g. 2026)"),
    status: Optional[str] = Query(None, description="Filter by status: issued | cleared | bounced | voided"),
    account_id: Optional[int] = Query(None, description="Filter by bank account ID"),
    payee: Optional[str] = Query(None, description="Filter by payee name"),
    search: Optional[str] = Query(None, description="Search cheque number, payee, or notes"),
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
    )


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
    service: ChequesService = Depends(get_cheques_service),
):
    """Issues a new cheque, generating continuous ledger transactions and updating balances."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.issue_cheque(payload, created_by=user_email)


@router.patch("/{cheque_id}/status", response_model=ChequeResponse)
def update_cheque_status(
    cheque_id: int,
    payload: ChequeStatusUpdate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: ChequesService = Depends(get_cheques_service),
):
    """Updates cheque status (cleared, bounced, voided), performing ledger reversals if bounced or voided."""
    return service.update_cheque_status(cheque_id, payload)
