"""
be/repositories/sheets/audit.py
Sheets-backed implementation of AuditRepository.
"""
from datetime import datetime
from typing import List, Dict, Any, Union

import sheets_client
from logging_config import get_logger

logger = get_logger("audit")


class SheetsAuditRepository:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        return self._client or sheets_client.get_client()

    def list_all(self) -> List[Dict[str, Any]]:
        entries = self.client.get_all_records("AuditLog")
        entries.sort(key=lambda e: str(e.get("timestamp", "")), reverse=True)
        return entries

    def log(
        self,
        action: str,
        actor_email: str,
        target_type: str,
        target_id: Union[str, int],
        details: str = "",
    ) -> None:
        try:
            entry_id = self.client.next_id("AuditLog")
            self.client.append_row("AuditLog", {
                "id": entry_id,
                "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                "actor_email": actor_email,
                "action": action,
                "target_type": target_type,
                "target_id": str(target_id),
                "details": details,
            })
        except Exception:
            logger.exception(
                "Audit log write failed for action=%s, target_type=%s, target_id=%s - operation proceeds regardless",
                action, target_type, target_id
            )
