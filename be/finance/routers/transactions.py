"""
be/finance/routers/transactions.py
Router for individual continuous ledger transactions.
Supports reading, updating (manual source only), and voiding/deleting (manual source only).
Gated by RBAC permissions:
- finance.account.read (get)
- finance.account.write (update, delete)
"""
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from core.permissions import require_permission
from db import get_db
from finance.schemas import (
    LedgerTransactionResponse,
    LedgerTransactionUpdate,
    DuplicateSettlementCheckResponse,
    UnlinkedSettlementCandidateResponse,
)
from finance.services.ledger_service import LedgerService
from finance.services.settlement_service import SettlementService
from finance.deps import get_ledger_service

router = APIRouter(prefix="/api/finance/transactions", tags=["Finance - Transactions"])


@router.get("/duplicate-settlement-check", response_model=DuplicateSettlementCheckResponse)
def check_duplicate_settlement(
    payee_type: str = Query(..., description="Payee classification: vendor or customer"),
    payee_id: int = Query(..., description="Payee ID"),
    amount: float = Query(..., gt=0.0, description="Transaction amount"),
    date: Optional[str] = Query(None, description="Transaction date (YYYY-MM-DD)"),
    currency: Optional[str] = Query(None, description="Transaction currency"),
    current_user: dict = Depends(require_permission("finance.account.read")),
    db: Session = Depends(get_db),
):
    """Checks for duplicate or matching open bills/invoices for the selected payee before transaction creation."""
    svc = SettlementService(db)
    result = svc.check_duplicate_settlement(
        payee_type=payee_type,
        payee_id=payee_id,
        amount=amount,
        date_str=date,
        currency=currency,
    )
    return DuplicateSettlementCheckResponse(**result)


@router.get("/unlinked-settlement-candidates", response_model=List[UnlinkedSettlementCandidateResponse])
def get_unlinked_settlement_candidates(
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_permission("finance.account.read")),
    db: Session = Depends(get_db),
):
    """Surfaces unlinked transactions that have an open bill match for review."""
    svc = SettlementService(db)
    candidates = svc.find_unlinked_settlement_candidates(limit=limit)
    return [UnlinkedSettlementCandidateResponse(**c) for c in candidates]


@router.get("/{transaction_id}", response_model=LedgerTransactionResponse)
def get_transaction(
    transaction_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: LedgerService = Depends(get_ledger_service),
):
    """Fetches a specific continuous ledger transaction by ID."""
    return service.get_transaction(transaction_id)


@router.patch("/{transaction_id}", response_model=LedgerTransactionResponse)
@router.put("/{transaction_id}", response_model=LedgerTransactionResponse)
def update_manual_transaction(
    transaction_id: int,
    payload: LedgerTransactionUpdate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: LedgerService = Depends(get_ledger_service),
):
    """
    Updates a manual ledger transaction and recomputes continuous running balances.
    Only manual-source transactions can be edited directly.
    """
    return service.update_manual_transaction(transaction_id, payload)


@router.delete("/{transaction_id}")
def delete_manual_transaction(
    transaction_id: int,
    reason: Optional[str] = Query(None, description="Reason for deleting the transaction"),
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: LedgerService = Depends(get_ledger_service),
):
    """
    Deletes/voids a manual ledger transaction and recomputes continuous running balances.
    Only manual-source transactions can be deleted.
    """
    return service.delete_manual_transaction(transaction_id, reason=reason)
