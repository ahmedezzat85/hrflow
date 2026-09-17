"""
be/finance/services/customers_service.py
Business logic and validation for Finance Customers.
"""
from typing import List, Optional
from fastapi import HTTPException, status

from datetime import date
from finance.repositories.customers_repository import CustomersRepository
from finance.schemas import (
    CustomerCreate,
    CustomerUpdate,
    CustomerResponse,
    CustomerDuplicateCheckRequest,
    CustomerDuplicateCandidate,
    Customer360Summary,
)
from finance.models import CustomerDB


class CustomersService:
    def __init__(self, repo: CustomersRepository):
        self.repo = repo

    def to_response(self, customer: CustomerDB) -> CustomerResponse:
        return CustomerResponse(
            id=customer.id,
            name=customer.name,
            legal_name=customer.legal_name,
            contact_email=customer.contact_email,
            contact_phone=customer.contact_phone,
            tax_id=customer.tax_id,
            billing_address=customer.billing_address,
            country=customer.country or "Egypt",
            default_currency=customer.default_currency or "USD",
            payment_terms_days=customer.payment_terms_days if customer.payment_terms_days is not None else 30,
            owner=customer.owner,
            notes=customer.notes,
            is_active=customer.is_active,
            created_at=customer.created_at,
        )

    def list_customers(
        self,
        is_active: Optional[bool] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[CustomerResponse]:
        customers = self.repo.list_all(is_active=is_active, search=search, limit=limit, offset=offset)
        return [self.to_response(c) for c in customers]

    def get_customer(self, customer_id: int) -> CustomerResponse:
        customer = self.repo.get_by_id(customer_id)
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with ID {customer_id} not found",
            )
        return self.to_response(customer)

    def create_customer(self, payload: CustomerCreate) -> CustomerResponse:
        existing = self.repo.get_by_name(payload.name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"A customer with name '{payload.name}' already exists",
            )
        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        created = self.repo.create(data)
        return self.to_response(created)

    def update_customer(self, customer_id: int, payload: CustomerUpdate) -> CustomerResponse:
        customer = self.repo.get_by_id(customer_id)
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with ID {customer_id} not found",
            )

        if payload.name and payload.name.strip().lower() != customer.name.lower():
            existing = self.repo.get_by_name(payload.name)
            if existing and existing.id != customer_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"A customer with name '{payload.name}' already exists",
                )

        data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        updated = self.repo.update(customer_id, data)
        return self.to_response(updated)

    def soft_delete_customer(self, customer_id: int) -> CustomerResponse:
        customer = self.repo.get_by_id(customer_id)
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with ID {customer_id} not found",
            )
        deactivated = self.repo.soft_delete(customer_id)
        return self.to_response(deactivated)

    def check_duplicates(self, payload: CustomerDuplicateCheckRequest) -> List[CustomerDuplicateCandidate]:
        raw_candidates = self.repo.find_duplicate_candidates(
            name=payload.name,
            legal_name=payload.legal_name,
            tax_id=payload.tax_id,
            contact_email=payload.contact_email,
            exclude_id=payload.exclude_id,
        )
        return [CustomerDuplicateCandidate(**c) for c in raw_candidates]

    def get_customer_360(self, customer_id: int) -> Customer360Summary:
        customer = self.repo.get_by_id(customer_id)
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with ID {customer_id} not found",
            )

        today = date.today()

        def _to_date(v):
            if not v:
                return None
            if isinstance(v, date):
                return v
            if isinstance(v, str):
                try:
                    return date.fromisoformat(v[:10])
                except Exception:
                    return None
            return None

        total_invoiced = 0.0
        total_paid = 0.0
        outstanding_balance = 0.0
        overdue_balance = 0.0
        open_invoices_count = 0
        overdue_invoices_count = 0
        days_to_pay_list = []
        invoices_list = []
        timeline = []

        sorted_invoices = sorted(customer.invoices or [], key=lambda x: str(x.issue_date or ""), reverse=True)

        for inv in sorted_invoices:
            is_void = (inv.status or "").lower() == "void"
            valid_payments = [p for p in (inv.payments or []) if not getattr(p, "is_reversed", False)]
            inv_paid = sum(p.amount for p in valid_payments)
            inv_balance = max(0.0, float(inv.total) - inv_paid) if not is_void else 0.0

            due_dt = _to_date(inv.due_date)
            is_overdue = False
            if not is_void and inv_balance > 0.001 and due_dt and due_dt < today:
                is_overdue = True

            derived_status = "void" if is_void else ("paid" if inv_balance <= 0.001 and float(inv.total) > 0 else ("overdue" if is_overdue else (inv.status or "sent")))

            if not is_void:
                total_invoiced += float(inv.total)
                total_paid += inv_paid
                outstanding_balance += inv_balance
                if is_overdue:
                    overdue_balance += inv_balance
                    overdue_invoices_count += 1
                if inv_balance > 0.001:
                    open_invoices_count += 1

                if derived_status == "paid" and valid_payments:
                    last_pay_raw = max(p.payment_date for p in valid_payments)
                    pay_dt = _to_date(last_pay_raw)
                    iss_dt = _to_date(inv.issue_date)
                    if pay_dt and iss_dt:
                        delta = (pay_dt - iss_dt).days
                        if delta >= 0:
                            days_to_pay_list.append(delta)

            invoices_list.append({
                "id": inv.id,
                "invoice_number": inv.invoice_number,
                "issue_date": str(inv.issue_date) if inv.issue_date else None,
                "due_date": str(inv.due_date) if inv.due_date else None,
                "currency": inv.currency,
                "total": float(inv.total),
                "amount_paid": inv_paid,
                "balance": inv_balance,
                "status": derived_status,
                "is_overdue": is_overdue,
            })

            timeline.append({
                "event_type": "invoice_created",
                "date": str(inv.issue_date) if inv.issue_date else str(inv.created_at or ""),
                "description": f"Invoice {inv.invoice_number} created for {inv.currency} {float(inv.total):,.2f}",
                "invoice_id": inv.id,
            })

            for p in valid_payments:
                timeline.append({
                    "event_type": "payment_received",
                    "date": str(p.payment_date) if p.payment_date else str(p.created_at or ""),
                    "description": f"Payment of {p.currency} {float(p.amount):,.2f} recorded (Ref: {p.reference or 'N/A'})",
                    "invoice_id": inv.id,
                })

        avg_days = round(sum(days_to_pay_list) / len(days_to_pay_list), 1) if days_to_pay_list else None
        timeline.sort(key=lambda x: str(x["date"]), reverse=True)

        return Customer360Summary(
            customer=self.to_response(customer),
            total_invoiced=round(total_invoiced, 2),
            total_paid=round(total_paid, 2),
            outstanding_balance=round(outstanding_balance, 2),
            overdue_balance=round(overdue_balance, 2),
            open_invoices_count=open_invoices_count,
            overdue_invoices_count=overdue_invoices_count,
            average_days_to_pay=avg_days,
            invoices=invoices_list,
            timeline=timeline,
        )
