"""
routers/system.py
Health check and audit log endpoints. Moved from main.py during the
router-decomposition refactor - pure structural move, no behavior change.
"""
from datetime import datetime

from fastapi import APIRouter, Depends

import sheets_client
from auth import require_admin

router = APIRouter(prefix="/api", tags=["System"])


@router.get("/audit-log")
def get_audit_log(current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    entries = client.get_all_records("AuditLog")
    entries.sort(key=lambda e: str(e.get("timestamp", "")), reverse=True)
    return entries


@router.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}
