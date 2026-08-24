"""
be/repositories/sql/audit.py
SQLAlchemy-backed implementation of AuditRepository.
"""
from datetime import datetime
from typing import List, Dict, Any, Union

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import AuditLogDB
from logging_config import get_logger

logger = get_logger("audit")


def _audit_to_dict(a: AuditLogDB) -> dict:
    return {
        "id": a.id,
        "timestamp": a.timestamp or "",
        "actor_email": a.actor_email or "",
        "action": a.action or "",
        "target_type": a.target_type or "",
        "target_id": a.target_id or "",
        "details": a.details or "",
    }


class SqlAuditRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def list_all(self) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            entries = db.query(AuditLogDB).order_by(AuditLogDB.id.desc()).all()
            return [_audit_to_dict(a) for a in entries]

    def log(
        self,
        action: str,
        actor_email: str,
        target_type: str,
        target_id: Union[str, int],
        details: str = "",
    ) -> None:
        try:
            with self._get_session() as db:
                entry = AuditLogDB(
                    timestamp=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                    actor_email=actor_email,
                    action=action,
                    target_type=target_type,
                    target_id=str(target_id),
                    details=details,
                )
                db.add(entry)
                db.commit()
        except Exception:
            logger.exception(
                "SQL Audit log write failed for action=%s, target_type=%s, target_id=%s - operation proceeds regardless",
                action, target_type, target_id
            )
