"""
be/finance/routers/bank_accounts.py
Production router for Company Bank Accounts.
Full CRUD wired to AccountsService and gated with RBAC permissions:
- finance.account.read (list, get)
- finance.account.write (create, update, deactivate)
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from core.permissions import require_permission, get_current_user_permissions
from models_db import AuditLogDB
from finance.schemas import (
    BankAccountCreate,
    BankAccountUpdate,
    BankAccountResponse,
    LedgerTransactionCreate,
    LedgerTransactionResponse,
    PettySummaryResponse,
)
from finance.services.accounts_service import AccountsService
from finance.services.ledger_service import LedgerService
from finance.deps import get_accounts_service, get_ledger_service

router = APIRouter(prefix="/api/finance/accounts", tags=["Finance - Bank Accounts"])


@router.get("", response_model=List[BankAccountResponse])
def list_company_bank_accounts(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Lists company bank accounts with masked account numbers and balance metrics."""
    return service.list_accounts(is_active=is_active, limit=limit, offset=offset)


@router.get("/{account_id}", response_model=BankAccountResponse)
def get_company_bank_account(
    account_id: int,
    request: Request,
    reveal: bool = Query(False, description="Reveal unmasked account identifier if authorized"),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Fetches a specific company bank account by ID. Masked by default unless reveal is authorized."""
    if reveal:
        perms = get_current_user_permissions(request, current_user=current_user, db=service.repo.db)
        if "*" not in perms and "finance.bank_account.reveal" not in perms:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: 'finance.bank_account.reveal' required to reveal unmasked account identifier",
            )
        user_email = current_user.get("email") or current_user.get("sub") or "user"
        audit = AuditLogDB(
            timestamp=datetime.utcnow().isoformat(),
            actor_email=user_email,
            action="bank_account_revealed",
            target_type="bank_account",
            target_id=str(account_id),
            details=f"Unmasked account identifier revealed for bank account #{account_id}",
        )
        service.repo.db.add(audit)
        service.repo.db.commit()

    return service.get_account(account_id, reveal=reveal)


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


# ==========================================
# Continuous Ledger & Petty Rollup (Phase 2)
# ==========================================
@router.get("/{account_id}/transactions", response_model=List[LedgerTransactionResponse])
def list_account_transactions(
    account_id: int,
    date_from: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    category_id: Optional[int] = Query(None, description="Filter by category ID"),
    payment_type_id: Optional[int] = Query(None, description="Filter by payment type ID"),
    direction: Optional[str] = Query(None, description="Filter by direction: in or out"),
    is_petty: Optional[bool] = Query(None, description="Filter transactions by petty category flag"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: LedgerService = Depends(get_ledger_service),
):
    """Lists continuous transactions for an account with running balances and filters."""
    return service.list_transactions(
        account_id=account_id,
        date_from=date_from,
        date_to=date_to,
        category_id=category_id,
        payment_type_id=payment_type_id,
        direction=direction,
        is_petty=is_petty,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/{account_id}/transactions",
    response_model=LedgerTransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_account_transaction(
    account_id: int,
    payload: LedgerTransactionCreate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: LedgerService = Depends(get_ledger_service),
):
    """Records a manual continuous ledger transaction and recomputes running balances."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.record_manual_transaction(account_id, payload, user_email=user_email)


@router.get(
    "/{account_id}/transactions/petty-summary",
    response_model=PettySummaryResponse,
)
def get_account_petty_summary(
    account_id: int,
    date_from: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: LedgerService = Depends(get_ledger_service),
):
    """Rollup view for categories flagged is_petty, giving compact recurring totals."""
    return service.get_petty_summary(account_id, date_from=date_from, date_to=date_to)

