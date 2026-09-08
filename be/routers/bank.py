"""
routers/bank.py
Backward-compatibility alias pointing to employee_bank_accounts.py.
"""
from routers.employee_bank_accounts import (
    router,
    get_bank_account,
    upsert_bank_account,
)

__all__ = ["router", "get_bank_account", "upsert_bank_account"]
