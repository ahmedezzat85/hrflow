"""
be/repositories/dual/vacations.py
DualWriteVacationRepository
"""
from typing import Optional, List, Dict, Any, Union
from logging_config import get_logger

from repositories.interfaces import VacationRepository
from repositories.sheets.vacations import SheetsVacationRepository
from repositories.sql.vacations import SqlVacationRepository

logger = get_logger("dual_write")


class DualWriteVacationRepository:
    def __init__(self, primary: Optional[VacationRepository] = None, shadow: Optional[VacationRepository] = None):
        self.primary = primary or SqlVacationRepository()
        self.shadow = shadow or SheetsVacationRepository()

    def get_history(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        return self.primary.get_history(scoped_employee_id=scoped_employee_id)

    def create_vacation_request(
        self,
        vacation_data: Dict[str, Any],
        request_data: Dict[str, Any],
    ) -> int:
        vac_id = self.primary.create_vacation_request(vacation_data, request_data)
        try:
            self.shadow.create_vacation_request(vacation_data, request_data)
        except Exception:
            logger.exception("Dual-write shadow create_vacation_request failed for employee_id=%s", vacation_data.get("employee_id"))
        return vac_id
