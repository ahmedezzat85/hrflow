"""
be/repositories/sql/audit.py
SQLAlchemy-backed implementation of AuditRepository.
"""
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple, Union

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

    def list_page(
        self,
        limit: int = 200,
        offset: int = 0,
        action: Optional[str] = None,
        target_type: Optional[str] = None,
        target_id: Optional[str] = None,
        actor_email: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Newest first, filtered and paged in the database. Returns (rows, total matching)."""
        with self._get_session() as db:
            q = db.query(AuditLogDB)
            if action:
                q = q.filter(AuditLogDB.action == action)
            if target_type:
                q = q.filter(AuditLogDB.target_type == target_type)
            if target_id is not None and target_id != "":
                q = q.filter(AuditLogDB.target_id == str(target_id))
            if actor_email:
                q = q.filter(AuditLogDB.actor_email.ilike(actor_email.strip()))
            total = q.count()
            rows = q.order_by(AuditLogDB.id.desc()).offset(max(offset, 0)).limit(max(limit, 0)).all()
            return [_audit_to_dict(a) for a in rows], total

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
