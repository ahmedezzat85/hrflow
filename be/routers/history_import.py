"""
routers/history_import.py
Historical leave and work-from-home items (D-051, docs/mcp-server-plan.md). Staging (validate, stage) needs
hr.history_import.write, which the MCP token may hold. Editing, accepting and rejecting need
hr.history_import.review, which is in no token scope, so only a signed-in person can turn an item into a leave record.
"""
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.permissions import require_permission
from db import get_db
from models_db import HistoryImportBatchDB
from services import history_import as service

router = APIRouter(prefix="/api/history-import", tags=["Historical import"])

LeaveType = Literal["Annual Leave", "Sick Leave", "Work From Home", "Unpaid Leave"]


class ImportItemIn(BaseModel):
    employee_id: int
    leave_type: LeaveType
    start_date: str = Field(max_length=10)
    end_date: Optional[str] = Field(default=None, max_length=10)
    decision: Literal["Approved", "Rejected"]
    decided_by: str = Field(default="", max_length=255)
    decided_on: str = Field(default="", max_length=10)
    source_kind: Literal["email", "scan", "manual"]
    source_ref: str = Field(min_length=1, max_length=255)
    source_sha256: str = Field(default="", pattern=r"^([0-9a-fA-F]{64})?$")
    evidence_excerpt: str = Field(default="", max_length=500)
    confidence: Literal["high", "medium", "low"]
    notes: str = Field(default="", max_length=1000)


class ValidateRequest(BaseModel):
    items: List[ImportItemIn] = Field(max_length=service.MAX_ITEMS_PER_BATCH)


class StageRequest(ValidateRequest):
    label: str = Field(min_length=1, max_length=200)


class ItemPatch(BaseModel):
    leave_type: Optional[LeaveType] = None
    start_date: Optional[str] = Field(default=None, max_length=10)
    end_date: Optional[str] = Field(default=None, max_length=10)
    decision: Optional[Literal["Approved", "Rejected"]] = None


class RejectRequest(BaseModel):
    reason: str = Field(default="", max_length=255)


def _items(payload: ValidateRequest) -> List[dict]:
    return [i.model_dump() for i in payload.items]


def _blocked(exc: service.HistoryImportError) -> HTTPException:
    if isinstance(exc, service.NotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, service.Blocked):
        return HTTPException(status_code=409, detail={"message": "This item cannot be applied.", "reasons": exc.reasons})
    return HTTPException(status_code=422, detail={"message": str(exc), "report": getattr(exc, "report", [])})


@router.post("/validate")
def validate_items(payload: ValidateRequest, current_user: dict = Depends(require_permission("hr.history_import.write")),
                   db: Session = Depends(get_db)):
    """Dry run: nothing is written."""
    report = service.validate_items(db, _items(payload))
    return {"ok": all(r["ok"] for r in report), "items": report}


@router.post("/batches", status_code=201)
def stage_batch(payload: StageRequest, response: Response,
                idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key", max_length=100),
                current_user: dict = Depends(require_permission("hr.history_import.write")),
                db: Session = Depends(get_db)):
    try:
        batch, created = service.stage_batch(db, current_user, payload.label, _items(payload), idempotency_key)
    except service.HistoryImportError as exc:
        raise _blocked(exc)
    if not created:
        response.status_code = 200
    return service.serialize_batch(db, batch)


@router.get("/batches")
def list_batches(current_user: dict = Depends(require_permission("hr.history_import.read")), db: Session = Depends(get_db)):
    service.purge_expired_evidence(db)
    batches = db.query(HistoryImportBatchDB).order_by(HistoryImportBatchDB.id.desc()).limit(200).all()
    return [service.serialize_batch(db, b, with_items=False) for b in batches]


@router.get("/batches/{batch_id}")
def get_batch(batch_id: int, current_user: dict = Depends(require_permission("hr.history_import.read")),
              db: Session = Depends(get_db)):
    batch = db.get(HistoryImportBatchDB, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch not found.")
    return service.serialize_batch(db, batch)


@router.patch("/items/{item_id}")
def edit_item(item_id: int, payload: ItemPatch, current_user: dict = Depends(require_permission("hr.history_import.review")),
              db: Session = Depends(get_db)):
    try:
        item = service.update_item(db, item_id, payload.model_dump(exclude_unset=True), current_user["email"])
    except service.HistoryImportError as exc:
        raise _blocked(exc)
    return service.serialize_item(db, item)


@router.post("/items/{item_id}/accept")
def accept_item(item_id: int, current_user: dict = Depends(require_permission("hr.history_import.review")),
                db: Session = Depends(get_db)):
    try:
        item = service.accept_item(db, item_id, current_user["email"])
    except service.HistoryImportError as exc:
        raise _blocked(exc)
    return service.serialize_item(db, item)


@router.post("/items/{item_id}/reject")
def reject_item(item_id: int, payload: RejectRequest,
                current_user: dict = Depends(require_permission("hr.history_import.review")), db: Session = Depends(get_db)):
    try:
        item = service.reject_item(db, item_id, current_user["email"], payload.reason)
    except service.HistoryImportError as exc:
        raise _blocked(exc)
    return service.serialize_item(db, item)
