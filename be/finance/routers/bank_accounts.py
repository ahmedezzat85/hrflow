"""
be/finance/routers/bank_accounts.py
Production router for Company Bank Accounts.
Full CRUD wired to AccountsService and gated with RBAC permissions:
- finance.account.read (list, get)
- finance.account.write (create, update, deactivate)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status

from core.permissions import require_permission
from finance.schemas import (
    BankAccountCreate,
    BankAccountUpdate,
    BankAccountResponse,
)
from finance.services.accounts_service import AccountsService
from finance.deps import get_accounts_service

router = APIRouter(prefix="/api/finance/accounts", tags=["Finance - Bank Accounts"])


@router.get("", response_model=List[BankAccountResponse])
def list_company_bank_accounts(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Lists company bank accounts with masked account numbers."""
    return service.list_accounts(is_active=is_active, limit=limit, offset=offset)


@router.get("/{account_id}", response_model=BankAccountResponse)
def get_company_bank_account(
    account_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Fetches a specific company bank account by ID."""
    return service.get_account(account_id)


@router.post("", response_model=BankAccountResponse, status_code=status.HTTP_201_CREATED)
def create_company_bank_account(
    payload: BankAccountCreate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Creates a new company bank account."""
    return service.create_account(payload)


@router.put("/{account_id}", response_model=BankAccountResponse)
def update_company_bank_account(
    account_id: int,
    payload: BankAccountUpdate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Updates an existing company bank account."""
    return service.update_account(account_id, payload)


@router.delete("/{account_id}", response_model=BankAccountResponse)
def deactivate_company_bank_account(
    account_id: int,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Soft-deletes / deactivates a company bank account."""
    return service.deactivate_account(account_id)
