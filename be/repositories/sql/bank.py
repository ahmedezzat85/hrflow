"""
be/repositories/sql/bank.py
Backward-compatibility alias pointing to employee_bank_accounts.py.
"""
from repositories.sql.employee_bank_accounts import (
    SqlEmployeeBankAccountRepository,
    SqlBankRepository,
    _mask_iban,
)

__all__ = ["SqlEmployeeBankAccountRepository", "SqlBankRepository", "_mask_iban"]
