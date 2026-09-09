"""
be/finance/routers/subscriptions.py
Placeholder router for Recurring Vendor Subscriptions.
Gated with RBAC permission 'finance.subscription.read'.
"""
from typing import List, Dict, Any
from fastapi import APIRouter, Depends

from core.permissions import require_permission

router = APIRouter(prefix="/api/finance/subscriptions", tags=["Finance - Subscriptions"])


@router.get("", response_model=List[Dict[str, Any]])
def list_vendor_subscriptions(
    current_user: dict = Depends(require_permission("finance.subscription.read")),
):
    """Placeholder list of recurring vendor subscriptions."""
    return [
        {
            "id": 1,
            "name": "Google Workspace Enterprise",
            "vendor_name": "Google LLC",
            "amount": 1200.0,
            "currency": "USD",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-10-01",
            "auto_generate_bill": True,
            "is_active": True,
            "notes": "Corporate emails and drive licenses",
        },
        {
            "id": 2,
            "name": "GitHub Enterprise Cloud",
            "vendor_name": "GitHub Inc",
            "amount": 420.0,
            "currency": "USD",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-09-22",
            "auto_generate_bill": True,
            "is_active": True,
            "notes": "CI/CD runners and repository seats",
        },
    ]
