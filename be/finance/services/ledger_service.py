"""
be/finance/services/ledger_service.py
Business logic and validation for the transaction ledger.
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.ledger_repository import LedgerRepository
from finance.repositories.accounts_repository import AccountsRepository
from finance.schemas import (
    LedgerTransactionCreate,
    LedgerTransactionResponse,
)
from finance.models import LedgerTransactionDB


class LedgerService:
    def __init__(self, repo: LedgerRepository, accounts_repo: Optional[AccountsRepository] = None):
        self.repo = repo
        self.accounts_repo = accounts_repo

    def to_response(self, tx: LedgerTransactionDB) -> LedgerTransactionResponse:
        return LedgerTransactionResponse(
            id=tx.id,
            account_id=tx.account_id,
            date=tx.date,
            amount=tx.amount,
            direction=tx.direction,
            currency=tx.currency,
            category=tx.category,
            description=tx.description,
            source=tx.source,
            linked_invoice_id=tx.linked_invoice_id,
            linked_bill_id=tx.linked_bill_id,
            running_balance=tx.running_balance,
            created_at=tx.created_at,
            created_by=tx.created_by,
        )

    def list_transactions(
        self,
        account_id: int,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        category: Optional[str] = None,
        direction: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[LedgerTransactionResponse]:
        if self.accounts_repo:
            account = self.accounts_repo.get_by_id(account_id)
            if not account:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Bank account with ID {account_id} not found",
                )

        txs = self.repo.list_by_account(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            category=category,
            direction=direction,
            limit=limit,
            offset=offset,
        )
        return [self.to_response(tx) for tx in txs]

    def get_transaction(self, tx_id: int) -> LedgerTransactionResponse:
        tx = self.repo.get_by_id(tx_id)
        if not tx:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Transaction with ID {tx_id} not found",
            )
        return self.to_response(tx)

    def record_manual_transaction(
        self,
        account_id: int,
        payload: LedgerTransactionCreate,
        user_email: Optional[str] = None,
    ) -> LedgerTransactionResponse:
        if self.accounts_repo:
            account = self.accounts_repo.get_by_id(account_id)
            if not account:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Bank account with ID {account_id} not found",
                )

        if payload.direction not in ("in", "out"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transaction direction must be 'in' or 'out'",
            )

        if payload.amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transaction amount must be strictly greater than 0",
            )

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        data["source"] = "manual"

        try:
            tx = self.repo.create_transaction(account_id, data, created_by=user_email)
            return self.to_response(tx)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )
