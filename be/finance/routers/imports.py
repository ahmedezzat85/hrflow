"""
be/finance/routers/imports.py
Bulk / historical import (D-033): upload a manifest + ZIP, dry run, then commit Draft records.

Permissions mirror the target entity (no new permission):
 - bills    -> finance.bill.write
 - cheques  -> finance.account.write
 - invoices -> finance.invoice.write
The kind is part of the path, so the guard resolves the key per request; the route-level marker lists the
three keys for the route-coverage walker, and the per-kind check below is the enforcement.
"""
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from auth import get_current_user
from core.permissions import AccessContext, get_access_context, get_current_user_permissions
from db import get_db
from finance import import_config as cfg
from finance.import_report import ImportLimitsResponse, ImportReport
from finance.services.import_service import ImportActor, ImportService
from finance.services import bills_importer  # noqa: F401  (registers the bills importer)

router = APIRouter(prefix="/api/finance/imports", tags=["Finance - Bulk Import"])


def require_import_permission(
    request: Request,
    kind: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """With a kind in the path: that kind's write permission. Without one (limits): any of the three."""
    perms = get_current_user_permissions(request, current_user=current_user, db=db)
    ctx = getattr(request.state, "access_context", None)
    is_admin = bool(current_user.get("is_super_admin") or (ctx and ctx.is_super_admin))
    if kind is None:
        if is_admin or any(p in perms for p in cfg.KIND_PERMISSIONS.values()):
            return current_user
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: an import permission is required")
    required = cfg.KIND_PERMISSIONS.get(kind)
    if required is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown import kind '{kind}'")
    if not is_admin and required not in perms:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Permission denied: '{required}' required")
    return current_user


require_import_permission.hrflow_permission_any = tuple(sorted(set(cfg.KIND_PERMISSIONS.values())))


def get_import_service(db: Session = Depends(get_db)) -> ImportService:
    from repositories.sql.audit import SqlAuditRepository

    return ImportService(db, audit=SqlAuditRepository())


def _actor(access: AccessContext) -> ImportActor:
    return ImportActor(
        email=access.email,
        is_super_admin=access.is_super_admin,
        permissions=frozenset(access.permissions),
    )


@router.get("/limits", response_model=ImportLimitsResponse)
def get_import_limits(
    current_user: dict = Depends(require_import_permission),
    access: AccessContext = Depends(get_access_context),
):
    kinds = [k for k, p in cfg.KIND_PERMISSIONS.items() if access.is_super_admin or p in access.permissions]
    return ImportLimitsResponse(
        kinds=kinds,
        max_documents_per_run=cfg.MAX_DOCUMENTS_PER_RUN,
        max_request_bytes=cfg.MAX_REQUEST_BYTES,
        max_file_bytes=cfg.MAX_FILE_BYTES,
        allowed_extensions=list(cfg.ALLOWED_EXTENSIONS),
        low_confidence_threshold=cfg.LOW_CONFIDENCE_THRESHOLD,
    )


@router.post("/{kind}/dry-run", response_model=ImportReport)
async def dry_run_import(
    kind: str,
    manifest: UploadFile = File(...),
    archive: UploadFile = File(...),
    current_user: dict = Depends(require_import_permission),
    access: AccessContext = Depends(get_access_context),
    service: ImportService = Depends(get_import_service),
):
    """Validate the package and report per row. Writes nothing."""
    return await service.run(kind, manifest, archive, _actor(access), commit=False)


@router.post("/{kind}", response_model=ImportReport)
async def commit_import(
    kind: str,
    manifest: UploadFile = File(...),
    archive: UploadFile = File(...),
    current_user: dict = Depends(require_import_permission),
    access: AccessContext = Depends(get_access_context),
    service: ImportService = Depends(get_import_service),
):
    """Re-validate the same package and create Draft records, one transaction per row."""
    return await service.run(kind, manifest, archive, _actor(access), commit=True)
