"""
be/finance/repositories/accounts_repository.py
SQLAlchemy-backed repository for company bank accounts.
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from finance.models import FinanceBankAccountDB, LedgerTransactionDB


class AccountsRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_all(
        self,
        is_active: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[FinanceBankAccountDB]:
        query = self.db.query(FinanceBankAccountDB)
        if is_active is not None:
            query = query.filter(FinanceBankAccountDB.is_active == is_active)
        return query.order_by(FinanceBankAccountDB.id.asc()).offset(offset).limit(limit).all()

    def get_by_id(self, account_id: int) -> Optional[FinanceBankAccountDB]:
        return self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == account_id).first()

    def get_by_name(self, account_name: str) -> Optional[FinanceBankAccountDB]:
        return self.db.query(FinanceBankAccountDB).filter(
            FinanceBankAccountDB.account_name.ilike(account_name.strip())
        ).first()

    def create(self, data: dict) -> FinanceBankAccountDB:
        account = FinanceBankAccountDB(
            account_name=data["account_name"].strip(),
            bank_name=data["bank_name"].strip() if data.get("bank_name") else None,
            account_number=data["account_number"].strip(),
            currency=data.get("currency", "USD").upper(),
            opening_balance=float(data.get("opening_balance", 0.0)),
            current_balance=float(data.get("opening_balance", 0.0)),
            account_type=data.get("account_type", "bank"),
            country=data.get("country", "Egypt"),
            is_active=bool(data.get("is_active", True)),
        )
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)
        return account

    def update(self, account_id: int, data: dict) -> Optional[FinanceBankAccountDB]:
        account = self.get_by_id(account_id)
        if not account:
            return None

        if "account_name" in data and data["account_name"] is not None:
            account.account_name = data["account_name"].strip()
        if "bank_name" in data and data["bank_name"] is not None:
            account.bank_name = data["bank_name"].strip()
        if "account_number" in data and data["account_number"] is not None:
            account.account_number = data["account_number"].strip()
        if "currency" in data and data["currency"] is not None:
            account.currency = data["currency"].upper()
        if "account_type" in data and data["account_type"] is not None:
            account.account_type = data["account_type"]
        if "country" in data and data["country"] is not None:
            account.country = data["country"]
        if "is_active" in data and data["is_active"] is not None:
            account.is_active = bool(data["is_active"])

        self.db.commit()
        self.db.refresh(account)
        return account

    def soft_delete(self, account_id: int) -> Optional[FinanceBankAccountDB]:
        return self.update(account_id, {"is_active": False})

    def compute_balance(self, account_id: int, as_of_date: Optional[str] = None) -> float:
        """
        Calculates balance as opening_balance + signed sum of transactions up to as_of_date.
        Transactions with direction == 'in' are added; direction == 'out' are subtracted.
        """
        account = self.get_by_id(account_id)
        if not account:
            raise ValueError(f"Account {account_id} not found")

        query = self.db.query(LedgerTransactionDB).filter(LedgerTransactionDB.account_id == account_id)
        if as_of_date:
            query = query.filter(LedgerTransactionDB.date <= as_of_date)

        txs = query.all()
        signed_sum = sum(tx.amount if tx.direction == "in" else -tx.amount for tx in txs)
        return round(account.opening_balance + signed_sum, 4)

    def recalculate_and_sync_current_balance(self, account_id: int) -> float:
        """
        Recomputes balance from all ledger transactions and updates cached current_balance.
        """
        account = self.get_by_id(account_id)
        if not account:
            raise ValueError(f"Account {account_id} not found")

        balance = self.compute_balance(account_id)
        account.current_balance = balance
        self.db.commit()
        self.db.refresh(account)
        return balance
