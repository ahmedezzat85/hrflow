"""
be/repositories/dual/audit.py
DualWriteAuditRepository
"""
from typing import Optional, List, Dict, Any, Union
from logging_config import get_logger

from repositories.interfaces import AuditRepository
from repositories.sheets.audit import SheetsAuditRepository
from repositories.sql.audit import SqlAuditRepository

logger = get_logger("dual_write")


class DualWriteAuditRepository:
    def __init__(self, primary: Optional[AuditRepository] = None, shadow: Optional[AuditRepository] = None):
        self.primary = primary or SqlAuditRepository()
        self.shadow = shadow or SheetsAuditRepository()

    def list_all(self) -> List[Dict[str, Any]]:
        return self.primary.list_all()

    def log(
        self,
        action: str,
        actor_email: str,
        target_type: str,
        target_id: Union[str, int],
        details: str = "",
    ) -> None:
        self.primary.log(action, actor_email, target_type, target_id, details)
        try:
            self.shadow.log(action, actor_email, target_type, target_id, details)
        except Exception:
            logger.exception("Dual-write shadow audit log failed for action=%s", action)
