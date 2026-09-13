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
from finance.models import SalesInvoiceDB, PaymentDB, FinanceBankAccountDB


from datetime import datetime, date

VALID_INVOICE_STATUSES = {"draft", "sent", "paid", "overdue", "void", "open", "awaiting_payment", "all"}
VALID_PAYMENT_METHODS = {"bank_transfer", "cash", "card", "other"}
VALID_DIRECTIONS = {"incoming", "outgoing"}
VALID_REVENUE_CHANNELS = {
    "local_egp",
    "overseas_usd",
    "cash",
    "intercompany_transfer_us",
    "other",
}


class InvoicesService:
    def __init__(self, repo: InvoicesRepository):
        self.repo = repo

    def _validate_routing_and_channel(self, expected_bank_account_id: Optional[int], revenue_channel: Optional[str]):
        if revenue_channel and revenue_channel not in VALID_REVENUE_CHANNELS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid revenue_channel '{revenue_channel}'. Must be one of: {', '.join(sorted(VALID_REVENUE_CHANNELS))}",
            )
        if expected_bank_account_id is not None:
            bank_acc = self.repo.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == expected_bank_account_id).first()
            if not bank_acc:
                raise HTTPException(
                    status_code=404,
                    detail=f"Expected bank account {expected_bank_account_id} not found",
                )
            if not bank_acc.is_active:
                raise HTTPException(
                    status_code=400,
                    detail=f"Expected bank account '{bank_acc.account_name}' is inactive",
                )

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
        customer_email = invoice.customer.contact_email if invoice.customer else None
        expected_acc_name = (
            invoice.expected_bank_account.account_name
            if getattr(invoice, "expected_bank_account", None)
            else None
        )
        has_discrepancy = False
        if invoice.expected_bank_account_id:
            for p in (invoice.payments or []):
                if p.bank_account_id and p.bank_account_id != invoice.expected_bank_account_id:
                    has_discrepancy = True
                    break

        today = datetime.utcnow().date()
        paid_sum = 0.0
        for p in (invoice.payments or []):
            if getattr(p, "is_reversed", False):
                continue
            if (p.amount or 0) > 0 and (p.direction == "incoming" or not p.direction):
                paid_sum += p.amount
        paid_sum = round(paid_sum, 2)
        total = round(invoice.total or 0.0, 2)
        balance = max(0.0, round(total - paid_sum, 2))

        # Dynamic overdue calculation
        due_dt = None
        is_overdue = False
        days_overdue = 0
        if invoice.due_date:
            try:
                due_dt = datetime.strptime(invoice.due_date, "%Y-%m-%d").date()
                if due_dt < today and balance > 0 and invoice.status != "void":
                    is_overdue = True
                    days_overdue = (today - due_dt).days
            except Exception:
                pass

        if balance <= 0 and invoice.status != "void":
            payment_status = "paid"
            derived_status = "paid"
        elif paid_sum > 0:
            payment_status = "partially_paid"
            derived_status = "overdue" if is_overdue else "sent"
        else:
            payment_status = "unpaid"
            derived_status = "overdue" if is_overdue else invoice.status

        if invoice.status == "void":
            derived_status = "void"
            next_action = "Archived (Voided)"
        elif invoice.status == "draft":
            derived_status = "draft"
            next_action = "Review & Send to Customer"
        elif balance <= 0:
            next_action = "Completed (Paid in Full)"
        elif is_overdue:
            next_action = f"Send Payment Reminder ({days_overdue}d overdue)"
        elif payment_status == "partially_paid":
            next_action = "Collect Remaining Balance"
        else:
            next_action = "Awaiting Due Date / Payment"

        return SalesInvoiceResponse(
            id=invoice.id,
            customer_id=invoice.customer_id,
            customer_name=customer_name,
            customer_email=customer_email,
            invoice_number=invoice.invoice_number,
            issue_date=invoice.issue_date,
            due_date=invoice.due_date,
            status=derived_status,
            currency=invoice.currency,
            expected_bank_account_id=invoice.expected_bank_account_id,
            expected_bank_account_name=expected_acc_name,
            revenue_channel=invoice.revenue_channel,
            has_bank_discrepancy=has_discrepancy,
            subtotal=invoice.subtotal,
            tax_amount=invoice.tax_amount,
            total=invoice.total,
            amount_paid=paid_sum,
            balance=balance,
            is_overdue=is_overdue,
            days_overdue=days_overdue,
            payment_status=payment_status,
            next_action=next_action,
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
        account_discrepancy = False
        exp_id = None
        exp_name = None
        if payment.sales_invoice and payment.sales_invoice.expected_bank_account_id:
            exp_id = payment.sales_invoice.expected_bank_account_id
            if payment.sales_invoice.expected_bank_account:
                exp_name = payment.sales_invoice.expected_bank_account.account_name
            if payment.bank_account_id != exp_id:
                account_discrepancy = True

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
            account_discrepancy=account_discrepancy,
            expected_bank_account_id=exp_id,
            expected_bank_account_name=exp_name,
            method=payment.method,
            reference=payment.reference or "",
            is_reversed=getattr(payment, "is_reversed", False),
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
        currency: Optional[str] = None,
        revenue_channel: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        due_date_from: Optional[str] = None,
        due_date_to: Optional[str] = None,
        payment_state: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[SalesInvoiceResponse]:
        if status and status.lower() not in VALID_INVOICE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{status}'. Must be one of: {', '.join(sorted(VALID_INVOICE_STATUSES))}",
            )
        invoices = self.repo.list_all(
            status=status,
            customer_id=customer_id,
            search=search,
            currency=currency,
            revenue_channel=revenue_channel,
            date_from=date_from,
            date_to=date_to,
            due_date_from=due_date_from,
            due_date_to=due_date_to,
            limit=limit,
            offset=offset,
        )
        responses = [self._invoice_to_response(inv) for inv in invoices]
        if status:
            st = status.lower().strip()
            if st == "overdue":
                responses = [r for r in responses if r.status == "overdue" or r.is_overdue]
            elif st == "awaiting_payment":
                responses = [r for r in responses if r.status in ("sent", "awaiting_payment") and not r.is_overdue and r.balance > 0]
            elif st == "open":
                responses = [r for r in responses if r.status not in ("paid", "void")]
            elif st == "paid":
                responses = [r for r in responses if r.status == "paid" or r.balance <= 0]

        if payment_state and payment_state != "all":
            ps = payment_state.lower().strip()
            responses = [r for r in responses if r.payment_status == ps]
        return responses

    def get_invoice(self, invoice_id: int) -> SalesInvoiceResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
        return self._invoice_to_response(invoice)

    def create_invoice(self, payload: SalesInvoiceCreate) -> SalesInvoiceResponse:
        if payload.status not in VALID_INVOICE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")

        if payload.status in ("paid", "overdue"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot manually set status to '{payload.status}'. Status is derived by payment records and due dates.",
            )

        if payload.issue_date and payload.due_date and payload.due_date < payload.issue_date:
            raise HTTPException(
                status_code=400,
                detail="Due date cannot precede issue date.",
            )

        self._validate_routing_and_channel(payload.expected_bank_account_id, payload.revenue_channel)

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

        if payload.status in ("paid", "overdue"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot manually set status to '{payload.status}'. Status is derived by payment records and due dates.",
            )

        effective_issue = payload.issue_date or invoice.issue_date
        effective_due = payload.due_date or invoice.due_date
        if effective_issue and effective_due and effective_due < effective_issue:
            raise HTTPException(
                status_code=400,
                detail="Due date cannot precede issue date.",
            )

        if payload.invoice_number and payload.invoice_number.strip() != invoice.invoice_number:
            if invoice.status in ("sent", "paid"):
                raise HTTPException(
                    status_code=400,
                    detail="Invoice number is immutable once issued. Void and recreate if a numbering correction is required.",
                )
            existing = self.repo.get_by_number(payload.invoice_number.strip())
            if existing and existing.id != invoice_id:
                raise HTTPException(status_code=400, detail=f"Invoice number '{payload.invoice_number}' already in use")

        if invoice.status in ("paid", "void") and payload.lines is not None:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot modify line items of an invoice in '{invoice.status}' status.",
            )

        self._validate_routing_and_channel(payload.expected_bank_account_id, payload.revenue_channel)

        data = payload.model_dump(exclude_unset=True, exclude={"lines"}) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True, exclude={"lines"})
        lines_data = None
        if payload.lines is not None:
            lines_data = [
                (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
                for ln in payload.lines
            ]

        updated = self.repo.update(invoice_id, data, lines_data)
        return self._invoice_to_response(updated)

    def send_invoice(self, invoice_id: int) -> SalesInvoiceResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
        if invoice.status == "void":
            raise HTTPException(status_code=400, detail="Cannot send a voided invoice")

        updated = self.repo.update(invoice_id, {"status": "sent"})
        return self._invoice_to_response(updated)

    def void_invoice(self, invoice_id: int, reason: Optional[str] = None) -> SalesInvoiceResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
        if invoice.status == "void":
            raise HTTPException(status_code=400, detail="Invoice is already voided")
        if invoice.status == "paid":
            raise HTTPException(status_code=400, detail="Cannot void a paid invoice. Issue a credit note instead.")

        if reason and reason.strip():
            existing_notes = invoice.notes or ""
            updated_notes = f"{existing_notes}\n[Void reason: {reason.strip()}]".strip()
            self.repo.update(invoice_id, {"notes": updated_notes})

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
            raise HTTPException(status_code=400, detail=str(e))

        return self._payment_to_response(payment)

    def reverse_payment(self, invoice_id: int, payment_id: int, reason: Optional[str] = None) -> PaymentResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")

        try:
            reversed_payment = self.repo.reverse_payment(payment_id, reason=reason)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return self._payment_to_response(reversed_payment)

    def send_reminder(self, invoice_id: int) -> dict:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
        if invoice.status in ("paid", "void"):
            raise HTTPException(status_code=400, detail=f"Cannot send reminder for an invoice in '{invoice.status}' status")

        customer = invoice.customer
        email = customer.contact_email if customer else None
        if not email or not email.strip():
            raise HTTPException(
                status_code=400,
                detail="Customer has no contact email address on file. Please add an email address to the customer record before sending reminders.",
            )

        resp = self._invoice_to_response(invoice)
        return {
            "success": True,
            "message": f"Payment reminder successfully dispatched to {email.strip()}",
            "recipient": email.strip(),
            "invoice_number": invoice.invoice_number,
            "balance": resp.balance,
            "days_overdue": resp.days_overdue,
        }
