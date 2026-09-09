"""
be/finance/routers/sales_invoices.py
Placeholder router for Sales Invoices (Accounts Receivable).
Gated with RBAC permission 'finance.invoice.read'.
"""
from typing import List, Dict, Any
from fastapi import APIRouter, Depends

from core.permissions import require_permission

router = APIRouter(prefix="/api/finance/invoices", tags=["Finance - Sales Invoices"])


@router.get("", response_model=List[Dict[str, Any]])
def list_sales_invoices(
    current_user: dict = Depends(require_permission("finance.invoice.read")),
):
    """Placeholder list of customer sales invoices."""
    return [
        {
            "id": 1,
            "invoice_number": "INV-2026-001",
            "customer_name": "Acme Health Systems",
            "contact_email": "billing@acmehealth.com",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "subtotal": 12500.0,
            "tax_amount": 0.0,
            "total": 12500.0,
            "currency": "USD",
            "status": "sent",
            "notes": "Q3 PACS Integration Services",
        },
        {
            "id": 2,
            "invoice_number": "INV-2026-002",
            "customer_name": "Global Medical Diagnostics",
            "contact_email": "accounts@globalmed.org",
            "issue_date": "2026-09-05",
            "due_date": "2026-10-05",
            "subtotal": 8400.0,
            "tax_amount": 0.0,
            "total": 8400.0,
            "currency": "USD",
            "status": "draft",
            "notes": "Monthly DICOM utility SaaS subscription",
        },
    ]
