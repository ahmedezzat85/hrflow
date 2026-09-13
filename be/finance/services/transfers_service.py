"""
be/finance/services/transfers_service.py
Business logic, validations, and mapping for Account Transfers (Phase 3).
"""
from typing import List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from finance.models import AccountTransferDB, FinanceBankAccountDB
from finance.repositories.transfers_repository import TransfersRepository
from finance.schemas import AccountTransferCreate, AccountTransferResponse


class TransfersService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = TransfersRepository(db)

    def to_response(self, transfer: AccountTransferDB) -> AccountTransferResponse:
        out_tx_id = None
        in_tx_id = None
        for tx in transfer.ledger_transactions or []:
            if tx.direction == "out":
                out_tx_id = tx.id
            elif tx.direction == "in":
                in_tx_id = tx.id

        return AccountTransferResponse(
            id=transfer.id,
            from_account_id=transfer.from_account_id,
            to_account_id=transfer.to_account_id,
            date=transfer.date,
            from_amount=transfer.from_amount,
            from_currency=transfer.from_currency,
            to_amount=transfer.to_amount,
            to_currency=transfer.to_currency,
            fx_rate=transfer.fx_rate,
            transfer_type=transfer.transfer_type,
            exchange_reference=transfer.exchange_reference,
            confirmed_leg=transfer.confirmed_leg,
            note=transfer.note or "",
            created_at=transfer.created_at,
            created_by=transfer.created_by,
            from_account_name=transfer.from_account.account_name if transfer.from_account else None,
            to_account_name=transfer.to_account.account_name if transfer.to_account else None,
            outflow_transaction_id=out_tx_id,
            inflow_transaction_id=in_tx_id,
        )

    def list_transfers(
        self,
        account_id: Optional[int] = None,
        transfer_type: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        exchange_reference: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[AccountTransferResponse]:
        transfers = self.repo.list_transfers(
            account_id=account_id,
            transfer_type=transfer_type,
            date_from=date_from,
            date_to=date_to,
            exchange_reference=exchange_reference,
            limit=limit,
            offset=offset,
        )
        return [self.to_response(t) for t in transfers]

    def get_transfer(self, transfer_id: int) -> AccountTransferResponse:
        transfer = self.repo.get_by_id(transfer_id)
        if not transfer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Transfer with ID {transfer_id} not found",
            )
        return self.to_response(transfer)

    def create_transfer(
        self,
        payload: AccountTransferCreate,
        created_by: Optional[str] = None,
    ) -> AccountTransferResponse:
        # Validate transfer type
        valid_types = {"same_bank_fx", "internal", "external_linked"}
        if payload.transfer_type not in valid_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid transfer_type '{payload.transfer_type}'. Must be one of: {', '.join(valid_types)}",
            )

        if payload.from_amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="from_amount must be strictly greater than 0",
            )

        from_acc: Optional[FinanceBankAccountDB] = None
        to_acc: Optional[FinanceBankAccountDB] = None

        if payload.from_account_id:
            from_acc = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == payload.from_account_id).first()
            if not from_acc:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Source bank account with ID {payload.from_account_id} not found",
                )
            if not from_acc.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Source bank account '{from_acc.account_name}' is inactive",
                )

        if payload.to_account_id:
            to_acc = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == payload.to_account_id).first()
            if not to_acc:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Target bank account with ID {payload.to_account_id} not found",
                )
            if not to_acc.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Target bank account '{to_acc.account_name}' is inactive",
                )

        if payload.from_account_id and payload.to_account_id and payload.from_account_id == payload.to_account_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Source and target bank accounts cannot be the same",
            )

        data = payload.dict()

        # Type-specific rules
        if payload.transfer_type in ("same_bank_fx", "internal"):
            if not payload.from_account_id or not payload.to_account_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Both from_account_id and to_account_id are required for {payload.transfer_type} transfers",
                )

            # Auto-infer currencies from accounts if not explicitly set
            if from_acc:
                data["from_currency"] = from_acc.currency
            if to_acc:
                data["to_currency"] = to_acc.currency

            if payload.transfer_type == "internal":
                if data["from_currency"] != data["to_currency"]:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Internal transfer requires identical currencies ({data['from_currency']} != {data['to_currency']}). Use 'same_bank_fx' for cross-currency transfers.",
                    )
                data["to_amount"] = payload.from_amount
                data["fx_rate"] = None

            elif payload.transfer_type == "same_bank_fx":
                # FX Transfer: requires fx_rate or to_amount
                if payload.fx_rate and payload.fx_rate > 0:
                    if not payload.to_amount or payload.to_amount <= 0:
                        data["to_amount"] = round(payload.from_amount * payload.fx_rate, 2)
                elif payload.to_amount and payload.to_amount > 0:
                    data["fx_rate"] = round(payload.to_amount / payload.from_amount, 6)
                else:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="FX transfer requires either fx_rate or to_amount",
                    )

        elif payload.transfer_type == "external_linked":
            if not payload.from_account_id and not payload.to_account_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="External-linked transfer requires at least one owned bank account (from_account_id or to_account_id)",
                )
            if payload.confirmed_leg == "from_only" and not payload.from_account_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="from_account_id is required when confirmed_leg is 'from_only'",
                )
            if payload.confirmed_leg == "to_only" and not payload.to_account_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="to_account_id is required when confirmed_leg is 'to_only'",
                )

            if from_acc and not payload.from_currency:
                data["from_currency"] = from_acc.currency
            if to_acc and not payload.to_currency:
                data["to_currency"] = to_acc.currency

            if not data.get("to_amount"):
                if data.get("fx_rate") and data["fx_rate"] > 0:
                    data["to_amount"] = round(payload.from_amount * data["fx_rate"], 2)
                else:
                    data["to_amount"] = payload.from_amount

        created_transfer = self.repo.create_transfer(data, created_by=created_by)
        return self.to_response(created_transfer)
