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

    def recalculate_account_running_balances(self, account_id: int) -> float:
        """
        Single source of truth continuous balance recomputation for an account.
        Iterates chronologically (date ASC, id ASC) from opening_balance and commits.
        """
        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == account_id)
            .first()
        )
        if not bank_account:
            return 0.0

        txs = (
            self.db.query(LedgerTransactionDB)
            .filter(LedgerTransactionDB.account_id == account_id)
            .order_by(asc(LedgerTransactionDB.date), asc(LedgerTransactionDB.id))
            .all()
        )
        running = float(bank_account.opening_balance or 0.0)
        for tx in txs:
            amt = float(tx.amount)
            if tx.direction == "in":
                running += amt
            else:
                running -= amt
            tx.running_balance = round(running, 4)

        bank_account.current_balance = round(running, 4)
        self.db.commit()
        return bank_account.current_balance

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
            running_balance=0.0,
            created_by=created_by or data.get("created_by"),
        )
        self.db.add(tx)
        self.db.flush()
        self.recalculate_account_running_balances(account_id)
        return self.get_by_id(tx.id)

    def update_transaction(self, tx_id: int, data: dict) -> LedgerTransactionDB:
        tx = self.get_by_id(tx_id)
        if not tx:
            raise ValueError(f"Transaction with ID {tx_id} not found")

        for key, value in data.items():
            if hasattr(tx, key) and value is not None:
                if key == "amount":
                    value = float(value)
                elif key == "fx_rate" and value is not None:
                    value = float(value)
                setattr(tx, key, value)

        self.db.flush()
        self.recalculate_account_running_balances(tx.account_id)
        return self.get_by_id(tx.id)

    def delete_transaction(self, tx_id: int) -> int:
        tx = self.get_by_id(tx_id)
        if not tx:
            raise ValueError(f"Transaction with ID {tx_id} not found")
        account_id = tx.account_id
        self.db.delete(tx)
        self.db.flush()
        self.recalculate_account_running_balances(account_id)
        return account_id

    def get_petty_summary(
        self,
        account_id: int,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> dict:
        from finance.models import TransactionCategoryDB
        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == account_id)
            .first()
        )
        if not bank_account:
            raise ValueError(f"Account with ID {account_id} not found")

        query = (
            self.db.query(LedgerTransactionDB)
            .join(TransactionCategoryDB, LedgerTransactionDB.category_id == TransactionCategoryDB.id)
            .filter(
                LedgerTransactionDB.account_id == account_id,
                TransactionCategoryDB.is_petty == True,
            )
            .options(joinedload(LedgerTransactionDB.category), joinedload(LedgerTransactionDB.payment_type))
        )
        if date_from:
            query = query.filter(LedgerTransactionDB.date >= date_from)
        if date_to:
            query = query.filter(LedgerTransactionDB.date <= date_to)

        txs = query.order_by(desc(LedgerTransactionDB.date), desc(LedgerTransactionDB.id)).all()

        total_in = 0.0
        total_out = 0.0
        by_cat = {}

        for tx in txs:
            amt = float(tx.amount)
            cat_id = tx.category_id
            cat_name = tx.category.name if tx.category else "Uncategorized"

            if cat_id not in by_cat:
                by_cat[cat_id] = {
                    "category_id": cat_id,
                    "category_name": cat_name,
                    "count": 0,
                    "total_in": 0.0,
                    "total_out": 0.0,
                    "net_amount": 0.0,
                }

            by_cat[cat_id]["count"] += 1
            if tx.direction == "in":
                total_in += amt
                by_cat[cat_id]["total_in"] += amt
            else:
                total_out += amt
                by_cat[cat_id]["total_out"] += amt

            by_cat[cat_id]["net_amount"] = round(by_cat[cat_id]["total_in"] - by_cat[cat_id]["total_out"], 4)

        return {
            "account_id": bank_account.id,
            "account_name": bank_account.account_name,
            "currency": bank_account.currency,
            "date_from": date_from,
            "date_to": date_to,
            "total_in": round(total_in, 4),
            "total_out": round(total_out, 4),
            "net_amount": round(total_in - total_out, 4),
            "by_category": list(by_cat.values()),
            "transactions": txs,
        }
