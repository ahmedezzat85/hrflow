"""
be/finance/repositories/accounts_repository.py
SQLAlchemy-backed repository for company bank accounts.
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from finance.models import FinanceBankAccountDB


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
            bank_name=data["bank_name"].strip(),
            account_number=data["account_number"].strip(),
            currency=data.get("currency", "USD").upper(),
            opening_balance=float(data.get("opening_balance", 0.0)),
            current_balance=float(data.get("opening_balance", 0.0)),
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
        if "is_active" in data and data["is_active"] is not None:
            account.is_active = bool(data["is_active"])

        self.db.commit()
        self.db.refresh(account)
        return account

    def soft_delete(self, account_id: int) -> Optional[FinanceBankAccountDB]:
        return self.update(account_id, {"is_active": False})
