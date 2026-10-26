"""
be/finance/routers/bank_accounts.py
Production router for Company Bank Accounts.
Full CRUD wired to AccountsService and gated with RBAC permissions:
- finance.account.read (list, get)
- finance.account.write (create, update, deactivate)
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse

from core.permissions import AccessContext, get_access_context, require_permission, get_current_user_permissions
from models_db import AuditLogDB
from finance.schemas import (
    BankAccountCreate,
    BankAccountUpdate,
    BankAccountResponse,
    BalanceCheckpointCreate,
    BalanceCheckpointResponse,
    BookResponse,
    YearOpeningItem,
    YearOpeningsResponse,
    YearOpeningUpsert,
    LedgerTransactionCreate,
    LedgerTransactionResponse,
    PettySummaryResponse,
    TransactionPreviewRequest,
    TransactionPreviewResponse,
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
    book: Optional[str] = Query(None, description="local | overseas | consolidated; omitted lists every account"),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Lists company bank accounts with masked account numbers and balance metrics."""
    from finance import books as _books
    return service.list_accounts(is_active=is_active, limit=limit, offset=offset, book=_books.validate_view(book))


@router.get("/books", response_model=List[BookResponse])
def list_books(
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Lists the company books (Local, Overseas)."""
    return [BookResponse(id=b.id, code=b.code, name=b.name, is_default=bool(b.is_default)) for b in service.list_books()]


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
        if "finance.bank_account.reveal" not in perms:
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
    access: AccessContext = Depends(get_access_context),
    service: LedgerService = Depends(get_ledger_service),
):
    """Records a manual continuous ledger transaction and recomputes running balances."""
    if payload.linked_bill_id and not (access.is_super_admin or "finance.bill.pay" in access.permissions):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied: 'finance.bill.pay' required to pay a vendor bill",
        )
    if (payload.entry_type or "").lower() == "adjustment":
        perms = set(current_user.get("permissions", [])) if isinstance(current_user, dict) else set()
        if "finance.adjustment.manage" not in perms:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manual balance adjustments require 'finance.adjustment.manage' authorization",
            )
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.record_manual_transaction(account_id, payload, user_email=user_email)


@router.post(
    "/{account_id}/transactions/preview",
    response_model=TransactionPreviewResponse,
)
def preview_account_transaction(
    account_id: int,
    payload: TransactionPreviewRequest,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: LedgerService = Depends(get_ledger_service),
):
    """Generates plain-language balance effect and journal preview without posting."""
    return service.preview_transaction(account_id, payload)


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


# --- Fiscal-year opening balances (BI-1, D-043): owner-entered opening per account and calendar year ---

@router.get("/{account_id}/year-openings", response_model=YearOpeningsResponse)
def list_account_year_openings(
    account_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: AccountsService = Depends(get_accounts_service),
):
    """One item per fiscal year: entered opening or the carried-forward value, with the difference from the previous closing."""
    return service.list_year_openings(account_id)


@router.put("/{account_id}/year-openings/{year}", response_model=YearOpeningItem)
def set_account_year_opening(
    account_id: int,
    year: int,
    payload: YearOpeningUpsert,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Creates or replaces the opening balance of a fiscal year and recalculates the account's running balances."""
    user_email = (current_user.get("email") or current_user.get("sub")) if isinstance(current_user, dict) else "user"
    return service.set_year_opening(account_id, year, payload, user=user_email)


@router.delete("/{account_id}/year-openings/{year}", response_model=YearOpeningItem)
def delete_account_year_opening(
    account_id: int,
    year: int,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Removes an entered opening; the year falls back to the previous closing (carried forward)."""
    user_email = (current_user.get("email") or current_user.get("sub")) if isinstance(current_user, dict) else "user"
    return service.delete_year_opening(account_id, year, user=user_email)


# --- Balance checkpoints (D-028): owner-entered balances for partial-visibility accounts ---

@router.get("/{account_id}/checkpoints", response_model=List[BalanceCheckpointResponse])
def list_account_checkpoints(
    account_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: AccountsService = Depends(get_accounts_service),
):
    return service.list_checkpoints(account_id)


@router.post("/{account_id}/checkpoints", response_model=BalanceCheckpointResponse, status_code=status.HTTP_201_CREATED)
def create_account_checkpoint(
    account_id: int,
    payload: BalanceCheckpointCreate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: AccountsService = Depends(get_accounts_service),
):
    """Records an observed balance. The difference from the ledger is shown, never posted."""
    user_email = (current_user.get("email") or current_user.get("sub")) if isinstance(current_user, dict) else "user"
    return service.create_checkpoint(account_id, payload, created_by=user_email)


@router.post("/{account_id}/checkpoints/{checkpoint_id}/attachment", response_model=BalanceCheckpointResponse)
async def upload_checkpoint_attachment(
    account_id: int,
    checkpoint_id: int,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: AccountsService = Depends(get_accounts_service),
):
    user_email = (current_user.get("email") or current_user.get("sub")) if isinstance(current_user, dict) else "user"
    return await service.upload_checkpoint_attachment(account_id, checkpoint_id, file, uploaded_by=user_email)


@router.get("/{account_id}/checkpoints/{checkpoint_id}/attachment")
def download_checkpoint_attachment(
    account_id: int,
    checkpoint_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: AccountsService = Depends(get_accounts_service),
):
    path, filename, media_type = service.get_checkpoint_attachment_file(account_id, checkpoint_id)
    return FileResponse(path=path, filename=filename, media_type=media_type)
