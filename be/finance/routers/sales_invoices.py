"""
be/finance/routers/sales_invoices.py
Production router for Sales Invoices (Accounts Receivable).
Full CRUD + payment recording, gated with RBAC permissions:
 - finance.invoice.read  (list, get, list payments)
 - finance.invoice.write (create, update, void, record payment)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status

from core.permissions import require_permission
from finance.schemas import (
    SalesInvoiceCreate,
    SalesInvoiceUpdate,
    SalesInvoiceResponse,
    PaymentCreate,
    PaymentResponse,
)
from finance.services.invoices_service import InvoicesService
from finance.deps import get_invoices_service

router = APIRouter(prefix="/api/finance/invoices", tags=["Finance - Sales Invoices"])


@router.get("", response_model=List[SalesInvoiceResponse])
def list_sales_invoices(
    status: Optional[str] = Query(None, description="Filter by status: draft|sent|paid|overdue|void"),
    customer_id: Optional[int] = Query(None, description="Filter by customer ID"),
    search: Optional[str] = Query(None, description="Search by invoice number or customer name"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.invoice.read")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """List sales invoices with optional status, customer, and search filters."""
    return service.list_invoices(
        status=status, customer_id=customer_id, search=search, limit=limit, offset=offset
    )


@router.get("/{invoice_id}", response_model=SalesInvoiceResponse)
def get_sales_invoice(
    invoice_id: int,
    current_user: dict = Depends(require_permission("finance.invoice.read")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """Fetch a single invoice by ID (includes all line items)."""
    return service.get_invoice(invoice_id)


@router.post("", response_model=SalesInvoiceResponse, status_code=status.HTTP_201_CREATED)
def create_sales_invoice(
    payload: SalesInvoiceCreate,
    current_user: dict = Depends(require_permission("finance.invoice.write")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """Create a new sales invoice with optional line items."""
    return service.create_invoice(payload)


@router.put("/{invoice_id}", response_model=SalesInvoiceResponse)
def update_sales_invoice(
    invoice_id: int,
    payload: SalesInvoiceUpdate,
    current_user: dict = Depends(require_permission("finance.invoice.write")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """Update an invoice's fields and/or replace its line items."""
    return service.update_invoice(invoice_id, payload)


@router.delete("/{invoice_id}", response_model=SalesInvoiceResponse)
def void_sales_invoice(
    invoice_id: int,
    current_user: dict = Depends(require_permission("finance.invoice.write")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """Void an invoice (irreversible soft-delete via status change)."""
    return service.void_invoice(invoice_id)


# ── Payments ──────────────────────────────────────────────────────────────────

@router.get("/{invoice_id}/payments", response_model=List[PaymentResponse])
def list_invoice_payments(
    invoice_id: int,
    current_user: dict = Depends(require_permission("finance.invoice.read")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """List all incoming payments recorded against this invoice."""
    return service.list_payments(invoice_id)


@router.post(
    "/{invoice_id}/payments",
    response_model=PaymentResponse,
    status_code=status.HTTP_201_CREATED,
)
def record_invoice_payment(
    invoice_id: int,
    payload: PaymentCreate,
    current_user: dict = Depends(require_permission("finance.invoice.write")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """
    Record an incoming payment against a sales invoice.
    Automatically adjusts the bank account balance and marks the invoice
    as 'paid' once total payments >= invoice total.
    """
    return service.record_payment(invoice_id, payload)
