"""
routers/holidays.py
Official company holidays. Everyone who can see vacations reads the list; managing it needs the
vacation write permission. Leave requests exclude these days (see routers/vacations.py).
"""
from datetime import date, datetime
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query

from core.permissions import require_permission
from deps import audit_log, permission_scope, Scope
from models import HolidayCreate
from repositories.interfaces import AuditRepository, HolidayRepository
from repositories.deps import get_audit_repo, get_holiday_repo

router = APIRouter(prefix="/api/holidays", tags=["Holidays"])


def _clean(payload: HolidayCreate) -> Tuple[str, str, str]:
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Holiday name is required.")
    try:
        start = date.fromisoformat(payload.start_date)
        end = date.fromisoformat(payload.end_date or payload.start_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Dates must be valid YYYY-MM-DD.")
    if end < start:
        raise HTTPException(status_code=422, detail="End date cannot be earlier than start date.")
    return name, start.isoformat(), end.isoformat()


@router.get("")
def list_holidays(
    year: Optional[int] = Query(None, ge=1900, le=2999),
    _scope: Scope = Depends(permission_scope("hr.vacation.read", "self.vacation.read")),
    holiday_repo: HolidayRepository = Depends(get_holiday_repo),
):
    """Holidays that touch the year (default: the current year)."""
    year = year or datetime.utcnow().year
    return holiday_repo.list_overlapping(f"{year}-01-01", f"{year}-12-31")


@router.post("", status_code=201)
def create_holiday(
    payload: HolidayCreate,
    current_user: dict = Depends(require_permission("hr.vacation.write")),
    holiday_repo: HolidayRepository = Depends(get_holiday_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    name, start, end = _clean(payload)
    holiday_id = holiday_repo.create(name, start, end, current_user.get("email", ""))
    audit_log(audit_repo, "holiday.create", current_user.get("email"), "holiday", holiday_id, f"{name}: {start} to {end}")
    return {"message": "Holiday added", "id": holiday_id}


@router.put("/{holiday_id}")
def update_holiday(
    holiday_id: int,
    payload: HolidayCreate,
    current_user: dict = Depends(require_permission("hr.vacation.write")),
    holiday_repo: HolidayRepository = Depends(get_holiday_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    name, start, end = _clean(payload)
    if not holiday_repo.update(holiday_id, name, start, end):
        raise HTTPException(status_code=404, detail="Holiday not found.")
    audit_log(audit_repo, "holiday.update", current_user.get("email"), "holiday", holiday_id, f"{name}: {start} to {end}")
    return {"message": "Holiday updated"}


@router.delete("/{holiday_id}")
def delete_holiday(
    holiday_id: int,
    current_user: dict = Depends(require_permission("hr.vacation.write")),
    holiday_repo: HolidayRepository = Depends(get_holiday_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    if not holiday_repo.delete(holiday_id):
        raise HTTPException(status_code=404, detail="Holiday not found.")
    audit_log(audit_repo, "holiday.delete", current_user.get("email"), "holiday", holiday_id)
    return {"message": "Holiday deleted"}
