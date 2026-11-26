"""
routers/system.py
Health check and audit log endpoints. Moved from main.py during the
router-decomposition refactor - pure structural move, no behavior change.
"""
from datetime import datetime

from typing import Optional

from fastapi import APIRouter, Depends, Query, Response

from core.permissions import require_permission
from repositories.interfaces import AuditRepository
from repositories.deps import get_audit_repo

router = APIRouter(prefix="/api", tags=["System"])


@router.get("/audit-log")
def get_audit_log(
    response: Response,
    limit: int = Query(200, ge=1, le=1000, description="Rows per page, newest first"),
    offset: int = Query(0, ge=0),
    action: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    target_id: Optional[str] = Query(None),
    actor_email: Optional[str] = Query(None),
    current_user: dict = Depends(require_permission("system.audit.read")),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    """Audit entries, newest first, one page at a time (it used to return the whole table on every call). The body
    is still a plain list; X-Total-Count gives the number of matching entries for paging."""
    rows, total = audit_repo.list_page(limit=limit, offset=offset, action=action, target_type=target_type,
                                       target_id=target_id, actor_email=actor_email)
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}
