"""
be/finance/repositories/cheques_repository.py
SQLAlchemy-backed repository for Cheques and Cheque Register lifecycle.
Handles unique cheque numbers per account, dual-leg cash funding,
vendor bill linking, and status changes with ledger reversal.
"""
from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, desc, func

from finance.models import (
    FinanceChequeDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    PaymentTypeDB,
    TransactionCategoryDB,
    BillDB,
)
from finance.repositories.ledger_repository import LedgerRepository

VALID_STATUS_TRANSITIONS = {
    "draft": {"issued", "voided"},
    "issued": {"outstanding", "cleared", "bounced", "stopped", "voided", "replaced"},
    "outstanding": {"cleared", "bounced", "stopped", "voided", "replaced"},
    "cleared": {"bounced", "voided"},
    "bounced": {"replaced"},
    "stopped": {"replaced"},
    "voided": set(),
    "replaced": set(),
}

EXCEPTION_STATUSES = {"bounced", "stopped", "voided", "replaced"}


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
                joinedload(FinanceChequeDB.replacement_cheque),
                joinedload(FinanceChequeDB.replaced_cheque),
            )
            .filter(FinanceChequeDB.id == cheque_id)
            .first()
        )

    def get_by_account_and_number(self, account_id: int, cheque_number: str) -> Optional[FinanceChequeDB]:
        return (
            self.db.query(FinanceChequeDB)
            .filter(
                FinanceChequeDB.account_id == account_id,
                func.lower(FinanceChequeDB.cheque_number) == cheque_number.strip().lower(),
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
                joinedload(FinanceChequeDB.replacement_cheque),
                joinedload(FinanceChequeDB.replaced_cheque),
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

    def _post_cheque_ledger_entries(
        self,
        cheque: FinanceChequeDB,
        bank_account: FinanceBankAccountDB,
        dest_cash_account: Optional[FinanceBankAccountDB] = None,
        tx_date: Optional[str] = None,
        created_by: Optional[str] = None,
    ):
        """Creates the bank outflow leg (and cash inflow leg if cash_withdrawal) for an issued/cleared cheque."""
        # 1. Look up PaymentType for CHEQUE
        pt = (
            self.db.query(PaymentTypeDB)
            .filter(or_(PaymentTypeDB.code == "CHEQUE", PaymentTypeDB.code == "CHK"))
            .first()
        )
        payment_type_id = pt.id if pt else None

        # 2. Look up Category
        cat = None
        if cheque.purpose_type == "vendor_payment":
            cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name.ilike("%Operating Expense%")).first()
        elif cheque.purpose_type == "cash_withdrawal":
            cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.kind == "transfer").first()
        category_id = cat.id if cat else None

        posting_date = tx_date or cheque.issue_date

        # 3. Post Bank Outflow Ledger Leg
        outflow_tx = LedgerTransactionDB(
            account_id=cheque.account_id,
            date=posting_date,
            amount=cheque.amount,
            direction="out",
            currency=cheque.currency,
            category_id=category_id,
            payment_type_id=payment_type_id,
            reference=f"CHK-{cheque.cheque_number}",
            description=f"Cheque #{cheque.cheque_number} to {cheque.payee}",
            cheque_number=cheque.cheque_number,
            source="cheque",
            linked_bill_id=cheque.linked_bill_id,
            linked_cheque_id=cheque.id,
            destination_cash_account_id=cheque.destination_cash_account_id,
            running_balance=0.0,
            created_by=created_by or cheque.created_by,
        )
        self.db.add(outflow_tx)
        self.db.flush()
        cheque.linked_transaction_id = outflow_tx.id

        # 4. If cash_withdrawal, post Cash Inflow Leg
        if cheque.purpose_type == "cash_withdrawal" and dest_cash_account:
            inflow_tx = LedgerTransactionDB(
                account_id=dest_cash_account.id,
                date=posting_date,
                amount=cheque.amount,
                direction="in",
                currency=dest_cash_account.currency,
                category_id=category_id,
                payment_type_id=payment_type_id,
                reference=f"CHK-{cheque.cheque_number}",
                description=f"Cash withdrawal funding via Cheque #{cheque.cheque_number} from {bank_account.account_name}",
                cheque_number=cheque.cheque_number,
                source="cheque",
                linked_cheque_id=cheque.id,
                running_balance=0.0,
                created_by=created_by or cheque.created_by,
            )
            self.db.add(inflow_tx)
            self.db.flush()
            cheque.linked_cash_transaction_id = inflow_tx.id

        # 5. If linked to bill, mark bill as paid
        if cheque.linked_bill_id:
            bill = self.db.query(BillDB).filter(BillDB.id == cheque.linked_bill_id).first()
            if bill:
                bill.status = "paid"

    def _reverse_cheque_ledger_entries(self, cheque: FinanceChequeDB):
        """Removes or reverses posted ledger transactions and restores bill status if applicable."""
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
                other_payments = [p for p in (bill.payments or []) if not getattr(p, "is_reversed", False)]
                other_cheques = (
                    self.db.query(FinanceChequeDB)
                    .filter(
                        FinanceChequeDB.linked_bill_id == bill.id,
                        FinanceChequeDB.id != cheque.id,
                        FinanceChequeDB.status.in_(["issued", "outstanding", "cleared"]),
                    )
                    .count()
                )
                if not other_payments and not other_cheques:
                    bill.status = "unpaid"

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

        amount = float(data["amount"])
        currency = data.get("currency", bank_account.currency)
        initial_status = data.get("status", "issued") or "issued"
        if initial_status not in ("draft", "issued"):
            raise ValueError(f"New cheques can only be created with status 'draft' or 'issued', got '{initial_status}'")
        posting_policy = data.get("posting_policy", "at_issue") or "at_issue"

        # Create Cheque DB object
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
            status=initial_status,
            posting_policy=posting_policy,
            signer_name=data.get("signer_name"),
            authorized_by=data.get("authorized_by"),
            attachment_url=data.get("attachment_url"),
            replaced_cheque_id=data.get("replaced_cheque_id"),
            clear_date=None,
            fiscal_year=fiscal_year,
            notes=data.get("notes", "") or "",
            created_by=created_by,
        )
        self.db.add(cheque)
        self.db.flush()

        # Only post ledger entries if status is "issued" and posting_policy is "at_issue"
        if initial_status == "issued" and posting_policy == "at_issue":
            self._post_cheque_ledger_entries(
                cheque=cheque,
                bank_account=bank_account,
                dest_cash_account=dest_cash_account,
                tx_date=issue_date,
                created_by=created_by,
            )

        self.db.commit()

        # Recalculate balances if ledger transactions were posted
        if cheque.linked_transaction_id:
            self.ledger_repo.recalculate_account_running_balances(account_id)
            if destination_cash_account_id:
                self.ledger_repo.recalculate_account_running_balances(destination_cash_account_id)

        return self.get_by_id(cheque.id)

    def update_status(
        self,
        cheque_id: int,
        status: str,
        clear_date: Optional[str] = None,
        reason: Optional[str] = None,
        evidence: Optional[str] = None,
    ) -> FinanceChequeDB:
        cheque = self.get_by_id(cheque_id)
        if not cheque:
            raise ValueError(f"Cheque ID {cheque_id} not found")

        old_status = cheque.status
        if old_status == status:
            return cheque

        # Validate transition matrix
        allowed_next = VALID_STATUS_TRANSITIONS.get(old_status, set())
        if status not in allowed_next:
            raise ValueError(f"Invalid status transition from '{old_status}' to '{status}'")

        # Record exception reason
        effective_reason = reason or cheque.exception_reason
        if status in EXCEPTION_STATUSES and not effective_reason:
            effective_reason = f"Cheque marked as {status}"

        cheque.status = status
        if effective_reason:
            cheque.exception_reason = effective_reason
        if evidence:
            cheque.exception_evidence = evidence

        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == cheque.account_id)
            .first()
        )
        dest_cash_account = None
        if cheque.destination_cash_account_id:
            dest_cash_account = (
                self.db.query(FinanceBankAccountDB)
                .filter(FinanceBankAccountDB.id == cheque.destination_cash_account_id)
                .first()
            )

        if status == "cleared":
            cheque.clear_date = clear_date or datetime.utcnow().strftime("%Y-%m-%d")
            # If posting policy is at_clearing, post ledger transactions now upon clearance
            if cheque.posting_policy == "at_clearing" and cheque.linked_transaction_id is None:
                self._post_cheque_ledger_entries(
                    cheque=cheque,
                    bank_account=bank_account,
                    dest_cash_account=dest_cash_account,
                    tx_date=cheque.clear_date,
                )
        elif status == "issued" and old_status == "draft":
            # Draft promoted to issued: post ledger transactions if at_issue policy
            if cheque.posting_policy == "at_issue" and cheque.linked_transaction_id is None:
                self._post_cheque_ledger_entries(
                    cheque=cheque,
                    bank_account=bank_account,
                    dest_cash_account=dest_cash_account,
                    tx_date=cheque.issue_date,
                )
        elif status in EXCEPTION_STATUSES:
            # Reverse / remove any active ledger transactions posted for this cheque
            self._reverse_cheque_ledger_entries(cheque)

        self.db.commit()

        # Recalculate balances on accounts
        self.ledger_repo.recalculate_account_running_balances(cheque.account_id)
        if cheque.destination_cash_account_id:
            self.ledger_repo.recalculate_account_running_balances(cheque.destination_cash_account_id)

        return self.get_by_id(cheque.id)

    def replace_cheque(
        self,
        cheque_id: int,
        new_cheque_number: str,
        new_issue_date: str,
        reason: str,
        evidence: Optional[str] = None,
        signer_name: Optional[str] = None,
        notes: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> FinanceChequeDB:
        """Replaces an existing cheque (bounced, stopped, issued, or outstanding) with a new cheque."""
        old_cheque = self.get_by_id(cheque_id)
        if not old_cheque:
            raise ValueError(f"Cheque ID {cheque_id} not found")

        if old_cheque.status not in ("issued", "outstanding", "bounced", "stopped"):
            raise ValueError(f"Cheque in status '{old_cheque.status}' cannot be replaced")

        new_cheque_number = new_cheque_number.strip()
        existing = self.get_by_account_and_number(old_cheque.account_id, new_cheque_number)
        if existing:
            raise ValueError(f"Replacement cheque number '{new_cheque_number}' already exists on account")

        # 1. Reverse old cheque ledger entries and update status
        self._reverse_cheque_ledger_entries(old_cheque)
        old_cheque.status = "replaced"
        old_cheque.exception_reason = reason
        if evidence:
            old_cheque.exception_evidence = evidence

        # 2. Issue new replacement cheque
        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == old_cheque.account_id)
            .first()
        )
        dest_cash_account = None
        if old_cheque.destination_cash_account_id:
            dest_cash_account = (
                self.db.query(FinanceBankAccountDB)
                .filter(FinanceBankAccountDB.id == old_cheque.destination_cash_account_id)
                .first()
            )

        try:
            year_from_date = int(new_issue_date.split("-")[0])
        except Exception:
            year_from_date = datetime.utcnow().year

        combined_notes = f"Replacement for Cheque #{old_cheque.cheque_number}. {notes or ''}".strip()
        new_cheque = FinanceChequeDB(
            cheque_number=new_cheque_number,
            account_id=old_cheque.account_id,
            issue_date=new_issue_date,
            amount=old_cheque.amount,
            currency=old_cheque.currency,
            payee=old_cheque.payee,
            purpose_type=old_cheque.purpose_type,
            destination_cash_account_id=old_cheque.destination_cash_account_id,
            linked_bill_id=old_cheque.linked_bill_id,
            status="issued",
            posting_policy=old_cheque.posting_policy,
            signer_name=signer_name or old_cheque.signer_name,
            authorized_by=old_cheque.authorized_by,
            replaced_cheque_id=old_cheque.id,
            clear_date=None,
            fiscal_year=year_from_date,
            notes=combined_notes,
            created_by=created_by,
        )
        self.db.add(new_cheque)
        self.db.flush()

        old_cheque.replacement_cheque_id = new_cheque.id

        if new_cheque.posting_policy == "at_issue":
            self._post_cheque_ledger_entries(
                cheque=new_cheque,
                bank_account=bank_account,
                dest_cash_account=dest_cash_account,
                tx_date=new_issue_date,
                created_by=created_by,
            )

        self.db.commit()

        # Recalculate balances
        self.ledger_repo.recalculate_account_running_balances(old_cheque.account_id)
        if old_cheque.destination_cash_account_id:
            self.ledger_repo.recalculate_account_running_balances(old_cheque.destination_cash_account_id)

        return self.get_by_id(new_cheque.id)
