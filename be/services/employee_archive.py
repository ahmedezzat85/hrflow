"""
be/services/employee_archive.py
Archiving an employee: they have left or are set aside, but every record about them stays (pay history, documents, notes).
- employees.archived_at / archived_by hold the state; the API reports status "Archived" while it is set and the saved status
  (Active, On Leave, Suspended) comes back on unarchive.
- The linked login user is archived with them, so they can no longer sign in (same rules as archiving a user: nobody can
  archive their own user, nor the last active Super-Admin). An archived user is never restored (RBAC F5: no restore
  control for users), so unarchiving the employee leaves the login archived; the response says so.
- Archiving can carry the real last day of employment (`left_date`, YYYY-MM-DD, not in the future). Then every pay row of the
  employee that is open or runs past that day (compensation plan, social insurance, tax method) ends on it, so historical payroll
  runs after it leave the employee out. A pay row that starts after the left date stops the archive (409). Unarchiving clears the
  left date but does not reopen the pay rows.
- An archived employee is left out of current and future payroll runs and of new salary documents; historical payroll
  periods still include them if they had a pay plan then.
"""
from datetime import date, datetime
from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.access_service import AccessService
from deps import audit_log
from finance.models import EmployeeCompensationPlanDB
from models_db import EmployeeDB, EmployeeSocialInsuranceDB, EmployeeTaxMethodDB, UserDB

PAY_ROW_TABLES = (EmployeeCompensationPlanDB, EmployeeSocialInsuranceDB, EmployeeTaxMethodDB)


def _employee(db: Session, employee_id: int) -> EmployeeDB:
    emp = db.query(EmployeeDB).filter(EmployeeDB.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return emp


def _valid_left_date(value: Optional[str]) -> Optional[str]:
    text = (value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The last day of employment must be a date (YYYY-MM-DD).")
    if parsed > date.today():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The last day of employment cannot be in the future.")
    return text


def _pay_rows(db: Session, employee_id: int) -> list:
    return [row for model in PAY_ROW_TABLES for row in db.query(model).filter(model.employee_id == employee_id).all()]


def _refuse_rows_after(rows: list, left_date: str) -> None:
    later = [row for row in rows if (row.effective_start_date or "") > left_date]
    if later:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{len(later)} pay row(s) of this employee start after {left_date}. Correct or remove them first, or use a later last day.")


def archive_employee(db: Session, employee_id: int, actor: Dict[str, Any], audit_repo, left_date: Optional[str] = None) -> None:
    emp = _employee(db, employee_id)
    if emp.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This employee is already archived.")
    left_date = _valid_left_date(left_date)
    if left_date:
        _refuse_rows_after(_pay_rows(db, employee_id), left_date)   # before the login is archived, so a refused request changes nothing
    user = db.query(UserDB).filter(UserDB.employee_id == employee_id).first()
    if user is not None and user.archived_at is None:
        # Enforces the self-archive and last Super-Admin rules before anything on the employee changes
        AccessService(db, audit_repo).archive_user(user.id, actor)
    emp = _employee(db, employee_id)
    actor_email = (actor.get("email") or "").strip().lower()
    emp.archived_at = datetime.utcnow()
    emp.archived_by = actor_email
    ended = 0
    if left_date:
        emp.left_date = left_date
        for row in _pay_rows(db, employee_id):
            if not row.effective_end_date or row.effective_end_date > left_date:
                row.effective_end_date = left_date
                ended += 1
    db.commit()
    audit_log(audit_repo, "employee.archive", actor_email, "employee", employee_id,
              f"name={emp.name}" + (f"; left_date={left_date}; pay rows ended={ended}" if left_date else ""))


def unarchive_employee(db: Session, employee_id: int, actor: Dict[str, Any], audit_repo) -> bool:
    """Bring the employee record back. Returns True when their login is still archived (it is never restored)."""
    emp = _employee(db, employee_id)
    if emp.archived_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This employee is not archived.")
    actor_email = (actor.get("email") or "").strip().lower()
    emp.archived_at = None
    emp.archived_by = None
    emp.left_date = None
    user = db.query(UserDB).filter(UserDB.employee_id == employee_id).first()
    login_archived = user is not None and user.archived_at is not None
    db.commit()
    audit_log(audit_repo, "employee.unarchive", actor_email, "employee", employee_id, f"name={emp.name}")
    return login_archived
