"""
be/finance/routers/payroll.py
Placeholder router for Company Payroll Runs and Employee Payslips.
"""
from typing import List, Dict, Any
from fastapi import APIRouter, Depends

from core.permissions import require_permission

router = APIRouter(prefix="/api/finance/payroll", tags=["Finance - Payroll"])


@router.get("/runs", response_model=List[Dict[str, Any]])
def list_payroll_runs(
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Placeholder list of company payroll runs."""
    return [
        {
            "id": 1,
            "period_label": "2026-08",
            "period_start": "2026-08-01",
            "period_end": "2026-08-31",
            "status": "paid",
            "total_gross": 135000.0,
            "total_tax": 12000.0,
            "total_deductions": 11000.0,
            "total_net": 112000.0,
            "total_employer_cost": 142000.0,
            "bank_account_name": "Operating Account - JPMorgan",
            "approved_at": "2026-08-28T10:00:00Z",
            "paid_at": "2026-08-31T14:30:00Z",
        },
        {
            "id": 2,
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "status": "draft",
            "total_gross": 138000.0,
            "total_tax": 12500.0,
            "total_deductions": 11200.0,
            "total_net": 114300.0,
            "total_employer_cost": 145000.0,
            "bank_account_name": "Operating Account - JPMorgan",
            "approved_at": None,
            "paid_at": None,
        },
    ]


@router.get("/payslips/my", response_model=List[Dict[str, Any]])
def list_my_payslips(
    current_user: dict = Depends(require_permission("self.payslip.read")),
):
    """Placeholder list of employee personal payslips."""
    return [
        {
            "id": 101,
            "period_label": "2026-08",
            "period_start": "2026-08-01",
            "period_end": "2026-08-31",
            "base_salary": 4500.0,
            "allowances_total": 500.0,
            "deductions_total": 400.0,
            "tax_amount": 350.0,
            "net_pay": 4250.0,
            "currency": "USD",
            "status": "paid",
            "paid_date": "2026-08-31",
        }
    ]
