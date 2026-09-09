"""
be/finance/services/bills_service.py
Business logic and validation for Vendor Bills and outgoing Payments.
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.bills_repository import BillsRepository
from finance.schemas import (
    BillCreate,
    BillUpdate,
    BillResponse,
    BillLineResponse,
    PaymentCreate,
    PaymentResponse,
)
from finance.models import BillDB, PaymentDB


VALID_BILL_STATUSES = {"unpaid", "paid", "overdue", "void"}
VALID_PAYMENT_METHODS = {"bank_transfer", "cash", "card", "other"}
VALID_DIRECTIONS = {"incoming", "outgoing"}


class BillsService:
    def __init__(self, repo: BillsRepository):
        self.repo = repo

    # ------------------------------------------------------------------
    # Serialization helpers
    # ------------------------------------------------------------------
    def _bill_to_response(self, bill: BillDB) -> BillResponse:
        lines = [
            BillLineResponse(
                id=ln.id,
                bill_id=ln.bill_id,
                description=ln.description,
                quantity=ln.quantity,
                unit_price=ln.unit_price,
                line_total=ln.line_total,
            )
            for ln in (bill.lines or [])
        ]
        vendor_name = bill.vendor.name if bill.vendor else None
        return BillResponse(
            id=bill.id,
            vendor_id=bill.vendor_id,
            vendor_name=vendor_name,
            bill_number=bill.bill_number,
            category=bill.category,
            issue_date=bill.issue_date,
            due_date=bill.due_date,
            status=bill.status,
            currency=bill.currency,
            subtotal=bill.subtotal,
            tax_amount=bill.tax_amount,
            total=bill.total,
            notes=bill.notes,
            created_at=bill.created_at,
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
    # Bill CRUD
    # ------------------------------------------------------------------
    def list_bills(
        self,
        status: Optional[str] = None,
        vendor_id: Optional[int] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[BillResponse]:
        if status and status not in VALID_BILL_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{status}'. Must be one of: {', '.join(VALID_BILL_STATUSES)}",
            )
        bills = self.repo.list_all(
            status=status, vendor_id=vendor_id, search=search, limit=limit, offset=offset
        )
        return [self._bill_to_response(b) for b in bills]

    def get_bill(self, bill_id: int) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")
        return self._bill_to_response(bill)

    def create_bill(self, payload: BillCreate) -> BillResponse:
        if payload.status not in VALID_BILL_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")

        existing = self.repo.get_by_number(payload.bill_number)
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Bill number '{payload.bill_number}' is already in use",
            )

        data = payload.model_dump(exclude={"lines"}) if hasattr(payload, "model_dump") else payload.dict(exclude={"lines"})
        lines_data = [
            (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
            for ln in payload.lines
        ]
        bill = self.repo.create(data, lines_data)
        return self._bill_to_response(bill)

    def update_bill(self, bill_id: int, payload: BillUpdate) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if bill.status == "void":
            raise HTTPException(status_code=400, detail="Cannot update a voided bill")

        if payload.status and payload.status not in VALID_BILL_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")

        data = payload.model_dump(exclude_unset=True, exclude={"lines"}) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True, exclude={"lines"})
        lines_data = None
        if payload.lines is not None:
            lines_data = [
                (ln.model_dump() if hasattr(ln, "model_dump") else ln.dict())
                for ln in payload.lines
            ]

        updated = self.repo.update(bill_id, data, lines_data)
        return self._bill_to_response(updated)

    def void_bill(self, bill_id: int) -> BillResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")
        if bill.status == "void":
            raise HTTPException(status_code=400, detail="Bill is already voided")
        if bill.status == "paid":
            raise HTTPException(status_code=400, detail="Cannot void a paid bill. Record a vendor credit instead.")

        voided = self.repo.void_bill(bill_id)
        return self._bill_to_response(voided)

    # ------------------------------------------------------------------
    # Payment (outgoing) on a bill
    # ------------------------------------------------------------------
    def list_payments(self, bill_id: int) -> List[PaymentResponse]:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")
        payments = self.repo.list_payments(bill_id)
        return [self._payment_to_response(p) for p in payments]

    def record_payment(self, bill_id: int, payload: PaymentCreate) -> PaymentResponse:
        bill = self.repo.get_by_id(bill_id)
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill {bill_id} not found")

        if bill.status in ("void",):
            raise HTTPException(status_code=400, detail="Cannot record payment against a voided bill")

        if payload.direction != "outgoing":
            raise HTTPException(status_code=400, detail="Bill payments must be direction=outgoing")

        if payload.method not in VALID_PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail=f"Invalid payment method '{payload.method}'")

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        data["related_bill_id"] = bill_id  # always tie to this bill

        try:
            payment = self.repo.record_payment(data)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

        return self._payment_to_response(payment)
