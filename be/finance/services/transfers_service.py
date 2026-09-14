"""
be/finance/services/transfers_service.py
Business logic, validations, and mapping for Account Transfers (Phase 3).
"""
from typing import List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from finance.models import AccountTransferDB, FinanceBankAccountDB
from finance.repositories.transfers_repository import TransfersRepository
from finance.schemas import (
    AccountTransferCreate,
    AccountTransferResponse,
    TransferMatchRequest,
    TransferPreviewRequest,
    TransferPreviewResponse,
)


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
            settlement_status=transfer.settlement_status or ("settled" if transfer.confirmed_leg == "both" else ("in_transit" if transfer.confirmed_leg == "from_only" else "awaiting_match")),
            fee=transfer.fee or 0.0,
            expected_date=transfer.expected_date,
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

    def match_transfer(
        self,
        transfer_id: int,
        payload: TransferMatchRequest,
        created_by: Optional[str] = None,
    ) -> AccountTransferResponse:
        transfer = self.repo.get_by_id(transfer_id)
        if not transfer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Transfer with ID {transfer_id} not found",
            )
        if transfer.confirmed_leg == "both" or transfer.settlement_status == "settled":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transfer is already fully settled",
            )
        to_acc = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == payload.target_account_id).first()
        if not to_acc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Destination account with ID {payload.target_account_id} not found",
            )
        if not to_acc.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Destination account '{to_acc.account_name}' is inactive",
            )
        if transfer.from_account_id and transfer.from_account_id == payload.target_account_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Destination account cannot be the same as the source account",
            )

        matched = self.repo.match_in_transit_transfer(
            transfer=transfer,
            target_account_id=payload.target_account_id,
            received_amount=payload.received_amount,
            settled_date=payload.settled_date,
            note=payload.note,
            created_by=created_by,
        )
        return self.to_response(matched)

    def preview_transfer(self, payload: TransferPreviewRequest) -> TransferPreviewResponse:
        from_acc = None
        to_acc = None
        if payload.from_account_id:
            from_acc = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == payload.from_account_id).first()
        if payload.to_account_id:
            to_acc = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == payload.to_account_id).first()

        from_name = from_acc.account_name if from_acc else "External Account"
        to_name = to_acc.account_name if to_acc else "External Account"
        from_curr = from_acc.currency if from_acc else "USD"
        to_curr = to_acc.currency if to_acc else (payload.to_amount and "USD" or from_curr)
        from_cur_bal = from_acc.current_balance if from_acc else 0.0
        to_cur_bal = to_acc.current_balance if to_acc else (0.0 if to_acc else None)

        is_valid = True
        validation_err = None

        if payload.from_account_id and payload.to_account_id and payload.from_account_id == payload.to_account_id:
            is_valid = False
            validation_err = "Source and target bank accounts cannot be the same"

        from_amt = payload.from_amount
        to_amt = payload.to_amount
        fx_rate = payload.fx_rate
        fee = payload.fee or 0.0

        if payload.transfer_type == "internal":
            to_amt = from_amt
            fx_rate = 1.0
            explicit_fx = f"1 {from_curr} = 1.00 {from_curr}"
            implied_rate = 1.0
            if from_acc and to_acc and from_acc.currency != to_acc.currency:
                is_valid = False
                validation_err = f"Internal transfer requires same currency ({from_acc.currency} != {to_acc.currency}). Use same_bank_fx."
        elif payload.transfer_type == "same_bank_fx":
            if fx_rate and fx_rate > 0:
                if not to_amt or to_amt <= 0:
                    to_amt = round(from_amt * fx_rate, 2)
            elif to_amt and to_amt > 0:
                fx_rate = round(to_amt / from_amt, 6) if from_amt > 0 else None
            else:
                is_valid = False
                validation_err = "FX transfer requires exchange rate or destination amount"

            implied_rate = round(to_amt / from_amt, 4) if (to_amt and from_amt > 0) else fx_rate
            explicit_fx = f"1 {from_curr} = {fx_rate:.4f} {to_curr}" if fx_rate else None
        else:  # external_linked
            if not to_amt:
                if fx_rate and fx_rate > 0:
                    to_amt = round(from_amt * fx_rate, 2)
                else:
                    to_amt = from_amt
            implied_rate = round(to_amt / from_amt, 4) if (to_amt and from_amt > 0) else 1.0
            explicit_fx = f"1 {from_curr} = {implied_rate:.4f} {to_curr}" if from_curr != to_curr else None

        from_proj = round(from_cur_bal - from_amt - fee, 2)
        to_proj = round(to_cur_bal + (to_amt or 0), 2) if to_cur_bal is not None else None

        settlement_status = "settled"
        if payload.confirmed_leg == "from_only":
            settlement_status = "in_transit"
        elif payload.confirmed_leg == "to_only":
            settlement_status = "awaiting_match"

        journal_lines = []
        if payload.confirmed_leg in ("both", "from_only"):
            journal_lines.append({
                "account": f"{from_name} (Asset)",
                "debit": None,
                "credit": from_amt,
                "currency": from_curr,
            })
            if fee > 0:
                journal_lines.append({
                    "account": f"Transfer Fees / {from_name}",
                    "debit": fee,
                    "credit": None,
                    "currency": from_curr,
                })
        if payload.confirmed_leg in ("both", "to_only") and to_acc:
            journal_lines.append({
                "account": f"{to_name} (Asset)",
                "debit": to_amt,
                "credit": None,
                "currency": to_curr,
            })

        plain_desc = (
            f"Transfer {from_amt:,.2f} {from_curr} from {from_name} to {to_name}"
            + (f" ({to_amt:,.2f} {to_curr} at {fx_rate:.4f})" if from_curr != to_curr and fx_rate else "")
            + (f" with {fee:,.2f} {from_curr} fee" if fee > 0 else "")
            + f". Projected source balance: {from_proj:,.2f} {from_curr}."
        )

        return TransferPreviewResponse(
            from_account_name=from_name,
            from_currency=from_curr,
            from_current_balance=from_cur_bal,
            from_projected_balance=from_proj,
            to_account_name=to_name,
            to_currency=to_curr,
            to_current_balance=to_cur_bal,
            to_projected_balance=to_proj,
            explicit_fx_direction=explicit_fx,
            implied_rate=implied_rate,
            settlement_status=settlement_status,
            is_valid=is_valid,
            validation_error=validation_err,
            plain_description=plain_desc,
            journal_preview=journal_lines,
        )
