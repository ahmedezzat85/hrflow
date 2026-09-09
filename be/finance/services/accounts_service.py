"""
be/finance/services/accounts_service.py
Business logic and security rules for Company Bank Accounts.
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.accounts_repository import AccountsRepository
from finance.schemas import BankAccountCreate, BankAccountUpdate, BankAccountResponse
from finance.models import FinanceBankAccountDB


class AccountsService:
    def __init__(self, repo: AccountsRepository):
        self.repo = repo

    @staticmethod
    def mask_account_number(raw: str) -> str:
        """Masks all but the last 4 characters of the bank account number."""
        clean = (raw or "").strip()
        if len(clean) <= 4:
            return f"******{clean}"
        return f"{'*' * (len(clean) - 4)}{clean[-4:]}"

    def to_response(self, account: FinanceBankAccountDB) -> BankAccountResponse:
        return BankAccountResponse(
            id=account.id,
            account_name=account.account_name,
            bank_name=account.bank_name,
            account_number=self.mask_account_number(account.account_number),
            currency=account.currency,
            opening_balance=account.opening_balance,
            current_balance=account.current_balance,
            account_type=getattr(account, "account_type", "bank"),
            country=getattr(account, "country", "Egypt"),
            is_active=account.is_active,
            created_at=account.created_at,
        )

    def list_accounts(
        self,
        is_active: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[BankAccountResponse]:
        accounts = self.repo.list_all(is_active=is_active, limit=limit, offset=offset)
        return [self.to_response(acc) for acc in accounts]

    def get_account(self, account_id: int) -> BankAccountResponse:
        account = self.repo.get_by_id(account_id)
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank account with ID {account_id} not found",
            )
        return self.to_response(account)

    def create_account(self, payload: BankAccountCreate) -> BankAccountResponse:
        existing = self.repo.get_by_name(payload.account_name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"A bank account with name '{payload.account_name}' already exists",
            )

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        account = self.repo.create(data)
        return self.to_response(account)

    def update_account(self, account_id: int, payload: BankAccountUpdate) -> BankAccountResponse:
        existing = self.repo.get_by_id(account_id)
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank account with ID {account_id} not found",
            )

        if payload.account_name and payload.account_name.lower() != existing.account_name.lower():
            name_clash = self.repo.get_by_name(payload.account_name)
            if name_clash and name_clash.id != account_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"A bank account with name '{payload.account_name}' already exists",
                )

        data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        updated = self.repo.update(account_id, data)
        return self.to_response(updated)

    def deactivate_account(self, account_id: int) -> BankAccountResponse:
        existing = self.repo.get_by_id(account_id)
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank account with ID {account_id} not found",
            )
        deactivated = self.repo.soft_delete(account_id)
        return self.to_response(deactivated)

    def compute_balance_as_of(self, account_id: int, as_of_date: Optional[str] = None) -> float:
        existing = self.repo.get_by_id(account_id)
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank account with ID {account_id} not found",
            )
        return self.repo.compute_balance(account_id, as_of_date=as_of_date)

    def recalculate_balance(self, account_id: int) -> float:
        existing = self.repo.get_by_id(account_id)
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank account with ID {account_id} not found",
            )
        return self.repo.recalculate_and_sync_current_balance(account_id)
