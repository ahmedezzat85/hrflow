"""
be/repositories/dual/requests.py
DualWriteRequestRepository
"""
from typing import Optional, List, Dict, Any, Union
from logging_config import get_logger

from repositories.interfaces import RequestRepository
from repositories.sheets.requests import SheetsRequestRepository
from repositories.sql.requests import SqlRequestRepository

logger = get_logger("dual_write")


class DualWriteRequestRepository:
    def __init__(self, primary: Optional[RequestRepository] = None, shadow: Optional[RequestRepository] = None):
        self.primary = primary or SheetsRequestRepository()
        self.shadow = shadow or SqlRequestRepository()

    def list_requests(
        self,
        type_filter: Optional[str] = None,
        scoped_employee_id: Optional[Union[int, str]] = None,
    ) -> List[Dict[str, Any]]:
        return self.primary.list_requests(type_filter=type_filter, scoped_employee_id=scoped_employee_id)

    def get_by_id(self, req_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        return self.primary.get_by_id(req_id)

    def create(self, data: Dict[str, Any]) -> int:
        req_id = self.primary.create(data)
        try:
            self.shadow.create(data)
        except Exception:
            logger.exception("Dual-write shadow create request failed for employee_id=%s", data.get("employee_id"))
        return req_id

    def action_request(self, req_id: Union[int, str], status: str, reviewer_email: str) -> bool:
        ok = self.primary.action_request(req_id, status, reviewer_email)
        if ok:
            try:
                self.shadow.action_request(req_id, status, reviewer_email)
            except Exception:
                logger.exception("Dual-write shadow action_request failed for req_id=%s", req_id)
        return ok
