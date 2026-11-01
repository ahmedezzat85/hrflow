"""
be/finance/repositories/accounts_repository.py
SQLAlchemy-backed repository for company bank accounts.
"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, case

from finance import year_openings
from finance.models import (
    FinanceAccountYearOpeningDB,
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
        book: Optional[str] = None,
    ) -> List[FinanceBankAccountDB]:
        query = self.db.query(FinanceBankAccountDB)
        if is_active is not None:
            query = query.filter(FinanceBankAccountDB.is_active == is_active)
        if book:
            from finance import books
            query = books.resolve(self.db, book).filter(query, FinanceBankAccountDB.id)
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
        from finance import books
        account = FinanceBankAccountDB(
            book_id=data.get("book_id") or books.default_book_id(self.db),
            visibility=data.get("visibility") or "full",
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
            self.db.flush()
            self._recalculate(account_id)
        if "is_active" in data and data["is_active"] is not None:
            account.is_active = bool(data["is_active"])
        if data.get("book_id"):
            account.book_id = data["book_id"]
        if data.get("visibility"):
            account.visibility = data["visibility"]

        self.db.commit()
        self.db.refresh(account)
        return account

    def soft_delete(self, account_id: int) -> Optional[FinanceBankAccountDB]:
        return self.update(account_id, {"is_active": False})

    def compute_balance(self, account_id: int, as_of_date: Optional[str] = None) -> float:
        """
        Balance on as_of_date (or the current balance when omitted) from the base of the fiscal year
        (BI-1, D-043): the latest entered yearly opening, else the account's opening_balance, plus the
        signed sum of transactions from the base start. Direction 'in' adds; 'out' subtracts.
        """
        account = self.get_by_id(account_id)
        if not account:
            raise ValueError(f"Account {account_id} not found")

        if as_of_date:
            return year_openings.balance_as_of(self.db, account, as_of_date)
        return year_openings.current_balance(self.db, account)

    def recalculate_and_sync_current_balance(self, account_id: int) -> float:
        """
        Recomputes balance from all ledger transactions and updates cached current_balance.
        """
        account = self.get_by_id(account_id)
        if not account:
            raise ValueError(f"Account {account_id} not found")

        balance = self._recalculate(account_id, commit=True)
        self.db.refresh(account)
        return balance

    def _recalculate(self, account_id: int, commit: bool = False) -> float:
        """Rewrite both stored balance copies through their single writer."""
        from finance.repositories.ledger_repository import LedgerRepository
        return LedgerRepository(self.db).recalculate_account_running_balances(account_id, commit=commit)

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

    # ------------------------------------------------------------------
    # Fiscal-year opening balances (BI-1, D-043)
    # ------------------------------------------------------------------
    def list_year_openings(self, account_id: int) -> List[FinanceAccountYearOpeningDB]:
        return (
            self.db.query(FinanceAccountYearOpeningDB)
            .filter(FinanceAccountYearOpeningDB.account_id == account_id)
            .order_by(FinanceAccountYearOpeningDB.fiscal_year.asc())
            .all()
        )

    def get_year_opening(self, account_id: int, fiscal_year: int) -> Optional[FinanceAccountYearOpeningDB]:
        return (
            self.db.query(FinanceAccountYearOpeningDB)
            .filter(FinanceAccountYearOpeningDB.account_id == account_id, FinanceAccountYearOpeningDB.fiscal_year == fiscal_year)
            .first()
        )

    def upsert_year_opening(self, account_id: int, fiscal_year: int, opening_balance: float, note: str, user: Optional[str]) -> FinanceAccountYearOpeningDB:
        """Creates or updates the row; the caller recalculates balances and commits (one transaction)."""
        row = self.get_year_opening(account_id, fiscal_year)
        now = datetime.utcnow()
        if row is None:
            row = FinanceAccountYearOpeningDB(
                account_id=account_id, fiscal_year=fiscal_year, created_by=user, created_at=now,
            )
            self.db.add(row)
        row.opening_balance = float(opening_balance)
        row.note = note
        row.updated_by = user
        row.updated_at = now
        self.db.flush()
        return row

    def delete_year_opening(self, row: FinanceAccountYearOpeningDB) -> None:
        self.db.delete(row)
        self.db.flush()

    def count_transactions_before(self, account_id: int, date_exclusive: str) -> int:
        return (
            self.db.query(func.count(LedgerTransactionDB.id))
            .filter(LedgerTransactionDB.account_id == account_id, LedgerTransactionDB.date < date_exclusive)
            .scalar()
            or 0
        )

    def activity_year_range(self, account_id: int) -> Optional[tuple]:
        lo, hi = (
            self.db.query(func.min(LedgerTransactionDB.date), func.max(LedgerTransactionDB.date))
            .filter(LedgerTransactionDB.account_id == account_id)
            .one()
        )
        return (int(lo[:4]), int(hi[:4])) if lo else None

    def closed_reconciliation_months_by_year(self, account_id: int) -> Dict[int, int]:
        rows = (
            self.db.query(BankStatementImportDB.period_month)
            .filter(BankStatementImportDB.account_id == account_id, BankStatementImportDB.status == "closed")
            .all()
        )
        counts: Dict[int, int] = {}
        for (period,) in rows:
            if period:
                counts[int(period[:4])] = counts.get(int(period[:4]), 0) + 1
        return counts

    # ------------------------------------------------------------------
    # Balance checkpoints (D-028)
    # ------------------------------------------------------------------
    def list_checkpoints(self, account_id: int) -> List["AccountBalanceCheckpointDB"]:
        from finance.models import AccountBalanceCheckpointDB
        return (
            self.db.query(AccountBalanceCheckpointDB)
            .filter(AccountBalanceCheckpointDB.account_id == account_id)
            .order_by(AccountBalanceCheckpointDB.date.desc(), AccountBalanceCheckpointDB.id.desc())
            .all()
        )

    def get_checkpoint(self, account_id: int, checkpoint_id: int):
        from finance.models import AccountBalanceCheckpointDB
        return (
            self.db.query(AccountBalanceCheckpointDB)
            .filter(AccountBalanceCheckpointDB.id == checkpoint_id, AccountBalanceCheckpointDB.account_id == account_id)
            .first()
        )

    def create_checkpoint(self, account_id: int, data: dict, created_by: Optional[str] = None):
        from finance.models import AccountBalanceCheckpointDB
        cp = AccountBalanceCheckpointDB(
            account_id=account_id,
            date=data["date"],
            balance=float(data["balance"]),
            note=(data.get("note") or "").strip() or None,
            created_by=created_by,
        )
        self.db.add(cp)
        self.db.commit()
        self.db.refresh(cp)
        return cp

    def checkpoint_attachment(self, checkpoint_id: int):
        from finance.models import FinanceAttachmentDB
        return (
            self.db.query(FinanceAttachmentDB)
            .filter(FinanceAttachmentDB.checkpoint_id == checkpoint_id)
            .order_by(FinanceAttachmentDB.id.desc())
            .first()
        )

    def add_checkpoint_attachment(self, checkpoint_id: int, file_name: str, file_size: int, mime_type: str, storage_ref: str, uploaded_by: Optional[str] = None):
        from finance.models import FinanceAttachmentDB
        att = FinanceAttachmentDB(
            checkpoint_id=checkpoint_id,
            file_name=file_name,
            file_size=file_size,
            mime_type=mime_type,
            storage_ref=storage_ref,
            uploaded_at=datetime.utcnow(),
            uploaded_by=uploaded_by,
        )
        self.db.add(att)
        self.db.commit()
        self.db.refresh(att)
        return att
