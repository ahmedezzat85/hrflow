"""
routers/system.py
Health check and audit log endpoints. Moved from main.py during the
router-decomposition refactor - pure structural move, no behavior change.
"""
from datetime import datetime

from fastapi import APIRouter, Depends

from auth import require_admin
from repositories.interfaces import AuditRepository
from repositories.deps import get_audit_repo

router = APIRouter(prefix="/api", tags=["System"])


@router.get("/audit-log")
def get_audit_log(
    current_user: dict = Depends(require_admin),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    return audit_repo.list_all()


@router.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}
