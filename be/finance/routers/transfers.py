"""
be/finance/routers/transfers.py
Router for Account Transfers (Phase 3).
Supports multi-currency same-bank FX conversions, internal moves, and external-linked transfers.
Gated by RBAC permissions:
- finance.account.read (list, get)
- finance.account.write (create)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status

from core.permissions import require_permission
from finance.schemas import (
    AccountTransferCreate,
    AccountTransferResponse,
)
from finance.services.transfers_service import TransfersService
from finance.deps import get_transfers_service

router = APIRouter(prefix="/api/finance/transfers", tags=["Finance - Transfers"])


@router.get("", response_model=List[AccountTransferResponse])
def list_transfers(
    account_id: Optional[int] = Query(None, description="Filter transfers involving this bank account"),
    transfer_type: Optional[str] = Query(None, description="Filter by same_bank_fx | internal | external_linked"),
    date_from: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    exchange_reference: Optional[str] = Query(None, description="Filter by exchange reference text"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: TransfersService = Depends(get_transfers_service),
):
    """Lists account transfers with filtering by account, transfer type, date range, and reference."""
    return service.list_transfers(
        account_id=account_id,
        transfer_type=transfer_type,
        date_from=date_from,
        date_to=date_to,
        exchange_reference=exchange_reference,
        limit=limit,
        offset=offset,
    )


@router.get("/{transfer_id}", response_model=AccountTransferResponse)
def get_transfer(
    transfer_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: TransfersService = Depends(get_transfers_service),
):
    """Gets details of an account transfer by ID."""
    return service.get_transfer(transfer_id)


@router.post("", response_model=AccountTransferResponse, status_code=status.HTTP_201_CREATED)
def create_transfer(
    payload: AccountTransferCreate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: TransfersService = Depends(get_transfers_service),
):
    """
    Creates an account transfer:
    - Same-bank FX or internal moves atomically create both continuous ledger legs.
    - External-linked transfers create the confirmed leg, linking via exchange_reference.
    - Automatically updates running balances for all affected accounts.
    """
    created_by = current_user.get("email") or current_user.get("sub")
    return service.create_transfer(payload, created_by=created_by)
