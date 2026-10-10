"""
be/finance/services/settlement_service.py
Unified settlement engine across Bill Payment, Invoice Payment, and Add Transaction (FUX-406).
Ensures atomic balance updates, document status transitions (paid/partially_paid),
payment history logging, and pre-submit duplicate settlement matching.
"""
from datetime import datetime, timedelta
from typing import Optional, Tuple, List, Dict, Any
from sqlalchemy.orm import Session

from finance import bill_status as bs
from finance import bill_payment_rules as rules
from finance import invoice_status as inv_status

from finance.models import (
    BillDB,
    SalesInvoiceDB,
    PaymentDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    StatutoryObligationDB,
    TransactionCategoryDB,
    PaymentTypeDB,
)


# Outgoing payment types a statutory remittance may use, per paying account kind (F4, D-022 rules)
STATUTORY_PAYMENT_TYPE_CODES_BY_ACCOUNT_TYPE = {
    "cash": frozenset({"CASH"}),
    "bank": frozenset({"OUTBOUND_TRANS", "DEBIT_CARD"}),
}
DEFAULT_STATUTORY_PAYMENT_TYPE_CODE = {"cash": "CASH", "bank": "OUTBOUND_TRANS"}


class StatutoryPaymentError(ValueError):
    """A statutory remittance refused by a rule. `code` is the machine-readable reason."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def detail(self) -> dict:
        return {"code": self.code, "message": self.message}


class SettlementService:
    def __init__(self, db: Session):
        self.db = db

    def settle_bill(
        self,
        bill_id: int,
        amount: float,
        payment_date: str,
        bank_account_id: int,
        payment_type_id: Optional[int] = None,
        reference: str = "",
        cheque_number: Optional[str] = None,
    ) -> Tuple[BillDB, PaymentDB]:
        """
        Record a settlement against a vendor bill: the single path for every route that pays a bill
        (bill dialogs, create-and-pay, linked manual transactions and linked cheques).

        Refuses with BillPaymentError (code):
          currency_mismatch      - account currency differs from the bill currency
          insufficient_balance   - account balance below the payment (no overdraft, any account)
          payment_type_not_allowed - type not allowed for the account type (cash -> Cash payment;
                                     bank -> Outgoing transfer, Cheque, Debit card)
          cheque_number_required - Cheque payments need a cheque number
        and with a plain ValueError when the payment exceeds the remaining balance.
        Creates the PaymentDB record and updates amount_paid / status; the caller owns the ledger row
        and the balance recalculation.
        """
        bill = self.db.query(BillDB).filter(BillDB.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill #{bill_id} not found")

        if bill.status not in bs.OPEN_STATUSES:
            raise ValueError(f"Cannot record payment against a bill in '{bill.status}' status")

        account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == bank_account_id).first()
        if not account:
            raise ValueError(f"Bank account {bank_account_id} not found")

        payment_amount = float(amount)
        if payment_amount <= 0:
            raise ValueError("Payment amount must be greater than 0")

        # Payment type must be allowed for this account type
        account_type = (account.account_type or "bank").lower()
        allowed_codes = rules.BILL_PAYMENT_TYPE_CODES_BY_ACCOUNT_TYPE.get(account_type, frozenset())
        if payment_type_id is None:
            default_code = rules.DEFAULT_PAYMENT_TYPE_CODE_BY_ACCOUNT_TYPE.get(account_type)
            pt = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == default_code).first() if default_code else None
        else:
            pt = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.id == payment_type_id).first()
        if pt is None:
            raise rules.BillPaymentError("payment_type_not_allowed", "Payment type not found")
        if not pt.is_active or pt.code not in allowed_codes:
            raise rules.BillPaymentError(
                "payment_type_not_allowed",
                f"Payment type '{pt.name}' cannot be used to pay a bill from a {account_type} account.",
            )
        if pt.code == rules.CHEQUE and not (cheque_number and cheque_number.strip()):
            raise rules.BillPaymentError("cheque_number_required", "A cheque number is required for a cheque payment.")

        # Same currency: no exchange rate on bills or bill payments
        if (account.currency or "").upper() != (bill.currency or "").upper():
            raise rules.BillPaymentError(
                "currency_mismatch",
                f"Account currency ({account.currency}) differs from the bill currency ({bill.currency}). Transfer funds into a {bill.currency} account first.",
            )

        # Calculate remaining balance excluding reversed payments
        existing_payments = (
            self.db.query(PaymentDB)
            .filter(PaymentDB.related_bill_id == bill.id, PaymentDB.is_reversed == False)  # noqa: E712
            .all()
        )
        paid_so_far = sum(float(p.amount) for p in existing_payments)
        remaining = round(bill.total - paid_so_far, 2)
        if payment_amount > remaining + 0.01:
            raise ValueError(
                f"Payment amount (${payment_amount:.2f}) exceeds remaining balance (${remaining:.2f})."
            )

        # No overdraft on any account
        if round(float(account.current_balance or 0.0), 4) + 0.0001 < payment_amount:
            raise rules.BillPaymentError(
                "insufficient_balance",
                f"Account '{account.account_name}' balance ({float(account.current_balance or 0.0):,.2f} {account.currency}) is below the payment ({payment_amount:,.2f}).",
            )

        payment = PaymentDB(
            direction="outgoing",
            related_bill_id=bill.id,
            related_invoice_id=None,
            amount=payment_amount,
            currency=bill.currency,
            payment_date=payment_date,
            bank_account_id=account.id,
            method=rules.METHOD_BY_PAYMENT_TYPE_CODE.get(pt.code, "other"),
            reference=reference or "",
            is_reversed=False,
        )
        self.db.add(payment)

        # Update bill status & amount_paid
        bill.amount_paid = round(paid_so_far + payment_amount, 2)
        bill.status = bs.derive_payment_status(bill, amount_paid=bill.amount_paid)

        return bill, payment

    def reverse_cheque_bill_payment(self, bill_id: int, cheque_number: str, reason: str, reversed_by: str = "system") -> Optional[PaymentDB]:
        """
        Reverse the payment a linked cheque made against a bill (cheque stopped, voided, bounced or replaced).
        Marks the payment reversed, recomputes amount_paid and derives the bill status again.
        """
        bill = self.db.query(BillDB).filter(BillDB.id == bill_id).first()
        if not bill:
            return None
        payment = (
            self.db.query(PaymentDB)
            .filter(
                PaymentDB.related_bill_id == bill.id,
                PaymentDB.reference == f"CHK-{cheque_number}",
                PaymentDB.is_reversed == False,  # noqa: E712
            )
            .first()
        )
        if payment:
            payment.is_reversed = True
            payment.reversed_at = datetime.utcnow()
            payment.reversed_by = reversed_by
            payment.reversal_reason = reason
            self.db.flush()
        remaining = [
            p for p in self.db.query(PaymentDB).filter(PaymentDB.related_bill_id == bill.id).all()
            if not p.is_reversed
        ]
        bill.amount_paid = round(sum(float(p.amount) for p in remaining), 2)
        bill.status = bs.derive_payment_status(bill, amount_paid=bill.amount_paid)
        return payment

    def settle_invoice(
        self,
        invoice_id: int,
        amount: float,
        payment_date: str,
        bank_account_id: int,
        payment_type_id: Optional[int] = None,
        reference: str = "",
        method: Optional[str] = None,
        currency: Optional[str] = None,
        withheld_amount: float = 0.0,
    ) -> Tuple[SalesInvoiceDB, PaymentDB]:
        """
        Record a receipt against a customer sales invoice: the single path for every route that
        receives money for an invoice (receipt dialog and manual transactions linked to an invoice).

        Refuses with ReceiptError (code):
          currency_mismatch        - account currency differs from the invoice currency (no exchange rate)
          payment_type_not_allowed - type not an incoming type that fits the account kind
          withheld_exceeds_expected - withheld tax above what the invoice's withholding rate expects
        InvalidInvoiceTransition when the invoice is not Sent / Partially paid, and a plain ValueError
        for a non-positive amount or an overpayment. Received plus withheld settles the invoice (D-024);
        only the received amount moves the bank balance.
        Creates the PaymentDB (in the invoice's currency) and sets the status; the caller owns the
        ledger row and the balance recalculation. `currency` is accepted for compatibility and ignored.
        """
        invoice = self.db.query(SalesInvoiceDB).filter(SalesInvoiceDB.id == invoice_id).first()
        if not invoice:
            raise ValueError(f"Invoice #{invoice_id} not found")

        inv_status.next_status("receive", invoice.status)

        account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == bank_account_id).first()
        if not account:
            raise ValueError(f"Bank account {bank_account_id} not found")

        payment_amount = float(amount)
        if payment_amount <= 0:
            raise ValueError("Payment amount must be greater than 0")

        if (account.currency or "").upper() != (invoice.currency or "").upper():
            raise inv_status.ReceiptError(
                "currency_mismatch",
                f"Account currency ({account.currency}) differs from the invoice currency ({invoice.currency}). Receive into a {invoice.currency} account.",
            )

        account_type = (account.account_type or "bank").lower()
        allowed_codes = inv_status.RECEIPT_TYPE_CODES_BY_ACCOUNT_TYPE.get(account_type, frozenset())
        if payment_type_id is None:
            default_code = inv_status.DEFAULT_RECEIPT_TYPE_CODE_BY_ACCOUNT_TYPE.get(account_type)
            pt = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == default_code).first() if default_code else None
        else:
            pt = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.id == payment_type_id).first()
        if pt is None:
            raise inv_status.ReceiptError("payment_type_not_allowed", "Payment type not found")
        if not pt.is_active or pt.code not in allowed_codes:
            raise inv_status.ReceiptError(
                "payment_type_not_allowed",
                f"Payment type '{pt.name}' cannot be used to receive money into a {account_type} account.",
            )

        withheld = round(float(withheld_amount or 0.0), 2)
        if withheld < 0:
            raise ValueError("Withheld amount cannot be negative")

        existing_payments = (
            self.db.query(PaymentDB)
            .filter(PaymentDB.related_invoice_id == invoice.id, PaymentDB.is_reversed == False)  # noqa: E712
            .all()
        )
        paid_so_far = inv_status.settled_amount(existing_payments)
        remaining = max(0.0, round(invoice.total - paid_so_far, 2))
        if payment_amount + withheld > remaining + 0.001:
            raise ValueError(
                f"Payment amount (${payment_amount + withheld:.2f}) exceeds remaining balance (${remaining:.2f}). Overpayment is prevented."
            )
        if withheld > 0:
            expected = inv_status.withholding_amount(invoice.subtotal, invoice.withholding_tax_rate)
            withheld_so_far = sum(float(p.withheld_amount or 0.0) for p in existing_payments)
            if withheld_so_far + withheld > expected + 0.01:
                raise inv_status.ReceiptError(
                    "withheld_exceeds_expected",
                    f"Withheld tax ({withheld_so_far + withheld:,.2f}) exceeds the withholding expected on this invoice ({expected:,.2f}).",
                )

        payment = PaymentDB(
            direction="incoming",
            related_invoice_id=invoice.id,
            related_bill_id=None,
            amount=payment_amount,
            withheld_amount=withheld,
            currency=invoice.currency,
            payment_date=payment_date,
            bank_account_id=account.id,
            method=method or inv_status.METHOD_BY_RECEIPT_TYPE_CODE.get(pt.code, "other"),
            reference=reference or "",
            is_reversed=False,
        )
        self.db.add(payment)
        invoice.status = inv_status.derive_payment_status(invoice.total, paid_so_far + payment_amount + withheld)
        return invoice, payment

    def settle_statutory_obligation(
        self,
        obligation_id: int,
        amount: float,
        payment_date: str,
        bank_account_id: int,
        payment_type_id: Optional[int] = None,
        reference: str = "",
        method: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> Tuple[StatutoryObligationDB, PaymentDB, LedgerTransactionDB]:
        """
        Record a settlement against a statutory obligation.
        Enforces status integrity (must be accrued or partially_remitted),
        checks remaining balance, prevents overpayment, updates obligation amount_remitted,
        transitions status to remitted or partially_remitted, and creates the linked PaymentDB
        and LedgerTransactionDB records; the account balance comes from
        recalculate_account_running_balances. All of it commits together.

        Refuses with StatutoryPaymentError (code):
          currency_mismatch        - paying account currency differs from the obligation currency
          payment_type_not_allowed - type is not an outgoing type that fits the paying account kind
        """
        obligation = self.db.query(StatutoryObligationDB).filter(StatutoryObligationDB.id == obligation_id).first()
        if not obligation:
            raise ValueError(f"Statutory obligation #{obligation_id} not found")

        if obligation.status == "estimated":
            raise ValueError("Statutory obligation must be confirmed into accrued status before settlement")

        if obligation.status == "remitted":
            raise ValueError(f"Statutory obligation #{obligation_id} is already fully remitted")

        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == bank_account_id)
            .first()
        )
        if not bank_account:
            raise ValueError(f"Bank account #{bank_account_id} not found")

        existing_payments = (
            self.db.query(PaymentDB)
            .filter(PaymentDB.related_statutory_obligation_id == obligation.id, PaymentDB.is_reversed == False)
            .all()
        )
        paid_so_far = sum(float(p.amount) for p in existing_payments)
        remaining = max(0.0, round(obligation.amount_accrued - paid_so_far, 2))
        payment_amount = float(amount)

        if payment_amount <= 0:
            raise ValueError("Payment amount must be greater than 0")

        # Same currency: no exchange rate on statutory payments
        if (bank_account.currency or "").upper() != (obligation.currency or "").upper():
            raise StatutoryPaymentError(
                "currency_mismatch",
                f"Account currency ({bank_account.currency}) differs from the obligation currency ({obligation.currency}). Pay from a {obligation.currency} account.",
            )

        account_type = (bank_account.account_type or "bank").lower()
        allowed_codes = STATUTORY_PAYMENT_TYPE_CODES_BY_ACCOUNT_TYPE.get(account_type, frozenset())
        if payment_type_id is None:
            default_code = DEFAULT_STATUTORY_PAYMENT_TYPE_CODE.get(account_type)
            pt = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == default_code).first() if default_code else None
        else:
            pt = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.id == payment_type_id).first()
            if pt is None or not pt.is_active or pt.code not in allowed_codes:
                raise StatutoryPaymentError(
                    "payment_type_not_allowed",
                    f"Payment type '{pt.name if pt else payment_type_id}' cannot be used to pay a statutory obligation from a {account_type} account.",
                )

        if payment_amount > remaining + 0.001:
            raise ValueError(
                f"Payment amount (${payment_amount:.2f}) exceeds remaining balance (${remaining:.2f}). Overpayment is prevented."
            )

        ref_str = reference or f"STAT-{obligation.obligation_type}-{obligation.period}"
        payment = PaymentDB(
            direction="outgoing",
            related_bill_id=None,
            related_invoice_id=None,
            related_statutory_obligation_id=obligation.id,
            amount=payment_amount,
            currency=obligation.currency,
            payment_date=payment_date,
            bank_account_id=bank_account.id,
            method=method or rules.METHOD_BY_PAYMENT_TYPE_CODE.get(pt.code if pt else "", "bank_transfer"),
            reference=ref_str,
            is_reversed=False,
        )
        self.db.add(payment)

        # Update obligation amounts and status
        new_paid = round(paid_so_far + payment_amount, 2)
        obligation.amount_remitted = new_paid
        if new_paid >= obligation.amount_accrued - 0.001:
            obligation.status = "remitted"
        else:
            obligation.status = "partially_remitted"

        # Find category & payment type
        tax_cat = (
            self.db.query(TransactionCategoryDB)
            .filter(TransactionCategoryDB.name.ilike("%Tax%") | TransactionCategoryDB.name.ilike("%Government%"))
            .first()
        )
        if not tax_cat:
            tax_cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name == "Other").first()

        ledger_tx = LedgerTransactionDB(
            account_id=bank_account.id,
            date=payment.payment_date,
            amount=payment.amount,
            direction="out",
            currency=payment.currency,
            category_id=tax_cat.id if tax_cat else None,
            payment_type_id=pt.id if pt else None,
            reference=ref_str,
            description=f"Statutory remittance: {obligation.obligation_type.replace('_', ' ').title()} for period {obligation.period}",
            source="statutory_remittance",
            linked_statutory_obligation_id=obligation.id,
            running_balance=0.0,
            created_by=created_by,
        )
        self.db.add(ledger_tx)
        self.db.flush()
        from finance.repositories.ledger_repository import LedgerRepository
        LedgerRepository(self.db).recalculate_account_running_balances(bank_account.id, commit=False)

        self.db.commit()
        self.db.refresh(obligation)
        self.db.refresh(payment)
        self.db.refresh(ledger_tx)

        return obligation, payment, ledger_tx

    def check_duplicate_settlement(
        self,
        payee_type: str,
        payee_id: int,
        amount: float,
        date_str: Optional[str] = None,
        currency: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Checks if an entered transaction closely matches an open bill or invoice for the payee.
        Returns match metadata if a candidate is found within date/amount tolerance.
        """
        if payee_type == "vendor" and payee_id:
            open_bills = (
                self.db.query(BillDB)
                .filter(
                    BillDB.vendor_id == payee_id,
                    BillDB.status.in_(bs.OPEN_STATUSES),
                )
                .all()
            )

            tx_date = None
            if date_str:
                try:
                    tx_date = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
                except Exception:
                    pass

            for bill in open_bills:
                # Compute remaining balance
                existing_payments = (
                    self.db.query(PaymentDB)
                    .filter(PaymentDB.related_bill_id == bill.id, PaymentDB.is_reversed == False)
                    .all()
                )
                paid_so_far = sum(float(p.amount) for p in existing_payments)
                remaining = max(0.0, round(bill.total - paid_so_far, 2))

                # Amount check: within 5% or exact
                amount_tolerance = max(1.0, remaining * 0.05)
                amount_matches = abs(remaining - amount) <= amount_tolerance or abs(bill.total - amount) <= amount_tolerance

                # Date check: within 14 days of due date or issue date
                date_matches = True
                if tx_date and bill.due_date:
                    try:
                        due_d = datetime.strptime(bill.due_date[:10], "%Y-%m-%d").date()
                        date_matches = abs((tx_date - due_d).days) <= 21
                    except Exception:
                        pass

                if amount_matches and date_matches:
                    return {
                        "has_match": True,
                        "match_type": "bill",
                        "document_id": bill.id,
                        "document_number": bill.bill_number,
                        "document_total": float(bill.total),
                        "remaining_balance": remaining,
                        "currency": bill.currency,
                        "due_date": bill.due_date,
                        "message": f"Matching open bill #{bill.bill_number} found with remaining balance of {bill.currency} {remaining:,.2f} (Due: {bill.due_date}).",
                    }

        elif payee_type == "customer" and payee_id:
            open_invoices = (
                self.db.query(SalesInvoiceDB)
                .filter(
                    SalesInvoiceDB.customer_id == payee_id,
                    SalesInvoiceDB.status.in_(inv_status.OPEN_STATUSES),
                )
                .all()
            )

            tx_date = None
            if date_str:
                try:
                    tx_date = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
                except Exception:
                    pass

            for inv in open_invoices:
                existing_payments = (
                    self.db.query(PaymentDB)
                    .filter(PaymentDB.related_invoice_id == inv.id, PaymentDB.is_reversed == False)
                    .all()
                )
                paid_so_far = sum(float(p.amount) for p in existing_payments)
                remaining = max(0.0, round(inv.total - paid_so_far, 2))

                amount_tolerance = max(1.0, remaining * 0.05)
                amount_matches = abs(remaining - amount) <= amount_tolerance or abs(inv.total - amount) <= amount_tolerance

                date_matches = True
                if tx_date and inv.due_date:
                    try:
                        due_d = datetime.strptime(inv.due_date[:10], "%Y-%m-%d").date()
                        date_matches = abs((tx_date - due_d).days) <= 21
                    except Exception:
                        pass

                if amount_matches and date_matches:
                    return {
                        "has_match": True,
                        "match_type": "invoice",
                        "document_id": inv.id,
                        "document_number": inv.invoice_number,
                        "document_total": float(inv.total),
                        "remaining_balance": remaining,
                        "currency": inv.currency,
                        "due_date": inv.due_date,
                        "message": f"Matching open invoice #{inv.invoice_number} found with remaining balance of {inv.currency} {remaining:,.2f} (Due: {inv.due_date}).",
                    }

        return {"has_match": False}

    def find_unlinked_settlement_candidates(self, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Surfaces unlinked transactions that have a Vendor payee and a plausible matching open bill.
        Lightweight review indicator — never auto-links.
        """
        # Query recent out-direction transactions with vendor payee and no linked bill
        unlinked_txs = (
            self.db.query(LedgerTransactionDB)
            .filter(
                LedgerTransactionDB.payee_type == "vendor",
                LedgerTransactionDB.payee_id.isnot(None),
                LedgerTransactionDB.linked_bill_id.is_(None),
                LedgerTransactionDB.direction == "out",
            )
            .order_by(LedgerTransactionDB.date.desc())
            .limit(limit * 2)
            .all()
        )

        candidates = []
        for tx in unlinked_txs:
            match = self.check_duplicate_settlement(
                payee_type="vendor",
                payee_id=tx.payee_id,
                amount=tx.amount,
                date_str=tx.date,
                currency=tx.currency,
            )
            if match.get("has_match"):
                candidates.append({
                    "transaction_id": tx.id,
                    "date": tx.date,
                    "amount": tx.amount,
                    "currency": tx.currency,
                    "payee_type": tx.payee_type,
                    "payee_id": tx.payee_id,
                    "payee_name": tx.payee_name,
                    "matching_bill_id": match.get("document_id"),
                    "matching_bill_number": match.get("document_number"),
                    "bill_total": match.get("document_total"),
                    "bill_remaining": match.get("remaining_balance"),
                    "bill_due_date": match.get("due_date"),
                })
            if len(candidates) >= limit:
                break

        return candidates
