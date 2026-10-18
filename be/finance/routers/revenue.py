"""
be/finance/routers/revenue.py
Revenue sources and revenue receipts (X4, D-029).
Read = finance.account.read, write = finance.account.write (the same permissions as the manual ledger entry).
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from core.permissions import require_permission
from db import get_db
from finance import books
from finance.schemas import (
    RevenueReceiptCreate,
    RevenueReceiptResponse,
    RevenueReceiptReverse,
    RevenueSourceCreate,
    RevenueSourceResponse,
    RevenueSourceUpdate,
)
from finance.services.revenue_service import RevenueService

router = APIRouter(prefix="/api/finance", tags=["Finance - Revenue"])


def get_revenue_service(db: Session = Depends(get_db)) -> RevenueService:
    return RevenueService(db)


def _email(current_user) -> str:
    return (current_user.get("email") or current_user.get("sub")) if isinstance(current_user, dict) else "user"


@router.get("/revenue-sources", response_model=List[RevenueSourceResponse])
def list_revenue_sources(
    is_active: Optional[bool] = Query(None),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: RevenueService = Depends(get_revenue_service),
):
    return service.list_sources(is_active=is_active)


@router.post("/revenue-sources", response_model=RevenueSourceResponse, status_code=status.HTTP_201_CREATED)
def create_revenue_source(
    payload: RevenueSourceCreate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: RevenueService = Depends(get_revenue_service),
):
    return service.create_source(payload)


@router.patch("/revenue-sources/{source_id}", response_model=RevenueSourceResponse)
def update_revenue_source(
    source_id: int,
    payload: RevenueSourceUpdate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: RevenueService = Depends(get_revenue_service),
):
    return service.update_source(source_id, payload)


@router.get("/revenue-receipts", response_model=List[RevenueReceiptResponse])
def list_revenue_receipts(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    revenue_source_id: Optional[int] = Query(None),
    product_id: Optional[int] = Query(None),
    customer_id: Optional[int] = Query(None),
    book: Optional[str] = Query(None, description="local | overseas | consolidated; omitted = every account"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: RevenueService = Depends(get_revenue_service),
):
    return service.list_receipts(date_from, date_to, revenue_source_id, product_id, customer_id, books.validate_view(book), limit, offset)


@router.post("/revenue-receipts", response_model=RevenueReceiptResponse, status_code=status.HTTP_201_CREATED)
def record_revenue_receipt(
    payload: RevenueReceiptCreate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: RevenueService = Depends(get_revenue_service),
):
    """Records money received on any account with its source, product, customer, period and memo gross/fees."""
    return service.create_receipt(payload, created_by=_email(current_user))


@router.get("/revenue-receipts/{receipt_id}", response_model=RevenueReceiptResponse)
def get_revenue_receipt(
    receipt_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: RevenueService = Depends(get_revenue_service),
):
    return service.get_receipt(receipt_id)


@router.post("/revenue-receipts/{receipt_id}/reverse", response_model=RevenueReceiptResponse, status_code=status.HTTP_201_CREATED)
def reverse_revenue_receipt(
    receipt_id: int,
    payload: RevenueReceiptReverse,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: RevenueService = Depends(get_revenue_service),
):
    """Corrects a receipt with a reversing ledger row; receipts are never deleted."""
    return service.reverse_receipt(receipt_id, payload, created_by=_email(current_user))


@router.post("/revenue-receipts/{receipt_id}/attachment", response_model=RevenueReceiptResponse)
async def upload_revenue_receipt_attachment(
    receipt_id: int,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: RevenueService = Depends(get_revenue_service),
):
    return await service.upload_attachment(receipt_id, file, uploaded_by=_email(current_user))


@router.get("/revenue-receipts/{receipt_id}/attachment")
def download_revenue_receipt_attachment(
    receipt_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: RevenueService = Depends(get_revenue_service),
):
    path, filename, media_type = service.get_attachment_file(receipt_id)
    return FileResponse(path=path, filename=filename, media_type=media_type)
