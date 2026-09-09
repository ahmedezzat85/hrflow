"""
be/finance/routers/reports.py
Placeholder router for Financial Reporting & Dashboard KPIs.
Gated with RBAC permission 'finance.report.read'.
"""
from typing import Dict, Any
from fastapi import APIRouter, Depends

from core.permissions import require_permission

router = APIRouter(prefix="/api/finance/reports", tags=["Finance - Reports"])


@router.get("/summary", response_model=Dict[str, Any])
def get_finance_summary(
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """Placeholder KPI metric summary for executive finance dashboard."""
    return {
        "balance": 245000.0,
        "revenue_mtd": 48200.0,
        "cost_mtd": 31400.0,
        "net_mtd": 16800.0,
        "currency": "USD",
        "open_invoices_count": 2,
        "unpaid_bills_count": 1,
        "active_subscriptions_count": 2,
    }
