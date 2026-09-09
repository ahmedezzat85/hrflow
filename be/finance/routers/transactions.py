"""
be/finance/routers/transactions.py
Router for individual continuous ledger transactions.
Supports reading, updating (manual source only), and voiding/deleting (manual source only).
Gated by RBAC permissions:
- finance.account.read (get)
- finance.account.write (update, delete)
"""
from fastapi import APIRouter, Depends, status

from core.permissions import require_permission
from finance.schemas import (
    LedgerTransactionResponse,
    LedgerTransactionUpdate,
)
from finance.services.ledger_service import LedgerService
from finance.deps import get_ledger_service

router = APIRouter(prefix="/api/finance/transactions", tags=["Finance - Transactions"])


@router.get("/{transaction_id}", response_model=LedgerTransactionResponse)
def get_transaction(
    transaction_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: LedgerService = Depends(get_ledger_service),
):
    """Fetches a specific continuous ledger transaction by ID."""
    return service.get_transaction(transaction_id)


@router.patch("/{transaction_id}", response_model=LedgerTransactionResponse)
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
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: LedgerService = Depends(get_ledger_service),
):
    """
    Deletes/voids a manual ledger transaction and recomputes continuous running balances.
    Only manual-source transactions can be deleted.
    """
    return service.delete_manual_transaction(transaction_id)
