"""
be/finance/routers/customers.py
Production router for Finance Customers.
Full CRUD wired to CustomersService and gated with RBAC permissions:
- finance.customer.read (list, get)
- finance.customer.write (create, update, deactivate)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status

from core.permissions import require_permission
from finance.schemas import (
    CustomerCreate,
    CustomerUpdate,
    CustomerResponse,
)
from finance.services.customers_service import CustomersService
from finance.deps import get_customers_service

router = APIRouter(prefix="/api/finance/customers", tags=["Finance - Customers"])


@router.get("", response_model=List[CustomerResponse])
def list_customers(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    search: Optional[str] = Query(None, description="Search by name, email, or tax ID"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.customer.read")),
    service: CustomersService = Depends(get_customers_service),
):
    """Lists finance customers."""
    return service.list_customers(is_active=is_active, search=search, limit=limit, offset=offset)


@router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: int,
    current_user: dict = Depends(require_permission("finance.customer.read")),
    service: CustomersService = Depends(get_customers_service),
):
    """Fetches a specific customer by ID."""
    return service.get_customer(customer_id)


@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: CustomerCreate,
    current_user: dict = Depends(require_permission("finance.customer.write")),
    service: CustomersService = Depends(get_customers_service),
):
    """Creates a new customer."""
    return service.create_customer(payload)


@router.put("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    current_user: dict = Depends(require_permission("finance.customer.write")),
    service: CustomersService = Depends(get_customers_service),
):
    """Updates an existing customer."""
    return service.update_customer(customer_id, payload)


@router.delete("/{customer_id}", response_model=CustomerResponse)
def deactivate_customer(
    customer_id: int,
    current_user: dict = Depends(require_permission("finance.customer.write")),
    service: CustomersService = Depends(get_customers_service),
):
    """Deactivates (soft-deletes) an existing customer."""
    return service.soft_delete_customer(customer_id)
