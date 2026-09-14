"""
be/finance/services/settlement_service.py
Unified settlement engine across Bill Payment, Invoice Payment, and Add Transaction (FUX-406).
Ensures atomic balance updates, document status transitions (paid/partially_paid),
payment history logging, and pre-submit duplicate settlement matching.
"""
from datetime import datetime, timedelta
from typing import Optional, Tuple, List, Dict, Any
from sqlalchemy.orm import Session

from finance.models import (
    BillDB,
    SalesInvoiceDB,
    PaymentDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
)


class SettlementService:
    def __init__(self, db: Session):
        self.db = db

    def settle_bill(
        self,
        bill_id: int,
        amount: float,
        payment_date: str,
        bank_account_id: int,
        currency: str = "USD",
        reference: str = "",
        method: str = "bank_transfer",
    ) -> Tuple[BillDB, PaymentDB]:
        """
        Record a settlement against a vendor bill.
        Enforces remaining balance checks, transitions bill status, and creates PaymentDB.
        """
        bill = self.db.query(BillDB).filter(BillDB.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill #{bill_id} not found")

        if bill.status in ("void",):
            raise ValueError("Cannot record payment against a voided bill")

        if (
            bill.requires_approval
            and bill.approval_status != "approved"
            and bill.status not in ("ready_to_pay", "scheduled", "paid")
        ):
            raise ValueError("Bill requires approval before payment can be recorded.")

        # Calculate remaining balance excluding reversed payments
        existing_payments = (
            self.db.query(PaymentDB)
            .filter(PaymentDB.related_bill_id == bill.id, PaymentDB.is_reversed == False)
            .all()
        )
        paid_so_far = sum(float(p.amount) for p in existing_payments)
        remaining = round(bill.total - paid_so_far, 2)
        payment_amount = float(amount)

        if payment_amount > remaining + 0.01:
            raise ValueError(
                f"Payment amount (${payment_amount:.2f}) exceeds remaining balance (${remaining:.2f})."
            )

        payment = PaymentDB(
            direction="outgoing",
            related_bill_id=bill.id,
            related_invoice_id=None,
            amount=payment_amount,
            currency=currency,
            payment_date=payment_date,
            bank_account_id=bank_account_id,
            method=method or "bank_transfer",
            reference=reference or bill.bill_number,
            is_reversed=False,
        )
        self.db.add(payment)

        # Update bill status & amount_paid
        bill.amount_paid = round(paid_so_far + payment_amount, 2)
        if bill.amount_paid >= bill.total - 0.01:
            bill.status = "paid"
        elif bill.status in ("ready_to_pay", "scheduled", "partially_paid", "unpaid"):
            bill.status = "partially_paid"

        return bill, payment

    def settle_invoice(
        self,
        invoice_id: int,
        amount: float,
        payment_date: str,
        bank_account_id: int,
        currency: str = "USD",
        reference: str = "",
        method: str = "bank_transfer",
    ) -> Tuple[SalesInvoiceDB, PaymentDB]:
        """
        Record a settlement against a customer sales invoice.
        Enforces remaining balance checks, transitions invoice status, and creates PaymentDB.
        """
        invoice = self.db.query(SalesInvoiceDB).filter(SalesInvoiceDB.id == invoice_id).first()
        if not invoice:
            raise ValueError(f"Invoice #{invoice_id} not found")

        if invoice.status in ("void",):
            raise ValueError("Cannot record payment against a voided invoice")

        existing_payments = (
            self.db.query(PaymentDB)
            .filter(PaymentDB.related_invoice_id == invoice.id, PaymentDB.is_reversed == False)
            .all()
        )
        paid_so_far = sum(float(p.amount) for p in existing_payments)
        remaining = max(0.0, round(invoice.total - paid_so_far, 2))
        payment_amount = float(amount)

        if payment_amount > remaining + 0.001:
            raise ValueError(
                f"Payment amount (${payment_amount:.2f}) exceeds remaining balance (${remaining:.2f}). Overpayment is prevented."
            )

        payment = PaymentDB(
            direction="incoming",
            related_invoice_id=invoice.id,
            related_bill_id=None,
            amount=payment_amount,
            currency=currency,
            payment_date=payment_date,
            bank_account_id=bank_account_id,
            method=method or "bank_transfer",
            reference=reference or invoice.invoice_number,
            is_reversed=False,
        )
        self.db.add(payment)

        # Update invoice status
        if paid_so_far + payment_amount >= invoice.total - 0.001:
            invoice.status = "paid"
        elif invoice.status in ("sent", "overdue", "partially_paid", "awaiting_payment"):
            invoice.status = "partially_paid"

        return invoice, payment

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
                    BillDB.status.notin_(["paid", "void"]),
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
                    SalesInvoiceDB.status.in_(["sent", "overdue", "partially_paid", "awaiting_payment"]),
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
