"""
be/finance/routers/commissions.py
Sales commissions: salespeople and the quarterly report.
- finance.commission.read (commission list, report; also the salespeople list)
- finance.customer.write may also list salespeople, to fill the customer form's salesperson picker
- finance.commission.write (create, update, deactivate salespeople)
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.permissions import AccessContext, get_access_context, require_permission
from db import get_db
from finance.schemas import (
    CommissionLine,
    CommissionQuarterReport,
    SalespersonCreate,
    SalespersonResponse,
    SalespersonUpdate,
)
from finance.services.commissions_service import CommissionsService, quarter_bounds

router = APIRouter(prefix="/api/finance", tags=["Finance - Commissions"])


def get_commissions_service(db: Session = Depends(get_db)) -> CommissionsService:
    return CommissionsService(db)


def _salespeople_read_guard(access: AccessContext = Depends(get_access_context)) -> AccessContext:
    perms = access.permissions
    if access.is_super_admin or "finance.commission.read" in perms or "finance.customer.write" in perms:
        return access
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: 'finance.commission.read' required")


_salespeople_read_guard.hrflow_permission = "finance.commission.read"


@router.get("/salespeople", response_model=List[SalespersonResponse])
def list_salespeople(
    is_active: Optional[bool] = Query(None),
    access: AccessContext = Depends(_salespeople_read_guard),
    service: CommissionsService = Depends(get_commissions_service),
):
    return service.list_salespeople(is_active=is_active)


@router.post("/salespeople", response_model=SalespersonResponse, status_code=status.HTTP_201_CREATED)
def create_salesperson(
    payload: SalespersonCreate,
    current_user: dict = Depends(require_permission("finance.commission.write")),
    service: CommissionsService = Depends(get_commissions_service),
):
    return service.create_salesperson(payload)


@router.patch("/salespeople/{salesperson_id}", response_model=SalespersonResponse)
def update_salesperson(
    salesperson_id: int,
    payload: SalespersonUpdate,
    current_user: dict = Depends(require_permission("finance.commission.write")),
    service: CommissionsService = Depends(get_commissions_service),
):
    """Updates a salesperson. Deactivate with is_active=false; salespeople are never deleted (commissions keep the link)."""
    return service.update_salesperson(salesperson_id, payload)


@router.get("/commissions", response_model=List[CommissionLine])
def list_commissions(
    salesperson_id: Optional[int] = Query(None),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    quarter: Optional[int] = Query(None, ge=1, le=4, description="Needs year"),
    status_filter: str = Query("accrued", alias="status", pattern="^(accrued|void|all)$"),
    current_user: dict = Depends(require_permission("finance.commission.read")),
    service: CommissionsService = Depends(get_commissions_service),
):
    start = end = None
    if year and quarter:
        start, end = quarter_bounds(year, quarter)
    elif year:
        start, end = f"{year:04d}-01-01", f"{year:04d}-12-31"
    return service.list_commissions(salesperson_id=salesperson_id, start=start, end=end, status=status_filter)


@router.get("/commissions/report", response_model=CommissionQuarterReport)
def commission_quarter_report(
    year: Optional[int] = Query(None, ge=2000, le=2100),
    quarter: Optional[int] = Query(None, ge=1, le=4),
    salesperson_id: Optional[int] = Query(None),
    current_user: dict = Depends(require_permission("finance.commission.read")),
    service: CommissionsService = Depends(get_commissions_service),
):
    """Accrued commissions earned in a calendar quarter (by the date the invoice became fully paid), per salesperson."""
    today = datetime.utcnow()
    year = year or today.year
    quarter = quarter or (today.month - 1) // 3 + 1
    return service.quarter_report(year, quarter, salesperson_id=salesperson_id)
