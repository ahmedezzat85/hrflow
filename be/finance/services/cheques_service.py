"""
be/finance/services/cheques_service.py
Service layer for Cheques and Cheque Register lifecycle.
Validates accounts, purpose types, unique cheque numbers, and status transitions.
"""
from typing import List, Optional
from datetime import datetime
from fastapi import HTTPException, status

from finance.repositories.cheques_repository import ChequesRepository
from finance.schemas import (
    ChequeCreate,
    ChequeStatusUpdate,
    ChequeResponse,
)
from finance.models import FinanceChequeDB, FinanceBankAccountDB, BillDB


VALID_PURPOSE_TYPES = {"vendor_payment", "cash_withdrawal", "other"}
VALID_CHEQUE_STATUSES = {"issued", "cleared", "bounced", "voided"}


class ChequesService:
    def __init__(self, repo: ChequesRepository):
        self.repo = repo

    def _cheque_to_response(self, cheque: FinanceChequeDB) -> ChequeResponse:
        account_name = cheque.account.account_name if cheque.account else None
        dest_cash_name = (
            cheque.destination_cash_account.account_name
            if cheque.destination_cash_account
            else None
        )
        return ChequeResponse(
            id=cheque.id,
            cheque_number=cheque.cheque_number,
            account_id=cheque.account_id,
            account_name=account_name,
            issue_date=cheque.issue_date,
            amount=cheque.amount,
            currency=cheque.currency,
            payee=cheque.payee,
            purpose_type=cheque.purpose_type,
            destination_cash_account_id=cheque.destination_cash_account_id,
            destination_cash_account_name=dest_cash_name,
            linked_bill_id=cheque.linked_bill_id,
            status=cheque.status,
            clear_date=cheque.clear_date,
            fiscal_year=cheque.fiscal_year,
            linked_transaction_id=cheque.linked_transaction_id,
            linked_cash_transaction_id=cheque.linked_cash_transaction_id,
            notes=cheque.notes or "",
            created_at=cheque.created_at,
            created_by=cheque.created_by,
        )

    def list_cheques(
        self,
        fiscal_year: Optional[int] = None,
        status: Optional[str] = None,
        account_id: Optional[int] = None,
        payee: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[ChequeResponse]:
        if status and status not in VALID_CHEQUE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{status}'. Must be one of: {', '.join(sorted(VALID_CHEQUE_STATUSES))}",
            )
        cheques = self.repo.list_cheques(
            fiscal_year=fiscal_year,
            status=status,
            account_id=account_id,
            payee=payee,
            search=search,
            limit=limit,
            offset=offset,
        )
        return [self._cheque_to_response(c) for c in cheques]

    def get_cheque(self, cheque_id: int) -> ChequeResponse:
        cheque = self.repo.get_by_id(cheque_id)
        if not cheque:
            raise HTTPException(status_code=404, detail=f"Cheque {cheque_id} not found")
        return self._cheque_to_response(cheque)

    def issue_cheque(self, payload: ChequeCreate, created_by: Optional[str] = None) -> ChequeResponse:
        # Validate purpose type
        if payload.purpose_type not in VALID_PURPOSE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid purpose_type '{payload.purpose_type}'. Must be one of: {', '.join(sorted(VALID_PURPOSE_TYPES))}",
            )

        # Validate source bank account
        bank_acc = self.repo.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == payload.account_id).first()
        if not bank_acc:
            raise HTTPException(status_code=404, detail=f"Source bank account {payload.account_id} not found")
        if not bank_acc.is_active:
            raise HTTPException(status_code=400, detail=f"Bank account '{bank_acc.account_name}' is inactive")
        if bank_acc.account_type != "bank":
            raise HTTPException(
                status_code=400,
                detail=f"Cheques must be drawn from a bank account, but '{bank_acc.account_name}' is an account of type '{bank_acc.account_type}'",
            )

        # Validate cash withdrawal destination account
        if payload.purpose_type == "cash_withdrawal":
            if not payload.destination_cash_account_id:
                raise HTTPException(
                    status_code=400,
                    detail="destination_cash_account_id is required when purpose_type is 'cash_withdrawal'",
                )
            cash_acc = (
                self.repo.db.query(FinanceBankAccountDB)
                .filter(FinanceBankAccountDB.id == payload.destination_cash_account_id)
                .first()
            )
            if not cash_acc:
                raise HTTPException(
                    status_code=404,
                    detail=f"Destination cash account {payload.destination_cash_account_id} not found",
                )
            if not cash_acc.is_active:
                raise HTTPException(status_code=400, detail=f"Destination cash account '{cash_acc.account_name}' is inactive")
            if cash_acc.account_type != "cash":
                raise HTTPException(
                    status_code=400,
                    detail=f"Destination account '{cash_acc.account_name}' must be of account_type 'cash', not '{cash_acc.account_type}'",
                )

        # Validate linked bill if present
        if payload.linked_bill_id:
            bill = self.repo.db.query(BillDB).filter(BillDB.id == payload.linked_bill_id).first()
            if not bill:
                raise HTTPException(status_code=404, detail=f"Linked bill {payload.linked_bill_id} not found")

        # Check unique cheque number for this account
        existing = self.repo.get_by_account_and_number(payload.account_id, payload.cheque_number)
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Cheque number '{payload.cheque_number}' has already been issued for account '{bank_acc.account_name}'",
            )

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        try:
            cheque = self.repo.create_cheque(data, created_by=created_by)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return self._cheque_to_response(cheque)

    def update_cheque_status(
        self, cheque_id: int, payload: ChequeStatusUpdate
    ) -> ChequeResponse:
        cheque = self.repo.get_by_id(cheque_id)
        if not cheque:
            raise HTTPException(status_code=404, detail=f"Cheque {cheque_id} not found")

        if payload.status not in VALID_CHEQUE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{payload.status}'. Must be one of: {', '.join(sorted(VALID_CHEQUE_STATUSES))}",
            )

        if cheque.status in ("bounced", "voided") and payload.status in ("cleared", "issued"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition a {cheque.status} cheque back to {payload.status}",
            )

        try:
            updated = self.repo.update_status(
                cheque_id=cheque_id,
                status=payload.status,
                clear_date=payload.clear_date,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return self._cheque_to_response(updated)
