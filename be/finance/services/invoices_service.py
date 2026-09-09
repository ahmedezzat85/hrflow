"""
be/finance/services/invoices_service.py
Business logic and validation for Sales Invoices and incoming Payments.
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.invoices_repository import InvoicesRepository
from finance.schemas import (
    SalesInvoiceCreate,
    SalesInvoiceUpdate,
    SalesInvoiceResponse,
    SalesInvoiceLineResponse,
    PaymentCreate,
    PaymentResponse,
)
from finance.models import SalesInvoiceDB, PaymentDB


VALID_INVOICE_STATUSES = {"draft", "sent", "paid", "overdue", "void"}
VALID_PAYMENT_METHODS = {"bank_transfer", "cash", "card", "other"}
VALID_DIRECTIONS = {"incoming", "outgoing"}


class InvoicesService:
    def __init__(self, repo: InvoicesRepository):
        self.repo = repo

    # ------------------------------------------------------------------
    # Serialization helpers
    # ------------------------------------------------------------------
    def _invoice_to_response(self, invoice: SalesInvoiceDB) -> SalesInvoiceResponse:
        lines = [
            SalesInvoiceLineResponse(
                id=ln.id,
                invoice_id=ln.invoice_id,
                description=ln.description,
                quantity=ln.quantity,
                unit_price=ln.unit_price,
                line_total=ln.line_total,
            )
            for ln in (invoice.lines or [])
        ]
        customer_name = invoice.customer.name if invoice.customer else None
        return SalesInvoiceResponse(
            id=invoice.id,
            customer_id=invoice.customer_id,
            customer_name=customer_name,
            invoice_number=invoice.invoice_number,
            issue_date=invoice.issue_date,
            due_date=invoice.due_date,
            status=invoice.status,
            currency=invoice.currency,
            subtotal=invoice.subtotal,
            tax_amount=invoice.tax_amount,
            total=invoice.total,
            notes=invoice.notes,
            created_at=invoice.created_at,
            lines=lines,
        )

    def _payment_to_response(self, payment: PaymentDB) -> PaymentResponse:
        bank_name = (
            payment.bank_account.account_name
            if payment.bank_account
            else None
        )
        return PaymentResponse(
            id=payment.id,
            direction=payment.direction,
            related_invoice_id=payment.related_invoice_id,
            related_bill_id=payment.related_bill_id,
            amount=payment.amount,
            currency=payment.currency,
            payment_date=payment.payment_date,
            bank_account_id=payment.bank_account_id,
            bank_account_name=bank_name,
            method=payment.method,
            reference=payment.reference or "",
            created_at=payment.created_at,
        )

    # ------------------------------------------------------------------
    # Invoice CRUD
    # ------------------------------------------------------------------
    def list_invoices(
        self,
        status: Optional[str] = None,
        customer_id: Optional[int] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[SalesInvoiceResponse]:
        if status and status not in VALID_INVOICE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{status}'. Must be one of: {', '.join(VALID_INVOICE_STATUSES)}",
            )
        invoices = self.repo.list_all(
            status=status, customer_id=customer_id, search=search, limit=limit, offset=offset
        )
        return [self._invoice_to_response(inv) for inv in invoices]

    def get_invoice(self, invoice_id: int) -> SalesInvoiceResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
        return self._invoice_to_response(invoice)

    def create_invoice(self, payload: SalesInvoiceCreate) -> SalesInvoiceResponse:
        if payload.status not in VALID_INVOICE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")

        existing = self.repo.get_by_number(payload.invoice_number)
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Invoice number '{payload.invoice_number}' is already in use",
            )

        data = payload.model_dump(exclude={"lines"}) if hasattr(payload, "model_dump") else payload.dict(exclude={"lines"})
        lines_data = [
            (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
            for ln in payload.lines
        ]
        invoice = self.repo.create(data, lines_data)
        return self._invoice_to_response(invoice)

    def update_invoice(self, invoice_id: int, payload: SalesInvoiceUpdate) -> SalesInvoiceResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")

        if invoice.status == "void":
            raise HTTPException(status_code=400, detail="Cannot update a voided invoice")

        if payload.status and payload.status not in VALID_INVOICE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")

        data = payload.model_dump(exclude_unset=True, exclude={"lines"}) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True, exclude={"lines"})
        lines_data = None
        if payload.lines is not None:
            lines_data = [
                (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
                for ln in payload.lines
            ]

        updated = self.repo.update(invoice_id, data, lines_data)
        return self._invoice_to_response(updated)

    def void_invoice(self, invoice_id: int) -> SalesInvoiceResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
        if invoice.status == "void":
            raise HTTPException(status_code=400, detail="Invoice is already voided")
        if invoice.status == "paid":
            raise HTTPException(status_code=400, detail="Cannot void a paid invoice. Issue a credit note instead.")

        voided = self.repo.void_invoice(invoice_id)
        return self._invoice_to_response(voided)

    # ------------------------------------------------------------------
    # Payment (incoming) on an invoice
    # ------------------------------------------------------------------
    def list_payments(self, invoice_id: int) -> List[PaymentResponse]:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
        payments = self.repo.list_payments(invoice_id)
        return [self._payment_to_response(p) for p in payments]

    def record_payment(self, invoice_id: int, payload: PaymentCreate) -> PaymentResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")

        if invoice.status in ("void",):
            raise HTTPException(status_code=400, detail="Cannot record payment against a voided invoice")

        if payload.direction != "incoming":
            raise HTTPException(status_code=400, detail="Invoice payments must be direction=incoming")

        if payload.method not in VALID_PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail=f"Invalid payment method '{payload.method}'")

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        data["related_invoice_id"] = invoice_id  # always tie to this invoice

        try:
            payment = self.repo.record_payment(data)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

        return self._payment_to_response(payment)
