"""
be/finance/repositories/ledger_repository.py
SQLAlchemy-backed repository for the transaction ledger.
Single source of truth for account transactions and running balances.
"""
from typing import List, Optional
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc, asc

from finance.models import LedgerTransactionDB, FinanceBankAccountDB


class LedgerRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_by_account(
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
    ) -> List[LedgerTransactionDB]:
        query = (
            self.db.query(LedgerTransactionDB)
            .options(joinedload(LedgerTransactionDB.category), joinedload(LedgerTransactionDB.payment_type))
            .filter(LedgerTransactionDB.account_id == account_id)
        )
        if date_from:
            query = query.filter(LedgerTransactionDB.date >= date_from)
        if date_to:
            query = query.filter(LedgerTransactionDB.date <= date_to)
        if category_id is not None:
            query = query.filter(LedgerTransactionDB.category_id == category_id)
        if payment_type_id is not None:
            query = query.filter(LedgerTransactionDB.payment_type_id == payment_type_id)
        if direction:
            query = query.filter(LedgerTransactionDB.direction == direction)
        if is_petty is not None:
            from finance.models import TransactionCategoryDB
            query = query.join(TransactionCategoryDB, isouter=True).filter(TransactionCategoryDB.is_petty == is_petty)

        return (
            query.order_by(LedgerTransactionDB.date.desc(), LedgerTransactionDB.id.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

    def get_by_id(self, tx_id: int) -> Optional[LedgerTransactionDB]:
        return (
            self.db.query(LedgerTransactionDB)
            .options(joinedload(LedgerTransactionDB.category), joinedload(LedgerTransactionDB.payment_type))
            .filter(LedgerTransactionDB.id == tx_id)
            .first()
        )

    def create_transaction(
        self,
        account_id: int,
        data: dict,
        created_by: Optional[str] = None,
    ) -> LedgerTransactionDB:
        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == account_id)
            .first()
        )
        if not bank_account:
            raise ValueError(f"Account with ID {account_id} not found")

        amount = float(data["amount"])
        direction = data["direction"]
        if direction not in ("in", "out"):
            raise ValueError("Transaction direction must be 'in' or 'out'")

        if direction == "in":
            bank_account.current_balance = round(bank_account.current_balance + amount, 4)
        else:
            bank_account.current_balance = round(bank_account.current_balance - amount, 4)

        running_balance = bank_account.current_balance

        tx = LedgerTransactionDB(
            account_id=account_id,
            date=data["date"],
            amount=amount,
            direction=direction,
            currency=data.get("currency", bank_account.currency),
            category_id=data.get("category_id"),
            payment_type_id=data.get("payment_type_id"),
            reference=data.get("reference", "") or "",
            description=data.get("description", "") or "",
            fx_rate=float(data["fx_rate"]) if data.get("fx_rate") is not None else None,
            source=data.get("source", "manual"),
            linked_invoice_id=data.get("linked_invoice_id"),
            linked_bill_id=data.get("linked_bill_id"),
            running_balance=running_balance,
            created_by=created_by or data.get("created_by"),
        )
        self.db.add(tx)
        self.db.commit()
        return self.get_by_id(tx.id)
