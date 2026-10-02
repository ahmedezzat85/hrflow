"""
routers/employee_bank_accounts.py
Bank account details for employees (personal external transfer accounts).

GET  /api/employees/{emp_id}/bank-account
     Returns the bank record. IBAN is masked to last 4 digits by default
     (e.g. ****1234). Pass ?reveal=true to return the full value (requires hr.employee_bank_account.reveal).
     Employees may read their own bank account masked details via self.bank_account.read.
     Returns {has_details: false} when no record exists yet.

PUT  /api/employees/{emp_id}/bank-account
     Create or update (upsert) the bank account record for this employee.
     Requires hr.employee_bank_account.write.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from core.permissions import require_permission
from deps import audit_log
from logging_config import get_logger
from models import EmployeeBankAccountUpsert
from repositories.interfaces import EmployeeBankAccountRepository, AuditRepository
from repositories.deps import get_employee_bank_repo, get_audit_repo

logger = get_logger("main")
router = APIRouter(prefix="/api/employees", tags=["Employee Bank Accounts"])


@router.get("/{emp_id}/bank-account")
def get_bank_account(
    emp_id: int,
    reveal: bool = Query(False),
    current_user: dict = Depends(get_current_user),
    bank_repo: EmployeeBankAccountRepository = Depends(get_employee_bank_repo),
):
    """Return the employee's personal bank account details. IBAN is masked unless reveal=true."""
    perms = set(current_user.get("permissions", []))
    has_all = "hr.employee_bank_account.read" in perms
    is_own = ("self.bank_account.read" in perms) and (current_user.get("employee_id") == emp_id)

    if not has_all and not is_own:
        raise HTTPException(
            status_code=403,
            detail="Permission denied: 'hr.employee_bank_account.read' or 'self.bank_account.read' (own record) required",
        )

    if reveal and "hr.employee_bank_account.reveal" not in perms:
        raise HTTPException(
            status_code=403,
            detail="Permission denied: 'hr.employee_bank_account.reveal' required to reveal unmasked bank details",
        )

    result = bank_repo.get_by_employee_id(emp_id, reveal=reveal)
    logger.debug("Employee bank account fetched for employee_id=%s by %s (reveal=%s)", emp_id, current_user.get("email"), reveal)
    return result

get_bank_account.hrflow_permission_all = "hr.employee_bank_account.read"
get_bank_account.hrflow_permission_self = "self.bank_account.read"


@router.put("/{emp_id}/bank-account")
def upsert_bank_account(
    emp_id: int,
    payload: EmployeeBankAccountUpsert,
    current_user: dict = Depends(require_permission("hr.employee_bank_account.write")),
    bank_repo: EmployeeBankAccountRepository = Depends(get_employee_bank_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    """Create or update the bank account record for this employee."""
    try:
        action_type, record_id = bank_repo.upsert(
            employee_id=emp_id,
            bank_name=payload.bank_name,
            iban=payload.iban,
            swift_code=payload.swift_code or "",
            actor_email=current_user.get("email", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    action = f"bank_account.{action_type}"
    if action_type == "update":
        logger.info("Employee bank account updated for employee_id=%s by %s", emp_id, current_user.get("email"))
    else:
        logger.info("Employee bank account created for employee_id=%s by %s (id=%s)", emp_id, current_user.get("email"), record_id)

    audit_log(audit_repo, action, current_user.get("email"), "employee_bank_account", emp_id,
              f"bank_name={payload.bank_name}")
    return {"message": "Bank account saved"}
