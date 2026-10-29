"""
be/services/employee_archive.py
Archiving an employee: they have left or are set aside, but every record about them stays (pay history, documents, notes).
- employees.archived_at / archived_by hold the state; the API reports status "Archived" while it is set and the saved status
  (Active, On Leave, Suspended) comes back on unarchive.
- The linked login user is archived with them, so they can no longer sign in (same rules as archiving a user: nobody can
  archive their own user, nor the last active Super-Admin). An archived user is never restored (RBAC F5: no restore
  control for users), so unarchiving the employee leaves the login archived; the response says so.
- An archived employee is left out of current and future payroll runs and of new salary documents; historical payroll
  periods still include them if they had a pay plan then.
"""
from datetime import datetime
from typing import Any, Dict

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.access_service import AccessService
from deps import audit_log
from models_db import EmployeeDB, UserDB


def _employee(db: Session, employee_id: int) -> EmployeeDB:
    emp = db.query(EmployeeDB).filter(EmployeeDB.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return emp


def archive_employee(db: Session, employee_id: int, actor: Dict[str, Any], audit_repo) -> None:
    emp = _employee(db, employee_id)
    if emp.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This employee is already archived.")
    user = db.query(UserDB).filter(UserDB.employee_id == employee_id).first()
    if user is not None and user.archived_at is None:
        # Enforces the self-archive and last Super-Admin rules before anything on the employee changes
        AccessService(db, audit_repo).archive_user(user.id, actor)
    emp = _employee(db, employee_id)
    actor_email = (actor.get("email") or "").strip().lower()
    emp.archived_at = datetime.utcnow()
    emp.archived_by = actor_email
    db.commit()
    audit_log(audit_repo, "employee.archive", actor_email, "employee", employee_id, f"name={emp.name}")


def unarchive_employee(db: Session, employee_id: int, actor: Dict[str, Any], audit_repo) -> bool:
    """Bring the employee record back. Returns True when their login is still archived (it is never restored)."""
    emp = _employee(db, employee_id)
    if emp.archived_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This employee is not archived.")
    actor_email = (actor.get("email") or "").strip().lower()
    emp.archived_at = None
    emp.archived_by = None
    user = db.query(UserDB).filter(UserDB.employee_id == employee_id).first()
    login_archived = user is not None and user.archived_at is not None
    db.commit()
    audit_log(audit_repo, "employee.unarchive", actor_email, "employee", employee_id, f"name={emp.name}")
    return login_archived
