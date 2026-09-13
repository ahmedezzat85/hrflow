"""
be/finance/repositories/cheques_repository.py
SQLAlchemy-backed repository for Cheques and Cheque Register lifecycle.
Handles unique cheque numbers per account, dual-leg cash funding,
vendor bill linking, and status changes with ledger reversal.
"""
from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, desc

from finance.models import (
    FinanceChequeDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    PaymentTypeDB,
    TransactionCategoryDB,
    BillDB,
)
from finance.repositories.ledger_repository import LedgerRepository


class ChequesRepository:
    def __init__(self, db: Session):
        self.db = db
        self.ledger_repo = LedgerRepository(db)

    def get_by_id(self, cheque_id: int) -> Optional[FinanceChequeDB]:
        return (
            self.db.query(FinanceChequeDB)
            .options(
                joinedload(FinanceChequeDB.account),
                joinedload(FinanceChequeDB.destination_cash_account),
                joinedload(FinanceChequeDB.linked_bill),
                joinedload(FinanceChequeDB.linked_transaction),
                joinedload(FinanceChequeDB.linked_cash_transaction),
            )
            .filter(FinanceChequeDB.id == cheque_id)
            .first()
        )

    def get_by_account_and_number(self, account_id: int, cheque_number: str) -> Optional[FinanceChequeDB]:
        return (
            self.db.query(FinanceChequeDB)
            .filter(
                FinanceChequeDB.account_id == account_id,
                FinanceChequeDB.cheque_number == cheque_number.strip(),
            )
            .first()
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
    ) -> List[FinanceChequeDB]:
        query = (
            self.db.query(FinanceChequeDB)
            .options(
                joinedload(FinanceChequeDB.account),
                joinedload(FinanceChequeDB.destination_cash_account),
                joinedload(FinanceChequeDB.linked_bill),
            )
        )
        if fiscal_year:
            query = query.filter(FinanceChequeDB.fiscal_year == fiscal_year)
        if status:
            query = query.filter(FinanceChequeDB.status == status)
        if account_id:
            query = query.filter(FinanceChequeDB.account_id == account_id)
        if payee:
            query = query.filter(FinanceChequeDB.payee.ilike(f"%{payee}%"))
        if search:
            s = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    FinanceChequeDB.cheque_number.ilike(s),
                    FinanceChequeDB.payee.ilike(s),
                    FinanceChequeDB.notes.ilike(s),
                )
            )

        return (
            query.order_by(desc(FinanceChequeDB.issue_date), desc(FinanceChequeDB.id))
            .offset(offset)
            .limit(limit)
            .all()
        )

    def create_cheque(self, data: dict, created_by: Optional[str] = None) -> FinanceChequeDB:
        account_id = data["account_id"]
        cheque_number = data["cheque_number"].strip()

        # Check unique constraint per account
        existing = self.get_by_account_and_number(account_id, cheque_number)
        if existing:
            raise ValueError(f"Cheque number '{cheque_number}' already exists for account ID {account_id}")

        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == account_id)
            .first()
        )
        if not bank_account:
            raise ValueError(f"Account ID {account_id} not found")
        if bank_account.account_type != "bank":
            raise ValueError(f"Cheques can only be issued from bank accounts, but '{bank_account.account_name}' is type '{bank_account.account_type}'")

        purpose_type = data.get("purpose_type", "other")
        destination_cash_account_id = data.get("destination_cash_account_id")
        dest_cash_account = None
        if purpose_type == "cash_withdrawal":
            if not destination_cash_account_id:
                raise ValueError("destination_cash_account_id is required for cash_withdrawal purpose")
            dest_cash_account = (
                self.db.query(FinanceBankAccountDB)
                .filter(FinanceBankAccountDB.id == destination_cash_account_id)
                .first()
            )
            if not dest_cash_account:
                raise ValueError(f"Destination cash account ID {destination_cash_account_id} not found")
            if dest_cash_account.account_type != "cash":
                raise ValueError(f"Destination account '{dest_cash_account.account_name}' is not a cash account")

        # Fiscal year defaults to issue_date year
        issue_date = data["issue_date"]
        try:
            year_from_date = int(issue_date.split("-")[0])
        except Exception:
            year_from_date = datetime.utcnow().year
        fiscal_year = int(data.get("fiscal_year") or year_from_date)

        # 1. Look up PaymentType for CHEQUE
        pt = (
            self.db.query(PaymentTypeDB)
            .filter(or_(PaymentTypeDB.code == "CHEQUE", PaymentTypeDB.code == "CHK"))
            .first()
        )
        payment_type_id = pt.id if pt else None

        # 2. Look up Category
        cat = None
        if purpose_type == "vendor_payment":
            cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name.ilike("%Operating Expense%")).first()
        elif purpose_type == "cash_withdrawal":
            cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.kind == "transfer").first()
        category_id = cat.id if cat else None

        amount = float(data["amount"])
        currency = data.get("currency", bank_account.currency)

        # 3. Create Cheque DB object
        cheque = FinanceChequeDB(
            cheque_number=cheque_number,
            account_id=account_id,
            issue_date=issue_date,
            amount=amount,
            currency=currency,
            payee=data["payee"].strip(),
            purpose_type=purpose_type,
            destination_cash_account_id=destination_cash_account_id,
            linked_bill_id=data.get("linked_bill_id"),
            status="issued",
            clear_date=None,
            fiscal_year=fiscal_year,
            notes=data.get("notes", "") or "",
            created_by=created_by,
        )
        self.db.add(cheque)
        self.db.flush()

        # 4. Post Bank Outflow Ledger Leg
        outflow_tx = LedgerTransactionDB(
            account_id=account_id,
            date=issue_date,
            amount=amount,
            direction="out",
            currency=currency,
            category_id=category_id,
            payment_type_id=payment_type_id,
            reference=f"CHK-{cheque_number}",
            description=f"Cheque #{cheque_number} to {cheque.payee}",
            cheque_number=cheque_number,
            source="cheque",
            linked_bill_id=cheque.linked_bill_id,
            linked_cheque_id=cheque.id,
            destination_cash_account_id=destination_cash_account_id,
            running_balance=0.0,
            created_by=created_by,
        )
        self.db.add(outflow_tx)
        self.db.flush()
        cheque.linked_transaction_id = outflow_tx.id

        # 5. If cash_withdrawal, post Cash Inflow Leg
        if purpose_type == "cash_withdrawal" and dest_cash_account:
            inflow_tx = LedgerTransactionDB(
                account_id=destination_cash_account_id,
                date=issue_date,
                amount=amount,
                direction="in",
                currency=dest_cash_account.currency,
                category_id=category_id,
                payment_type_id=payment_type_id,
                reference=f"CHK-{cheque_number}",
                description=f"Cash withdrawal funding via Cheque #{cheque_number} from {bank_account.account_name}",
                cheque_number=cheque_number,
                source="cheque",
                linked_cheque_id=cheque.id,
                running_balance=0.0,
                created_by=created_by,
            )
            self.db.add(inflow_tx)
            self.db.flush()
            cheque.linked_cash_transaction_id = inflow_tx.id

        # 6. If linked to bill, mark bill as paid
        if cheque.linked_bill_id:
            bill = self.db.query(BillDB).filter(BillDB.id == cheque.linked_bill_id).first()
            if bill:
                bill.status = "paid"

        self.db.commit()

        # 7. Recalculate balances
        self.ledger_repo.recalculate_account_running_balances(account_id)
        if destination_cash_account_id:
            self.ledger_repo.recalculate_account_running_balances(destination_cash_account_id)

        return self.get_by_id(cheque.id)

    def update_status(
        self,
        cheque_id: int,
        status: str,
        clear_date: Optional[str] = None,
    ) -> FinanceChequeDB:
        cheque = self.get_by_id(cheque_id)
        if not cheque:
            raise ValueError(f"Cheque ID {cheque_id} not found")

        old_status = cheque.status
        if old_status == status:
            return cheque

        cheque.status = status

        if status == "cleared":
            cheque.clear_date = clear_date or datetime.utcnow().strftime("%Y-%m-%d")
        elif status in ("bounced", "voided"):
            # Reverse / remove the ledger transactions posted for this cheque
            txs = (
                self.db.query(LedgerTransactionDB)
                .filter(LedgerTransactionDB.linked_cheque_id == cheque.id)
                .all()
            )
            for tx in txs:
                self.db.delete(tx)

            cheque.linked_transaction_id = None
            cheque.linked_cash_transaction_id = None

            # If linked to a bill, check if bill should revert to unpaid
            if cheque.linked_bill_id:
                bill = self.db.query(BillDB).filter(BillDB.id == cheque.linked_bill_id).first()
                if bill:
                    # check if any other active payment exists
                    other_payments = [p for p in (bill.payments or [])]
                    other_cheques = (
                        self.db.query(FinanceChequeDB)
                        .filter(
                            FinanceChequeDB.linked_bill_id == bill.id,
                            FinanceChequeDB.id != cheque.id,
                            FinanceChequeDB.status.in_(["issued", "cleared"]),
                        )
                        .count()
                    )
                    if not other_payments and not other_cheques:
                        bill.status = "unpaid"

        self.db.commit()

        # Recalculate balances on accounts
        self.ledger_repo.recalculate_account_running_balances(cheque.account_id)
        if cheque.destination_cash_account_id:
            self.ledger_repo.recalculate_account_running_balances(cheque.destination_cash_account_id)

        return self.get_by_id(cheque.id)
