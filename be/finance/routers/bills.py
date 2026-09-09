"""
be/finance/routers/bills.py
Placeholder router for Vendor Bills (Accounts Payable).
Gated with RBAC permission 'finance.bill.read'.
"""
from typing import List, Dict, Any
from fastapi import APIRouter, Depends

from core.permissions import require_permission

router = APIRouter(prefix="/api/finance/bills", tags=["Finance - Bills"])


@router.get("", response_model=List[Dict[str, Any]])
def list_vendor_bills(
    current_user: dict = Depends(require_permission("finance.bill.read")),
):
    """Placeholder list of vendor bills."""
    return [
        {
            "id": 1,
            "bill_number": "BILL-2026-0901",
            "vendor_name": "Amazon Web Services",
            "category": "Cloud Infrastructure",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-25",
            "subtotal": 3120.0,
            "tax_amount": 0.0,
            "total": 3120.0,
            "currency": "USD",
            "status": "unpaid",
            "notes": "Production cluster GPU hosting",
        },
        {
            "id": 2,
            "bill_number": "BILL-2026-0902",
            "vendor_name": "Atlassian Corp",
            "category": "Software Subscriptions",
            "issue_date": "2026-09-03",
            "due_date": "2026-09-18",
            "subtotal": 450.0,
            "tax_amount": 0.0,
            "total": 450.0,
            "currency": "USD",
            "status": "paid",
            "notes": "Jira & Confluence team licenses",
        },
    ]
