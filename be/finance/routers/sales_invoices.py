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
from finance.deps import get_invoices_service, get_idempotency_key, get_idempotency_service
from finance.services.idempotency import IdempotencyService

router = APIRouter(prefix="/api/finance/invoices", tags=["Finance - Sales Invoices"])


@router.get("", response_model=List[SalesInvoiceResponse])
def list_sales_invoices(
    status: Optional[str] = Query(None, description="Filter by status: open|draft|sent|awaiting_payment|paid|overdue|void|all"),
    customer_id: Optional[int] = Query(None, description="Filter by customer ID"),
    search: Optional[str] = Query(None, description="Search by invoice number or customer name"),
    currency: Optional[str] = Query(None, description="Filter by currency: USD, EGP, all"),
    revenue_channel: Optional[str] = Query(None, description="Filter by revenue channel"),
    date_from: Optional[str] = Query(None, description="Issue date from (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Issue date to (YYYY-MM-DD)"),
    due_date_from: Optional[str] = Query(None, description="Due date from (YYYY-MM-DD)"),
    due_date_to: Optional[str] = Query(None, description="Due date to (YYYY-MM-DD)"),
    payment_state: Optional[str] = Query(None, description="Filter by payment state: unpaid|partially_paid|paid|all"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.invoice.read")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """List sales invoices with status, work queue, and date filters."""
    return service.list_invoices(
        status=status,
        customer_id=customer_id,
        search=search,
        currency=currency,
        revenue_channel=revenue_channel,
        date_from=date_from,
        date_to=date_to,
        due_date_from=due_date_from,
        due_date_to=due_date_to,
        payment_state=payment_state,
        limit=limit,
        offset=offset,
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
    idempotency_key: Optional[str] = Depends(get_idempotency_key),
    idempotency: IdempotencyService = Depends(get_idempotency_service),
):
    """Create a new sales invoice with optional line items."""
    user_email = current_user.get("email") or current_user.get("sub") or "user"
    return idempotency.execute_idempotent(
        idempotency_key=idempotency_key,
        user_email=user_email,
        endpoint_path="/api/finance/invoices:create",
        operation_fn=lambda: service.create_invoice(payload),
    )


@router.put("/{invoice_id}", response_model=SalesInvoiceResponse)
def update_sales_invoice(
    invoice_id: int,
    payload: SalesInvoiceUpdate,
    current_user: dict = Depends(require_permission("finance.invoice.write")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """Update an invoice's fields and/or replace its line items."""
    return service.update_invoice(invoice_id, payload)


@router.post("/{invoice_id}/send", response_model=SalesInvoiceResponse)
def send_sales_invoice(
    invoice_id: int,
    current_user: dict = Depends(require_permission("finance.invoice.write")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """Transition an invoice to sent/issued status."""
    return service.send_invoice(invoice_id)


@router.delete("/{invoice_id}", response_model=SalesInvoiceResponse)
def void_sales_invoice(
    invoice_id: int,
    reason: Optional[str] = Query(None, description="Reason for voiding the invoice"),
    current_user: dict = Depends(require_permission("finance.invoice.write")),
    service: InvoicesService = Depends(get_invoices_service),
):
    """Void an invoice (irreversible soft-delete via status change)."""
    return service.void_invoice(invoice_id, reason=reason)


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
    idempotency_key: Optional[str] = Depends(get_idempotency_key),
    idempotency: IdempotencyService = Depends(get_idempotency_service),
):
    """
    Record an incoming payment against a sales invoice.
    Automatically adjusts the bank account balance and marks the invoice
    as 'paid' once total payments >= invoice total.
    """
    user_email = current_user.get("email") or current_user.get("sub") or "user"
    return idempotency.execute_idempotent(
        idempotency_key=idempotency_key,
        user_email=user_email,
        endpoint_path=f"/api/finance/invoices:{invoice_id}:payments",
        operation_fn=lambda: service.record_payment(invoice_id, payload),
    )
