"""
be/repositories/dual/bank.py
DualWriteBankRepository
"""
from typing import Dict, Any, Union, Tuple, Optional
from logging_config import get_logger

from repositories.interfaces import BankRepository
from repositories.sheets.bank import SheetsBankRepository
from repositories.sql.bank import SqlBankRepository

logger = get_logger("dual_write")


class DualWriteBankRepository:
    def __init__(self, primary: Optional[BankRepository] = None, shadow: Optional[BankRepository] = None):
        self.primary = primary or SheetsBankRepository()
        self.shadow = shadow or SqlBankRepository()

    def get_by_employee_id(self, employee_id: Union[int, str], reveal: bool = False) -> Dict[str, Any]:
        return self.primary.get_by_employee_id(employee_id, reveal=reveal)

    def upsert(
        self,
        employee_id: Union[int, str],
        bank_name: str,
        iban: str,
        swift_code: str,
        actor_email: str,
    ) -> Tuple[str, Optional[int]]:
        action, record_id = self.primary.upsert(
            employee_id=employee_id,
            bank_name=bank_name,
            iban=iban,
            swift_code=swift_code,
            actor_email=actor_email,
        )
        try:
            self.shadow.upsert(
                employee_id=employee_id,
                bank_name=bank_name,
                iban=iban,
                swift_code=swift_code,
                actor_email=actor_email,
            )
        except Exception:
            logger.exception("Dual-write shadow upsert bank account failed for employee_id=%s", employee_id)
        return action, record_id
