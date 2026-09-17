"""
be/finance/routers/statutory.py
Production router for Statutory Obligations (FUX-410).
Supports:
  - List obligations with filters (type, status, period)
  - Get single obligation detail
  - Manual obligation creation (starts in 'accrued' status)
  - Confirm / adjust accrued amount for estimated obligations
  - Settle obligation via SettlementService (atomic ledger transaction & bank balance deduction)
  - Update metadata (notes, due_date) with FUX-408 status integrity guard
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status

from core.permissions import require_permission
from finance.schemas import (
    StatutoryObligationCreate,
    StatutoryObligationConfirmAdjust,
    StatutoryObligationSettle,
    StatutoryObligationUpdate,
    StatutoryObligationResponse,
)
from finance.services.statutory_service import StatutoryObligationsService
from finance.deps import get_statutory_service

router = APIRouter(prefix="/api/finance/statutory-obligations", tags=["Finance - Statutory Obligations"])


@router.get("", response_model=List[StatutoryObligationResponse])
def list_statutory_obligations(
    obligation_type: Optional[str] = Query(None, description="Filter by obligation type"),
    status: Optional[str] = Query(None, description="Filter by status (estimated, accrued, partially_remitted, remitted)"),
    period: Optional[str] = Query(None, description="Filter by period (e.g. 2026-09)"),
    source_type: Optional[str] = Query(None, description="Filter by source type (payroll_run, manual, etc.)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.bill.read")),
    service: StatutoryObligationsService = Depends(get_statutory_service),
):
    """Lists statutory obligations with optional filtering and pagination."""
    return service.list_obligations(
        obligation_type=obligation_type,
        status_filter=status,
        period=period,
        source_type=source_type,
        limit=limit,
        offset=offset,
    )


@router.get("/{obligation_id}", response_model=StatutoryObligationResponse)
def get_statutory_obligation(
    obligation_id: int,
    current_user: dict = Depends(require_permission("finance.bill.read")),
    service: StatutoryObligationsService = Depends(get_statutory_service),
):
    """Retrieve details of a single statutory obligation."""
    return service.get_obligation(obligation_id)


@router.post("", response_model=StatutoryObligationResponse, status_code=status.HTTP_201_CREATED)
def create_statutory_obligation(
    payload: StatutoryObligationCreate,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: StatutoryObligationsService = Depends(get_statutory_service),
):
    """
    Record a statutory obligation manually.
    Obligation is created directly in 'accrued' status (bypassing the estimate step).
    """
    return service.create_obligation(payload.dict())


@router.post("/{obligation_id}/confirm", response_model=StatutoryObligationResponse)
def confirm_or_adjust_statutory_obligation(
    obligation_id: int,
    payload: StatutoryObligationConfirmAdjust,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: StatutoryObligationsService = Depends(get_statutory_service),
):
    """
    Explicitly confirm or adjust an estimated statutory obligation.
    Moves status from 'estimated' to 'accrued', records variance amount and explanation note.
    """
    return service.confirm_or_adjust(obligation_id, payload.dict())


@router.post("/{obligation_id}/settle", response_model=StatutoryObligationResponse)
def settle_statutory_obligation(
    obligation_id: int,
    payload: StatutoryObligationSettle,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: StatutoryObligationsService = Depends(get_statutory_service),
):
    """
    Record a remittance payment against an accrued or partially remitted statutory obligation.
    Atomically updates obligation status, creates linked ledger transaction, and updates bank account balance.
    """
    return service.settle_obligation(obligation_id, payload.dict())


@router.patch("/{obligation_id}", response_model=StatutoryObligationResponse)
def update_statutory_obligation(
    obligation_id: int,
    payload: StatutoryObligationUpdate,
    current_user: dict = Depends(require_permission("finance.bill.write")),
    service: StatutoryObligationsService = Depends(get_statutory_service),
):
    """
    Update non-financial metadata (due_date, notes).
    Protected by status integrity guard: direct status manipulation is rejected with 400 Bad Request.
    """
    return service.update_obligation(obligation_id, payload.dict())
