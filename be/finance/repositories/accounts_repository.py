"""
be/finance/repositories/accounts_repository.py
SQLAlchemy-backed repository for company bank accounts.
"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, case

from finance.models import (
    FinanceBankAccountDB,
    LedgerTransactionDB,
    FinanceChequeDB,
    BankStatementImportDB,
    StatementLineDB,
)


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

    def has_transactions(self, account_id: int) -> bool:
        """Returns whether any ledger transactions exist for this account."""
        return self.db.query(LedgerTransactionDB).filter(LedgerTransactionDB.account_id == account_id).count() > 0

    def create(self, data: dict) -> FinanceBankAccountDB:
        account = FinanceBankAccountDB(
            account_name=data["account_name"].strip(),
            bank_name=data["bank_name"].strip() if data.get("bank_name") else None,
            account_number=data["account_number"].strip(),
            currency=data.get("currency", "USD").upper(),
            opening_balance=float(data.get("opening_balance", 0.0)),
            opening_balance_date=data.get("opening_balance_date"),
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
        if "opening_balance_date" in data:
            account.opening_balance_date = data["opening_balance_date"]
        if "opening_balance" in data and data["opening_balance"] is not None:
            account.opening_balance = float(data["opening_balance"])
            if not self.has_transactions(account_id):
                account.current_balance = float(data["opening_balance"])
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

    def get_balance_metrics(self, account: FinanceBankAccountDB) -> Dict[str, Any]:
        """
        Computes separated Book, Available, Bank, and Reconciled balances along with
        reconciliation status and balance definitions for Story 5.1.
        """
        book_balance = float(account.current_balance or 0.0)
        available_balance = book_balance

        # Uncleared cheques (issued or outstanding)
        uncleared_sum = (
            self.db.query(func.coalesce(func.sum(FinanceChequeDB.amount), 0.0))
            .filter(FinanceChequeDB.account_id == account.id, FinanceChequeDB.status.in_(["issued", "outstanding"]))
            .scalar()
            or 0.0
        )
        bank_balance = round(book_balance + float(uncleared_sum), 2)

        # Statement imports
        latest_import = (
            self.db.query(BankStatementImportDB)
            .filter(BankStatementImportDB.account_id == account.id)
            .order_by(BankStatementImportDB.created_at.desc())
            .first()
        )
        last_import_date = (
            latest_import.created_at.strftime("%Y-%m-%d")
            if latest_import and latest_import.created_at
            else None
        )

        latest_reconciled = (
            self.db.query(BankStatementImportDB)
            .filter(BankStatementImportDB.account_id == account.id, BankStatementImportDB.status == "reconciled")
            .order_by(BankStatementImportDB.reconciled_at.desc())
            .first()
        )
        last_reconciled_date = (
            latest_reconciled.reconciled_at.strftime("%Y-%m-%d")
            if latest_reconciled and latest_reconciled.reconciled_at
            else None
        )

        unreconciled_count = (
            self.db.query(StatementLineDB)
            .join(BankStatementImportDB, StatementLineDB.import_id == BankStatementImportDB.id)
            .filter(BankStatementImportDB.account_id == account.id, StatementLineDB.status == "unmatched")
            .count()
        )

        if not latest_import:
            bank_balance = round(book_balance + float(uncleared_sum), 2)
        else:
            bank_balance = book_balance
        reconciled_balance = round(float(account.opening_balance or 0.0), 2)
        if latest_import:
            matched_sum = (
                self.db.query(
                    func.coalesce(
                        func.sum(
                            case(
                                (StatementLineDB.direction == "in", StatementLineDB.raw_amount),
                                else_=-StatementLineDB.raw_amount,
                            )
                        ),
                        0.0,
                    )
                )
                .join(BankStatementImportDB, StatementLineDB.import_id == BankStatementImportDB.id)
                .filter(
                    BankStatementImportDB.account_id == account.id,
                    StatementLineDB.status.in_(["matched", "created"]),
                )
                .scalar()
                or 0.0
            )
            reconciled_balance = round(reconciled_balance + float(matched_sum), 2)
        else:
            reconciled_balance = book_balance

        has_postings = self.has_transactions(account.id)

        return {
            "book_balance": book_balance,
            "bank_balance": bank_balance,
            "available_balance": available_balance,
            "reconciled_balance": reconciled_balance,
            "unreconciled_count": unreconciled_count,
            "last_reconciled_date": last_reconciled_date,
            "last_import_date": last_import_date,
            "has_postings": has_postings,
            "balance_definitions": {
                "book_balance": "Current posted ledger balance reflecting all recorded accounting inflows and outflows.",
                "bank_balance": "Reported bank statement balance as of the latest statement upload or sync.",
                "available_balance": "Liquid balance immediately available for disbursement (Book balance minus uncleared issued cheques).",
                "reconciled_balance": "Portion of the ledger verified and reconciled against official bank statements.",
            },
            "balance_as_of": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        }
