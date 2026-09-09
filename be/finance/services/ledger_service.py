"""
be/finance/services/ledger_service.py
Business logic and validation for the transaction ledger (Phase 1 Revision 2).
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.ledger_repository import LedgerRepository
from finance.repositories.accounts_repository import AccountsRepository
from finance.repositories.categories_repository import CategoriesRepository
from finance.repositories.payment_types_repository import PaymentTypesRepository
from finance.schemas import (
    LedgerTransactionCreate,
    LedgerTransactionResponse,
)
from finance.models import LedgerTransactionDB


class LedgerService:
    def __init__(
        self,
        repo: LedgerRepository,
        accounts_repo: Optional[AccountsRepository] = None,
        categories_repo: Optional[CategoriesRepository] = None,
        payment_types_repo: Optional[PaymentTypesRepository] = None,
    ):
        self.repo = repo
        self.accounts_repo = accounts_repo
        self.categories_repo = categories_repo
        self.payment_types_repo = payment_types_repo

    @staticmethod
    def compute_equivalent_amount(amount: float, currency: str, fx_rate: Optional[float], target_currency: Optional[str] = None) -> Optional[float]:
        """
        Computes equivalent value using fx_rate if present.
        Derived on read, never stored redundantly.
        """
        if not fx_rate or fx_rate <= 0:
            return None
        curr = (currency or "").upper()
        target = (target_currency or "").upper() if target_currency else ("EGP" if curr == "USD" else "USD")

        if curr == "USD" and target == "EGP":
            return round(amount * fx_rate, 4)
        elif curr == "EGP" and target == "USD":
            return round(amount / fx_rate, 4)
        else:
            return round(amount * fx_rate, 4)

    def to_response(self, tx: LedgerTransactionDB, target_currency: Optional[str] = None) -> LedgerTransactionResponse:
        cat_name = tx.category.name if tx.category else None
        pt_code = tx.payment_type.code if tx.payment_type else None
        pt_name = tx.payment_type.name if tx.payment_type else None
        fx_eq = self.compute_equivalent_amount(tx.amount, tx.currency, tx.fx_rate, target_currency)

        return LedgerTransactionResponse(
            id=tx.id,
            account_id=tx.account_id,
            date=tx.date,
            amount=tx.amount,
            direction=tx.direction,
            currency=tx.currency,
            category_id=tx.category_id,
            payment_type_id=tx.payment_type_id,
            category_name=cat_name,
            payment_type_code=pt_code,
            payment_type_name=pt_name,
            reference=tx.reference or "",
            description=tx.description or "",
            fx_rate=tx.fx_rate,
            fx_equivalent=fx_eq,
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
        category_id: Optional[int] = None,
        payment_type_id: Optional[int] = None,
        direction: Optional[str] = None,
        is_petty: Optional[bool] = None,
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
            category_id=category_id,
            payment_type_id=payment_type_id,
            direction=direction,
            is_petty=is_petty,
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

        # Resolve category string fallback if category_id not provided
        if not data.get("category_id") and payload.category and self.categories_repo:
            cat_match = self.categories_repo.get_by_name(payload.category)
            if cat_match:
                data["category_id"] = cat_match.id

        # Validate category_id exists if provided
        if data.get("category_id") and self.categories_repo:
            cat = self.categories_repo.get_by_id(data["category_id"])
            if not cat:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Category with ID {data['category_id']} not found",
                )

        # Validate payment_type_id exists if provided
        if data.get("payment_type_id") and self.payment_types_repo:
            pt = self.payment_types_repo.get_by_id(data["payment_type_id"])
            if not pt:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Payment type with ID {data['payment_type_id']} not found",
                )

        try:
            tx = self.repo.create_transaction(account_id, data, created_by=user_email)
            return self.to_response(tx)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )
