"""
be/finance/services/invoices_service.py
Business logic and validation for Sales Invoices and incoming Payments.
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance import invoice_status as inv_status
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

VALID_INVOICE_STATUSES = inv_status.LIST_FILTERS  # list filters; only the five real statuses are ever stored
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

        paid_sum = 0.0
        for p in (invoice.payments or []):
            if getattr(p, "is_reversed", False):
                continue
            if (p.amount or 0) > 0 and (p.direction == "incoming" or not p.direction):
                paid_sum += p.amount
        paid_sum = round(paid_sum, 2)
        total = round(invoice.total or 0.0, 2)
        balance = max(0.0, round(total - paid_sum, 2))

        # Overdue is a flag (D-022): due date passed while the invoice is Sent or Partially paid
        is_overdue = inv_status.is_overdue(invoice.status, invoice.due_date)
        days_overdue = 0
        if is_overdue:
            days_overdue = (datetime.utcnow().date() - datetime.strptime(str(invoice.due_date)[:10], "%Y-%m-%d").date()).days

        if invoice.status == inv_status.VOID:
            payment_status = "unpaid"
            next_action = "Archived (Voided)"
        elif invoice.status == inv_status.DRAFT:
            payment_status = "unpaid"
            next_action = "Review & Send to Customer"
        elif balance <= 0:
            payment_status = "paid"
            next_action = "Completed (Paid in Full)"
        elif is_overdue:
            payment_status = "partially_paid" if paid_sum > 0 else "unpaid"
            next_action = f"Send Payment Reminder ({days_overdue}d overdue)"
        elif paid_sum > 0:
            payment_status = "partially_paid"
            next_action = "Collect Remaining Balance"
        else:
            payment_status = "unpaid"
            next_action = "Awaiting Due Date / Payment"

        return SalesInvoiceResponse(
            id=invoice.id,
            customer_id=invoice.customer_id,
            customer_name=customer_name,
            customer_email=customer_email,
            invoice_number=invoice.invoice_number,
            issue_date=invoice.issue_date,
            due_date=invoice.due_date,
            status=invoice.status,
            void_reason=invoice.void_reason,
            voided_by=invoice.voided_by,
            voided_at=invoice.voided_at,
            currency=invoice.currency,
            expected_bank_account_id=invoice.expected_bank_account_id,
            expected_bank_account_name=expected_acc_name,
            revenue_channel=invoice.revenue_channel,
            has_bank_discrepancy=has_discrepancy,
            subtotal=invoice.subtotal,
            vat_rate=invoice.vat_rate or 0.0,
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
            reversed_at=payment.reversed_at,
            reversed_by=payment.reversed_by,
            reversal_reason=payment.reversal_reason,
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

    @staticmethod
    def _lines_changed(invoice: SalesInvoiceDB, new_lines: List[dict]) -> bool:
        def norm(rows):
            return sorted(
                (str(r["description"]).strip(), round(float(r.get("quantity", 1.0)), 4), round(float(r.get("unit_price", 0.0)), 4))
                for r in rows
            )
        current = [
            {"description": ln.description, "quantity": ln.quantity, "unit_price": ln.unit_price}
            for ln in (invoice.lines or [])
        ]
        return norm(current) != norm(new_lines)

    def update_invoice(self, invoice_id: int, payload: SalesInvoiceUpdate) -> SalesInvoiceResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")

        if invoice.status == inv_status.VOID:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "invoice_void",
                    "message": "Cannot update a voided invoice",
                    "current_status": invoice.status,
                    "allowed_actions": inv_status.allowed_actions(invoice.status),
                },
            )

        effective_issue = payload.issue_date or invoice.issue_date
        effective_due = payload.due_date or invoice.due_date
        if effective_issue and effective_due and effective_due < effective_issue:
            raise HTTPException(
                status_code=400,
                detail="Due date cannot precede issue date.",
            )

        lines_data = None
        if payload.lines is not None:
            lines_data = [
                (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
                for ln in payload.lines
            ]

        # Once issued, identity and money fields are locked: void and reissue to correct (D-022).
        # Resending an unchanged value is not an error; only a change is refused.
        if invoice.status != inv_status.DRAFT:
            changed = []
            if payload.customer_id is not None and payload.customer_id != invoice.customer_id:
                changed.append("customer_id")
            if payload.currency is not None and payload.currency.upper() != (invoice.currency or "").upper():
                changed.append("currency")
            if payload.invoice_number is not None and payload.invoice_number.strip() != invoice.invoice_number:
                changed.append("invoice_number")
            if payload.issue_date is not None and payload.issue_date != invoice.issue_date:
                changed.append("issue_date")
            if payload.vat_rate is not None and round(float(payload.vat_rate), 4) != round(float(invoice.vat_rate or 0.0), 4):
                changed.append("vat_rate")
            if lines_data is not None and self._lines_changed(invoice, lines_data):
                changed.append("lines")
            if changed:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "invoice_locked",
                        "message": f"{', '.join(changed)} cannot be changed once an invoice is issued. Void and reissue to correct.",
                        "current_status": invoice.status,
                        "locked_fields": changed,
                    },
                )

        if payload.invoice_number and payload.invoice_number.strip() != invoice.invoice_number:
            existing = self.repo.get_by_number(payload.invoice_number.strip())
            if existing and existing.id != invoice_id:
                raise HTTPException(status_code=400, detail=f"Invoice number '{payload.invoice_number}' already in use")

        self._validate_routing_and_channel(payload.expected_bank_account_id, payload.revenue_channel)

        data = payload.model_dump(exclude_unset=True, exclude={"lines"}) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True, exclude={"lines"})
        if invoice.status != inv_status.DRAFT:
            # Locked fields were verified unchanged above; do not rewrite them (or the lines)
            for key in ("customer_id", "currency", "invoice_number", "issue_date", "vat_rate"):
                data.pop(key, None)
            lines_data = None

        updated = self.repo.update(invoice_id, data, lines_data)
        return self._invoice_to_response(updated)

    def send_invoice(self, invoice_id: int) -> SalesInvoiceResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
        try:
            target = inv_status.next_status("send", invoice.status)
        except inv_status.InvalidInvoiceTransition as e:
            raise HTTPException(status_code=409, detail=e.detail())

        updated = self.repo.set_status(invoice_id, target)
        return self._invoice_to_response(updated)

    def void_invoice(self, invoice_id: int, reason: Optional[str] = None, actor: Optional[str] = None) -> SalesInvoiceResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
        if invoice.status in (inv_status.PAID, inv_status.PARTIALLY_PAID) or self.repo.count_unreversed_receipts(invoice_id) > 0:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "has_unreversed_receipts",
                    "message": "Cannot void an invoice that has unreversed receipts. Reverse the receipts first.",
                    "current_status": invoice.status,
                    "allowed_actions": inv_status.allowed_actions(invoice.status),
                },
            )
        try:
            target = inv_status.next_status("void", invoice.status)
        except inv_status.InvalidInvoiceTransition as e:
            raise HTTPException(status_code=409, detail=e.detail())

        voided = self.repo.set_status(
            invoice_id,
            target,
            {
                "void_reason": reason.strip() if reason and reason.strip() else None,
                "voided_by": actor,
                "voided_at": datetime.utcnow(),
            },
        )
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

    def record_payment(self, invoice_id: int, payload: PaymentCreate, actor: Optional[str] = None) -> PaymentResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")

        if payload.direction != "incoming":
            raise HTTPException(status_code=400, detail="Invoice payments must be direction=incoming")

        if payload.method not in VALID_PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail=f"Invalid payment method '{payload.method}'")

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        data["related_invoice_id"] = invoice_id  # always tie to this invoice
        data["created_by"] = actor

        try:
            payment = self.repo.record_payment(data)
        except inv_status.InvalidInvoiceTransition as e:
            self.repo.db.rollback()
            raise HTTPException(status_code=409, detail=e.detail())
        except inv_status.ReceiptError as e:
            self.repo.db.rollback()
            raise HTTPException(status_code=400, detail=e.detail())
        except ValueError as e:
            self.repo.db.rollback()
            raise HTTPException(status_code=400, detail=str(e))

        return self._payment_to_response(payment)

    def reverse_payment(self, invoice_id: int, payment_id: int, reason: Optional[str] = None, actor: Optional[str] = None) -> PaymentResponse:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")

        try:
            reversed_payment = self.repo.reverse_payment(invoice_id, payment_id, reason=reason, reversed_by=actor)
        except LookupError as e:
            self.repo.db.rollback()
            raise HTTPException(status_code=404, detail=str(e))
        except inv_status.InvalidInvoiceTransition as e:
            self.repo.db.rollback()
            raise HTTPException(status_code=409, detail=e.detail())
        except ValueError as e:
            self.repo.db.rollback()
            raise HTTPException(status_code=400, detail=str(e))

        return self._payment_to_response(reversed_payment)

    def send_reminder(self, invoice_id: int) -> dict:
        invoice = self.repo.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
        if invoice.status not in inv_status.OPEN_STATUSES:
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
