"""
be/finance/repositories/invoices_repository.py
SQLAlchemy-backed repository for Sales Invoices, Invoice Lines, and
incoming Payments (Accounts Receivable side).

Conventions (matches Phase 4.1 / 4.2 pattern):
 - All write operations commit and refresh before returning.
 - No hard deletes — invoices are voided, not deleted.
 - Balance adjustment on Payment is done here so it stays atomic with the Payment insert.
"""
from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

from finance import invoice_status as inv_status
from finance.models import (
    SalesInvoiceDB,
    SalesInvoiceLineDB,
    PaymentDB,
    FinanceBankAccountDB,
    CustomerDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
    PaymentTypeDB,
)


class InvoicesRepository:
    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _compute_totals(self, lines: List[SalesInvoiceLineDB], vat_rate: float = 0.0) -> tuple[float, float, float]:
        """Returns (subtotal, tax_amount, total). Subtotal (net) = sum of line_totals; VAT = subtotal x rate (D-023)."""
        return inv_status.compute_totals(sum(ln.line_total for ln in lines), vat_rate)

    def _initial_withholding_rate(self, data: dict) -> float:
        """D-024: the invoice's withholding rate defaults from the customer (normally 0)."""
        if data.get("withholding_tax_rate") is not None:
            return float(data["withholding_tax_rate"])
        customer = self.db.query(CustomerDB).filter(CustomerDB.id == data["customer_id"]).first()
        return float((customer.withholding_tax_rate if customer else 0.0) or 0.0)

    def _load_invoice_full(self, invoice_id: int) -> Optional[SalesInvoiceDB]:
        return (
            self.db.query(SalesInvoiceDB)
            .options(
                joinedload(SalesInvoiceDB.lines),
                joinedload(SalesInvoiceDB.customer),
                joinedload(SalesInvoiceDB.expected_bank_account),
                joinedload(SalesInvoiceDB.payments),
            )
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
        currency: Optional[str] = None,
        revenue_channel: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        due_date_from: Optional[str] = None,
        due_date_to: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[SalesInvoiceDB]:
        query = (
            self.db.query(SalesInvoiceDB)
            .options(
                joinedload(SalesInvoiceDB.lines),
                joinedload(SalesInvoiceDB.customer),
                joinedload(SalesInvoiceDB.expected_bank_account),
                joinedload(SalesInvoiceDB.payments),
            )
        )
        if status:
            st = status.lower().strip()
            today_str = datetime.utcnow().strftime("%Y-%m-%d")
            if st == "open":
                query = query.filter(SalesInvoiceDB.status.in_([inv_status.DRAFT, *inv_status.OPEN_STATUSES]))
            elif st == "awaiting_payment":
                query = query.filter(
                    SalesInvoiceDB.status.in_(inv_status.OPEN_STATUSES),
                    SalesInvoiceDB.due_date >= today_str,
                )
            elif st == "overdue":
                query = query.filter(
                    SalesInvoiceDB.status.in_(inv_status.OPEN_STATUSES),
                    SalesInvoiceDB.due_date < today_str,
                )
            elif st != "all":
                query = query.filter(SalesInvoiceDB.status == st)

        if customer_id is not None:
            query = query.filter(SalesInvoiceDB.customer_id == customer_id)
        if currency and currency.upper() != "ALL":
            query = query.filter(SalesInvoiceDB.currency == currency.upper())
        if revenue_channel and revenue_channel != "all":
            query = query.filter(SalesInvoiceDB.revenue_channel == revenue_channel)
        if date_from:
            query = query.filter(SalesInvoiceDB.issue_date >= date_from)
        if date_to:
            query = query.filter(SalesInvoiceDB.issue_date <= date_to)
        if due_date_from:
            query = query.filter(SalesInvoiceDB.due_date >= due_date_from)
        if due_date_to:
            query = query.filter(SalesInvoiceDB.due_date <= due_date_to)

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
            status=inv_status.DRAFT,
            currency=data.get("currency", "USD"),
            vat_rate=(
                float(data["vat_rate"]) if data.get("vat_rate") is not None
                else inv_status.default_vat_rate(data.get("currency", "USD"))
            ),
            withholding_tax_rate=self._initial_withholding_rate(data),
            expected_bank_account_id=data.get("expected_bank_account_id"),
            revenue_channel=data.get("revenue_channel"),
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
        subtotal, tax_amount, total = self._compute_totals(db_lines, invoice.vat_rate)
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
        if "invoice_number" in data and data["invoice_number"] is not None:
            invoice.invoice_number = data["invoice_number"].strip()
        if "issue_date" in data and data["issue_date"] is not None:
            invoice.issue_date = data["issue_date"]
        if "due_date" in data and data["due_date"] is not None:
            invoice.due_date = data["due_date"]
        if "currency" in data and data["currency"] is not None:
            invoice.currency = data["currency"]
        if "withholding_tax_rate" in data and data["withholding_tax_rate"] is not None:
            invoice.withholding_tax_rate = float(data["withholding_tax_rate"])
        vat_changed = False
        if "vat_rate" in data and data["vat_rate"] is not None:
            vat_changed = float(data["vat_rate"]) != float(invoice.vat_rate or 0.0)
            invoice.vat_rate = float(data["vat_rate"])
        if "expected_bank_account_id" in data:
            invoice.expected_bank_account_id = data["expected_bank_account_id"]
        if "revenue_channel" in data:
            invoice.revenue_channel = data["revenue_channel"]
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
            subtotal, tax_amount, total = self._compute_totals(db_lines, invoice.vat_rate)
            invoice.subtotal = subtotal
            invoice.tax_amount = tax_amount
            invoice.total = total
        elif vat_changed:
            self.db.flush()
            self.db.refresh(invoice)
            subtotal, tax_amount, total = self._compute_totals(invoice.lines or [], invoice.vat_rate)
            invoice.subtotal = subtotal
            invoice.tax_amount = tax_amount
            invoice.total = total

        self.db.commit()
        return self._load_invoice_full(invoice_id)

    def set_status(self, invoice_id: int, new_status: str, extra: Optional[dict] = None) -> Optional[SalesInvoiceDB]:
        """Apply an action's target status (and any server-owned fields). Only services call this."""
        invoice = self.db.query(SalesInvoiceDB).filter(SalesInvoiceDB.id == invoice_id).first()
        if not invoice:
            return None
        invoice.status = new_status
        for key, value in (extra or {}).items():
            setattr(invoice, key, value)
        self.db.commit()
        return self._load_invoice_full(invoice_id)

    def count_unreversed_receipts(self, invoice_id: int) -> int:
        return (
            self.db.query(PaymentDB)
            .filter(
                PaymentDB.related_invoice_id == invoice_id,
                PaymentDB.direction == "incoming",
                PaymentDB.is_reversed == False,  # noqa: E712
            )
            .count()
        )

    # ------------------------------------------------------------------
    # Writes: Payment
    # ------------------------------------------------------------------
    def record_payment(self, data: dict) -> PaymentDB:
        """
        Record an incoming receipt against an invoice through the settlement service (status,
        currency and payment-type checks), then write the ledger row and recompute the account
        balance with recalculate_account_running_balances. Settlement, ledger row and balance
        commit together or not at all.
        """
        from finance.services.settlement_service import SettlementService
        from finance.repositories.ledger_repository import LedgerRepository

        invoice_id = data.get("related_invoice_id")
        if not invoice_id:
            raise ValueError("An invoice receipt must reference an invoice")

        ref = (data.get("reference") or "").strip()
        if ref:
            dup = (
                self.db.query(PaymentDB)
                .filter(PaymentDB.reference == ref, PaymentDB.is_reversed == False)  # noqa: E712
                .first()
            )
            if dup:
                raise ValueError(f"Duplicate payment reference '{ref}' detected. Please review.")

        invoice, payment = SettlementService(self.db).settle_invoice(
            invoice_id=invoice_id,
            amount=data["amount"],
            payment_date=data["payment_date"],
            bank_account_id=data["bank_account_id"],
            payment_type_id=data.get("payment_type_id"),
            reference=ref,
            withheld_amount=float(data.get("withheld_amount") or 0.0),
        )
        self.db.flush()

        account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == payment.bank_account_id).first()
        if data.get("payment_type_id"):
            payment_type = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.id == data["payment_type_id"]).first()
        else:
            code = inv_status.DEFAULT_RECEIPT_TYPE_CODE_BY_ACCOUNT_TYPE.get((account.account_type or "bank").lower())
            payment_type = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == code).first() if code else None
        rev_cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name == "Revenue").first()
        customer = self.db.query(CustomerDB).filter(CustomerDB.id == invoice.customer_id).first()

        ledger_tx = LedgerTransactionDB(
            account_id=account.id,
            date=payment.payment_date,
            amount=payment.amount,
            direction="in",
            currency=payment.currency,
            category_id=rev_cat.id if rev_cat else None,
            payment_type_id=payment_type.id if payment_type else None,
            reference=ref,
            description=(data.get("details") or "").strip() or (customer.name if customer else f"Invoice {invoice.invoice_number}"),
            payee_type="customer" if customer else "none",
            payee_id=customer.id if customer else None,
            payee_name=customer.name if customer else None,
            source="invoice_payment",
            linked_invoice_id=invoice.id,
            running_balance=0.0,
            created_by=data.get("created_by"),
        )
        self.db.add(ledger_tx)
        self.db.flush()
        LedgerRepository(self.db).recalculate_account_running_balances(account.id, commit=False)

        self.db.commit()
        self.db.refresh(payment)
        return payment

    def reverse_payment(
        self, invoice_id: int, payment_id: int, reason: Optional[str] = None, reversed_by: Optional[str] = None
    ) -> PaymentDB:
        """
        Atomically reverse a receipt: mark it reversed, post a reversing ledger row (never deleted),
        recompute the account balance from the ledger, and derive the invoice status from the
        receipts that remain.
        """
        from finance.repositories.ledger_repository import LedgerRepository

        payment = (
            self.db.query(PaymentDB)
            .filter(PaymentDB.id == payment_id, PaymentDB.related_invoice_id == invoice_id)
            .first()
        )
        if not payment:
            raise LookupError(f"Payment {payment_id} not found for invoice {invoice_id}")
        if payment.is_reversed:
            raise ValueError(f"Payment {payment_id} has already been reversed")

        invoice = self.db.query(SalesInvoiceDB).filter(SalesInvoiceDB.id == invoice_id).first()
        if invoice.status != inv_status.VOID:
            inv_status.next_status("reverse_receipt", invoice.status)

        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == payment.bank_account_id)
            .first()
        )
        if not bank_account:
            raise ValueError(f"Bank account {payment.bank_account_id} not found")

        payment.is_reversed = True
        payment.reversed_at = datetime.utcnow()
        payment.reversed_by = reversed_by
        payment.reversal_reason = (reason or "").strip() or None

        rev_cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name == "Revenue").first()
        self.db.add(LedgerTransactionDB(
            account_id=bank_account.id,
            date=datetime.utcnow().strftime("%Y-%m-%d"),
            amount=payment.amount,
            direction="out",
            currency=payment.currency,
            category_id=rev_cat.id if rev_cat else None,
            reference=f"REV-{payment.reference or payment.id}",
            description=f"Reversal of payment #{payment.id}" + (f": {reason.strip()}" if reason and reason.strip() else ""),
            source="payment_reversal",
            linked_invoice_id=invoice_id,
            running_balance=0.0,
            created_by=reversed_by,
        ))
        self.db.flush()
        LedgerRepository(self.db).recalculate_account_running_balances(bank_account.id, commit=False)

        if invoice.status != inv_status.VOID:
            remaining = inv_status.settled_amount([p for p in self.list_payments(invoice_id) if p.id != payment.id])
            invoice.status = inv_status.derive_payment_status(invoice.total, remaining)

        self.db.commit()
        self.db.refresh(payment)
        return payment
