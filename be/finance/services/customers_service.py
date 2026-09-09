"""
be/finance/services/customers_service.py
Business logic and validation for Finance Customers.
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.customers_repository import CustomersRepository
from finance.schemas import CustomerCreate, CustomerUpdate, CustomerResponse
from finance.models import CustomerDB


class CustomersService:
    def __init__(self, repo: CustomersRepository):
        self.repo = repo

    def to_response(self, customer: CustomerDB) -> CustomerResponse:
        return CustomerResponse(
            id=customer.id,
            name=customer.name,
            contact_email=customer.contact_email,
            contact_phone=customer.contact_phone,
            tax_id=customer.tax_id,
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
