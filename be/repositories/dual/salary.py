"""
be/repositories/dual/salary.py
DualWriteSalaryRepository
"""
from typing import Optional, List, Dict, Any, Union
from logging_config import get_logger

from repositories.interfaces import SalaryRepository
from repositories.sheets.salary import SheetsSalaryRepository
from repositories.sql.salary import SqlSalaryRepository

logger = get_logger("dual_write")


class DualWriteSalaryRepository:
    def __init__(self, primary: Optional[SalaryRepository] = None, shadow: Optional[SalaryRepository] = None):
        self.primary = primary or SheetsSalaryRepository()
        self.shadow = shadow or SqlSalaryRepository()

    def get_history(self, employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        return self.primary.get_history(employee_id=employee_id)

    def apply_raise(
        self,
        employee_id: Union[int, str],
        new_internal: float,
        new_external: float,
        effective_date: Optional[str],
        reason: str,
        actor_email: str,
    ) -> Dict[str, Any]:
        result = self.primary.apply_raise(
            employee_id=employee_id,
            new_internal=new_internal,
            new_external=new_external,
            effective_date=effective_date,
            reason=reason,
            actor_email=actor_email,
        )
        try:
            self.shadow.apply_raise(
                employee_id=employee_id,
                new_internal=new_internal,
                new_external=new_external,
                effective_date=effective_date,
                reason=reason,
                actor_email=actor_email,
            )
        except Exception:
            logger.exception("Dual-write shadow apply_raise failed for employee_id=%s", employee_id)
        return result
