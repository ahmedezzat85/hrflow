"""
be/finance/repositories/transfers_repository.py
SQLAlchemy-backed repository for account transfers.
Handles atomic dual-leg ledger transactions and balance recalculations.
"""
from typing import List, Optional, Tuple
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_

from finance.models import (
    AccountTransferDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    PaymentTypeDB,
    TransactionCategoryDB,
)
from finance.repositories.ledger_repository import LedgerRepository


class TransfersRepository:
    def __init__(self, db: Session):
        self.db = db
        self.ledger_repo = LedgerRepository(db)

    def list_transfers(
        self,
        account_id: Optional[int] = None,
        transfer_type: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        exchange_reference: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[AccountTransferDB]:
        query = (
            self.db.query(AccountTransferDB)
            .options(
                joinedload(AccountTransferDB.from_account),
                joinedload(AccountTransferDB.to_account),
                joinedload(AccountTransferDB.ledger_transactions),
            )
        )
        if account_id is not None:
            query = query.filter(
                or_(
                    AccountTransferDB.from_account_id == account_id,
                    AccountTransferDB.to_account_id == account_id,
                )
            )
        if transfer_type:
            query = query.filter(AccountTransferDB.transfer_type == transfer_type)
        if date_from:
            query = query.filter(AccountTransferDB.date >= date_from)
        if date_to:
            query = query.filter(AccountTransferDB.date <= date_to)
        if exchange_reference:
            query = query.filter(AccountTransferDB.exchange_reference.ilike(f"%{exchange_reference}%"))

        return (
            query.order_by(AccountTransferDB.date.desc(), AccountTransferDB.id.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

    def get_by_id(self, transfer_id: int) -> Optional[AccountTransferDB]:
        return (
            self.db.query(AccountTransferDB)
            .options(
                joinedload(AccountTransferDB.from_account),
                joinedload(AccountTransferDB.to_account),
                joinedload(AccountTransferDB.ledger_transactions),
            )
            .filter(AccountTransferDB.id == transfer_id)
            .first()
        )

    def create_transfer(
        self,
        transfer_data: dict,
        created_by: Optional[str] = None,
    ) -> AccountTransferDB:
        """
        Creates an AccountTransferDB record and atomically generates the corresponding
        ledger transaction legs based on transfer_type and confirmed_leg.
        Recalculates running balances for all affected accounts.
        """
        transfer = AccountTransferDB(
            from_account_id=transfer_data.get("from_account_id"),
            to_account_id=transfer_data.get("to_account_id"),
            date=transfer_data["date"],
            from_amount=float(transfer_data["from_amount"]),
            from_currency=transfer_data.get("from_currency", "USD"),
            to_amount=float(transfer_data.get("to_amount") or transfer_data["from_amount"]),
            to_currency=transfer_data.get("to_currency") or transfer_data.get("from_currency", "USD"),
            fx_rate=float(transfer_data["fx_rate"]) if transfer_data.get("fx_rate") else None,
            transfer_type=transfer_data.get("transfer_type", "internal"),
            exchange_reference=transfer_data.get("exchange_reference"),
            confirmed_leg=transfer_data.get("confirmed_leg", "both"),
            note=transfer_data.get("note", ""),
            created_by=created_by,
        )
        self.db.add(transfer)
        self.db.flush()  # assign transfer.id

        # Resolve accounts for naming/references
        from_acc = (
            self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == transfer.from_account_id).first()
            if transfer.from_account_id
            else None
        )
        to_acc = (
            self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == transfer.to_account_id).first()
            if transfer.to_account_id
            else None
        )

        from_name = from_acc.account_name if from_acc else "External Account"
        to_name = to_acc.account_name if to_acc else "External Account"

        # Resolve matching payment types if present
        pt_internal = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == "INTTRANS").first()
        pt_usdtoegp = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == "USDTOEGP").first()
        pt_outbound = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == "OUTBOUND_TRANS").first()
        pt_inbound = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == "INBOUND_TRANS").first()

        # Resolve transfer category if present
        transfer_cat = (
            self.db.query(TransactionCategoryDB)
            .filter(or_(TransactionCategoryDB.kind == "transfer", TransactionCategoryDB.name == "Transfer"))
            .first()
        )
        category_id = transfer_cat.id if transfer_cat else None

        affected_account_ids = set()

        post_outflow = False
        post_inflow = False

        if transfer.transfer_type in ("same_bank_fx", "internal"):
            post_outflow = bool(transfer.from_account_id)
            post_inflow = bool(transfer.to_account_id)
        elif transfer.transfer_type == "external_linked":
            if transfer.confirmed_leg == "from_only":
                post_outflow = bool(transfer.from_account_id)
            elif transfer.confirmed_leg == "to_only":
                post_inflow = bool(transfer.to_account_id)
            else:  # "both"
                post_outflow = bool(transfer.from_account_id)
                post_inflow = bool(transfer.to_account_id)

        # 1. Post Outflow Leg (debited from from_account)
        if post_outflow and transfer.from_account_id:
            outflow_pt_id = None
            if transfer.transfer_type == "same_bank_fx":
                outflow_pt_id = pt_usdtoegp.id if pt_usdtoegp else None
            elif transfer.transfer_type == "internal":
                outflow_pt_id = pt_internal.id if pt_internal else None
            elif transfer.transfer_type == "external_linked":
                outflow_pt_id = pt_outbound.id if pt_outbound else None

            ref = transfer.exchange_reference or f"Transfer to {to_name}"
            desc = transfer.note or f"Transfer to {to_name}"
            if transfer.fx_rate:
                desc += f" (FX: {transfer.from_amount} {transfer.from_currency} -> {transfer.to_amount} {transfer.to_currency} @ {transfer.fx_rate})"

            out_tx = LedgerTransactionDB(
                account_id=transfer.from_account_id,
                date=transfer.date,
                amount=transfer.from_amount,
                direction="out",
                currency=transfer.from_currency,
                category_id=category_id,
                payment_type_id=outflow_pt_id,
                reference=ref,
                description=desc,
                fx_rate=transfer.fx_rate,
                source="transfer",
                linked_transfer_id=transfer.id,
                created_by=created_by,
            )
            self.db.add(out_tx)
            affected_account_ids.add(transfer.from_account_id)

        # 2. Post Inflow Leg (credited to to_account)
        if post_inflow and transfer.to_account_id:
            inflow_pt_id = None
            if transfer.transfer_type == "same_bank_fx":
                inflow_pt_id = pt_usdtoegp.id if pt_usdtoegp else None
            elif transfer.transfer_type == "internal":
                inflow_pt_id = pt_internal.id if pt_internal else None
            elif transfer.transfer_type == "external_linked":
                inflow_pt_id = pt_inbound.id if pt_inbound else None

            ref = transfer.exchange_reference or f"Transfer from {from_name}"
            desc = transfer.note or f"Transfer from {from_name}"
            if transfer.fx_rate:
                desc += f" (FX: {transfer.from_amount} {transfer.from_currency} -> {transfer.to_amount} {transfer.to_currency} @ {transfer.fx_rate})"

            in_tx = LedgerTransactionDB(
                account_id=transfer.to_account_id,
                date=transfer.date,
                amount=transfer.to_amount,
                direction="in",
                currency=transfer.to_currency,
                category_id=category_id,
                payment_type_id=inflow_pt_id,
                reference=ref,
                description=desc,
                fx_rate=transfer.fx_rate,
                source="transfer",
                linked_transfer_id=transfer.id,
                created_by=created_by,
            )
            self.db.add(in_tx)
            affected_account_ids.add(transfer.to_account_id)

        self.db.flush()

        # Recalculate continuous balances for all affected accounts
        for acc_id in affected_account_ids:
            self.ledger_repo.recalculate_account_running_balances(acc_id)

        self.db.commit()
        self.db.refresh(transfer)
        return transfer
