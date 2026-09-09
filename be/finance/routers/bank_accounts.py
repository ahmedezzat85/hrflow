"""
be/finance/routers/bank_accounts.py
Placeholder router for Company Bank Accounts.
Gated with RBAC permission 'finance.account.read'.
"""
from typing import List, Dict, Any
from fastapi import APIRouter, Depends

from core.permissions import require_permission

router = APIRouter(prefix="/api/finance/accounts", tags=["Finance - Bank Accounts"])


@router.get("", response_model=List[Dict[str, Any]])
def list_company_bank_accounts(
    current_user: dict = Depends(require_permission("finance.account.read")),
):
    """Placeholder list of company-level bank accounts."""
    return [
        {
            "id": 1,
            "account_name": "Voyance Operating USD",
            "bank_name": "JPMorgan Chase",
            "account_number": "******4821",
            "currency": "USD",
            "opening_balance": 150000.0,
            "current_balance": 245000.0,
            "is_active": True,
            "notes": "Primary corporate operating account for payroll and billing",
        },
        {
            "id": 2,
            "account_name": "Voyance Treasury Reserve",
            "bank_name": "Silicon Valley Bank",
            "account_number": "******9102",
            "currency": "USD",
            "opening_balance": 500000.0,
            "current_balance": 520000.0,
            "is_active": True,
            "notes": "Reserve funds and money market deposits",
        },
    ]
