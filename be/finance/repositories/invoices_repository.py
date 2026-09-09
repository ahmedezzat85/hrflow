"""
be/finance/repositories/invoices_repository.py
SQLAlchemy-backed repository for Sales Invoices, Invoice Lines, and
incoming Payments (Accounts Receivable side).

Conventions (matches Phase 4.1 / 4.2 pattern):
 - All write operations commit and refresh before returning.
 - No hard deletes — invoices are voided, not deleted.
 - Balance adjustment on Payment is done here so it stays atomic with the Payment insert.
"""
from typing import List, Optional
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

from finance.models import (
    SalesInvoiceDB,
    SalesInvoiceLineDB,
    PaymentDB,
    FinanceBankAccountDB,
    CustomerDB,
)


class InvoicesRepository:
    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _compute_totals(self, lines: List[SalesInvoiceLineDB]) -> tuple[float, float, float]:
        """Returns (subtotal, tax_amount, total). Tax is stored separately; subtotal = sum of line_totals."""
        subtotal = sum(ln.line_total for ln in lines)
        tax_amount = 0.0  # Tax handled separately in a future phase; field reserved.
        total = subtotal + tax_amount
        return round(subtotal, 4), round(tax_amount, 4), round(total, 4)

    def _load_invoice_full(self, invoice_id: int) -> Optional[SalesInvoiceDB]:
        return (
            self.db.query(SalesInvoiceDB)
            .options(joinedload(SalesInvoiceDB.lines), joinedload(SalesInvoiceDB.customer))
            .filter(SalesInvoiceDB.id == invoice_id)
            .first()
        )

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------
    def list_all(
        self,
        status: Optional[str] = None,
        customer_id: Optional[int] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[SalesInvoiceDB]:
        query = (
            self.db.query(SalesInvoiceDB)
            .options(joinedload(SalesInvoiceDB.lines), joinedload(SalesInvoiceDB.customer))
        )
        if status:
            query = query.filter(SalesInvoiceDB.status == status)
        if customer_id is not None:
            query = query.filter(SalesInvoiceDB.customer_id == customer_id)
        if search:
            s = f"%{search.strip()}%"
            query = query.join(CustomerDB, isouter=True).filter(
                or_(
                    SalesInvoiceDB.invoice_number.ilike(s),
                    CustomerDB.name.ilike(s),
                )
            )
        return (
            query.order_by(SalesInvoiceDB.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

    def get_by_id(self, invoice_id: int) -> Optional[SalesInvoiceDB]:
        return self._load_invoice_full(invoice_id)

    def get_by_number(self, invoice_number: str) -> Optional[SalesInvoiceDB]:
        return (
            self.db.query(SalesInvoiceDB)
            .filter(SalesInvoiceDB.invoice_number == invoice_number.strip())
            .first()
        )

    def list_payments(self, invoice_id: int) -> List[PaymentDB]:
        return (
            self.db.query(PaymentDB)
            .filter(PaymentDB.related_invoice_id == invoice_id)
            .order_by(PaymentDB.payment_date.desc())
            .all()
        )

    # ------------------------------------------------------------------
    # Writes: Invoice
    # ------------------------------------------------------------------
    def create(self, data: dict, lines_data: List[dict]) -> SalesInvoiceDB:
        """Create an invoice with its lines. Totals are computed from lines."""
        invoice = SalesInvoiceDB(
            customer_id=data["customer_id"],
            invoice_number=data["invoice_number"].strip(),
            issue_date=data["issue_date"],
            due_date=data["due_date"],
            status=data.get("status", "draft"),
            currency=data.get("currency", "USD"),
            notes=data.get("notes", ""),
        )
        self.db.add(invoice)
        self.db.flush()  # obtain invoice.id before inserting lines

        db_lines = []
        for ln in lines_data:
            line_total = ln.get("line_total") or round(ln.get("quantity", 1.0) * ln.get("unit_price", 0.0), 4)
            db_line = SalesInvoiceLineDB(
                invoice_id=invoice.id,
                description=ln["description"].strip(),
                quantity=ln.get("quantity", 1.0),
                unit_price=ln.get("unit_price", 0.0),
                line_total=line_total,
            )
            self.db.add(db_line)
            db_lines.append(db_line)

        self.db.flush()
        subtotal, tax_amount, total = self._compute_totals(db_lines)
        invoice.subtotal = subtotal
        invoice.tax_amount = tax_amount
        invoice.total = total

        self.db.commit()
        return self._load_invoice_full(invoice.id)

    def update(self, invoice_id: int, data: dict, lines_data: Optional[List[dict]] = None) -> Optional[SalesInvoiceDB]:
        """Update invoice fields. If lines_data is provided, replace all lines."""
        invoice = self.db.query(SalesInvoiceDB).filter(SalesInvoiceDB.id == invoice_id).first()
        if not invoice:
            return None

        if "customer_id" in data and data["customer_id"] is not None:
            invoice.customer_id = data["customer_id"]
        if "issue_date" in data and data["issue_date"] is not None:
            invoice.issue_date = data["issue_date"]
        if "due_date" in data and data["due_date"] is not None:
            invoice.due_date = data["due_date"]
        if "status" in data and data["status"] is not None:
            invoice.status = data["status"]
        if "currency" in data and data["currency"] is not None:
            invoice.currency = data["currency"]
        if "notes" in data:
            invoice.notes = data["notes"]

        if lines_data is not None:
            # Replace all lines
            self.db.query(SalesInvoiceLineDB).filter(SalesInvoiceLineDB.invoice_id == invoice_id).delete()
            db_lines = []
            for ln in lines_data:
                line_total = ln.get("line_total") or round(ln.get("quantity", 1.0) * ln.get("unit_price", 0.0), 4)
                db_line = SalesInvoiceLineDB(
                    invoice_id=invoice_id,
                    description=ln["description"].strip(),
                    quantity=ln.get("quantity", 1.0),
                    unit_price=ln.get("unit_price", 0.0),
                    line_total=line_total,
                )
                self.db.add(db_line)
                db_lines.append(db_line)
            self.db.flush()
            subtotal, tax_amount, total = self._compute_totals(db_lines)
            invoice.subtotal = subtotal
            invoice.tax_amount = tax_amount
            invoice.total = total

        self.db.commit()
        return self._load_invoice_full(invoice_id)

    def void_invoice(self, invoice_id: int) -> Optional[SalesInvoiceDB]:
        """Void an invoice (soft-delete via status change)."""
        return self.update(invoice_id, {"status": "void"})

    # ------------------------------------------------------------------
    # Writes: Payment
    # ------------------------------------------------------------------
    def record_payment(self, data: dict) -> PaymentDB:
        """
        Record an incoming payment against an invoice.
        Adjusts the bank account's current_balance atomically (+amount for incoming).
        After a full payment, marks the invoice as 'paid' if the payment covers it.
        """
        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == data["bank_account_id"])
            .first()
        )
        if not bank_account:
            raise ValueError(f"Bank account {data['bank_account_id']} not found")

        payment = PaymentDB(
            direction=data.get("direction", "incoming"),
            related_invoice_id=data.get("related_invoice_id"),
            related_bill_id=data.get("related_bill_id"),
            amount=data["amount"],
            currency=data.get("currency", "USD"),
            payment_date=data["payment_date"],
            bank_account_id=data["bank_account_id"],
            method=data.get("method", "bank_transfer"),
            reference=data.get("reference", ""),
        )
        self.db.add(payment)

        # Adjust balance: incoming → credit, outgoing → debit
        if payment.direction == "incoming":
            bank_account.current_balance = round(bank_account.current_balance + payment.amount, 4)
        else:
            bank_account.current_balance = round(bank_account.current_balance - payment.amount, 4)

        # Auto-mark invoice as paid if this payment covers remaining total
        if data.get("related_invoice_id"):
            invoice = self.db.query(SalesInvoiceDB).filter(
                SalesInvoiceDB.id == data["related_invoice_id"]
            ).first()
            if invoice and invoice.status not in ("void", "paid"):
                existing_payments = self.list_payments(invoice.id)
                paid_so_far = sum(p.amount for p in existing_payments)
                if paid_so_far + payment.amount >= invoice.total:
                    invoice.status = "paid"

        self.db.commit()
        self.db.refresh(payment)
        return payment
