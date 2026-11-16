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

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from sqlalchemy.orm import Session

from auth import get_current_user
from core.permissions import AccessContext, get_access_context, get_current_user_permissions, require_permission
from db import get_db
from finance import import_config as cfg
from finance.import_report import ImportLimitsResponse, ImportReport
from finance.services import import_batches_read
from finance.services.import_service import ImportActor, ImportService
from finance.services import bills_importer  # noqa: F401  (registers the bills importer)
from finance.services import cheques_importer  # noqa: F401  (registers the cheques importer)
from finance.services import invoices_importer  # noqa: F401  (registers the invoices importer)
from finance.services import transfers_importer  # noqa: F401  (registers the transfers importer)
from finance.services import bank_fees_importer  # noqa: F401  (registers the bank_fees importer)

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


@router.get("/batches")
def list_import_batches(
    kind: Optional[str] = Query(None, description="bills | cheques | invoices | transfers | bank_fees"),
    date_from: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="Runs committed on or after (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="Runs committed on or before (YYYY-MM-DD)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.account.read")),
    db: Session = Depends(get_db),
):
    """Committed import runs with their counts, newest first. Read-only."""
    return import_batches_read.list_batches(db, kind, date_from, date_to, limit, offset)


@router.get("/batches/{batch_id}/rows")
def list_import_batch_rows(
    batch_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.account.read")),
    db: Session = Depends(get_db),
):
    """What a committed run created, row by row (row_ref, record kind, record id, number). Failed rows are not stored."""
    found = import_batches_read.batch_rows(db, batch_id, limit, offset)
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch not found.")
    batch, total, rows = found
    return {"batch": batch, "matching_rows": total, "rows": rows}


@router.post("/{kind}/dry-run", response_model=ImportReport)
async def dry_run_import(
    kind: str,
    manifest: UploadFile = File(...),
    archive: Optional[UploadFile] = File(None),
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
    archive: Optional[UploadFile] = File(None),
    confirm_posting: bool = Form(False),
    current_user: dict = Depends(require_import_permission),
    access: AccessContext = Depends(get_access_context),
    service: ImportService = Depends(get_import_service),
):
    """Re-validate the same package and create the records, one transaction per row. Bills, cheques and invoices
    are Drafts; rows that pay a bill or move money post to the ledger and need `confirm_posting` (D-052)."""
    return await service.run(kind, manifest, archive, _actor(access), commit=True, confirm_posting=confirm_posting)
