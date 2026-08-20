"""
routers/bank.py
Bank account details for employees. Kept in a dedicated router and a
separate EmployeeBankAccounts sheet tab so sensitive financial data stays
logically isolated from the core Employees record.

Admin-only: only HR admins can read or write bank account information.

GET  /api/employees/{emp_id}/bank-account
     Returns the bank record. IBAN is masked to last 4 digits by default
     (e.g. ****1234). Pass ?reveal=true to return the full value.
     Returns {has_details: false} when no record exists yet.

PUT  /api/employees/{emp_id}/bank-account
     Create or update (upsert) the bank account record for this employee.
     bank_name and iban are required; swift_code is optional.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

import sheets_client
from auth import require_admin
from deps import audit_log
from logging_config import get_logger
from models import BankAccountUpsert

logger = get_logger("main")
router = APIRouter(prefix="/api/employees", tags=["Bank"])


def _mask_iban(iban: str) -> str:
    """Returns IBAN with all but the last 4 characters replaced by *."""
    iban = str(iban)
    if len(iban) <= 4:
        return iban
    return "*" * (len(iban) - 4) + iban[-4:]


def _normalize_bank_record(r: dict) -> dict:
    """Stringify all fields so Google Sheets int-coercion doesn't leak."""
    out = dict(r)
    for f in ("id", "employee_id", "bank_name", "iban", "swift_code", "updated_by", "updated_at"):
        out[f] = str(out.get(f, "") or "")
    return out


@router.get("/{emp_id}/bank-account")
def get_bank_account(emp_id: int, reveal: bool = False, current_user: dict = Depends(require_admin)):
    """Return the employee's bank account details. IBAN is masked unless reveal=true."""
    client = sheets_client.get_client()
    records = client.get_all_records("EmployeeBankAccounts")
    record = next((r for r in records if str(r.get("employee_id")) == str(emp_id)), None)

    if not record:
        return {"has_details": False}

    record = _normalize_bank_record(record)
    result = {
        "has_details": True,
        "bank_name": record["bank_name"],
        "iban": record["iban"] if reveal else _mask_iban(record["iban"]),
        "swift_code": record["swift_code"],
        "updated_by": record["updated_by"],
        "updated_at": record["updated_at"],
    }
    logger.debug("Bank account fetched for employee_id=%s by %s (reveal=%s)", emp_id, current_user.get("email"), reveal)
    return result


@router.put("/{emp_id}/bank-account")
def upsert_bank_account(emp_id: int, payload: BankAccountUpsert, current_user: dict = Depends(require_admin)):
    """Create or update the bank account record for this employee."""
    client = sheets_client.get_client()

    # Verify employee exists
    employees = client.get_all_records("Employees")
    if not any(str(e.get("id")) == str(emp_id) for e in employees):
        raise HTTPException(status_code=404, detail="Employee not found")

    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    records = client.get_all_records("EmployeeBankAccounts")
    existing = next((r for r in records if str(r.get("employee_id")) == str(emp_id)), None)

    updates = {
        "bank_name": payload.bank_name.strip(),
        "iban": payload.iban.strip(),
        "swift_code": (payload.swift_code or "").strip(),
        "updated_by": current_user.get("email", ""),
        "updated_at": now,
    }

    if existing:
        client.update_row_by_match("EmployeeBankAccounts", "employee_id", emp_id, updates)
        action = "bank_account.update"
        logger.info("Bank account updated for employee_id=%s by %s", emp_id, current_user.get("email"))
    else:
        new_id = client.next_id("EmployeeBankAccounts")
        client.append_row("EmployeeBankAccounts", {"id": new_id, "employee_id": emp_id, **updates})
        action = "bank_account.create"
        logger.info("Bank account created for employee_id=%s by %s (id=%s)", emp_id, current_user.get("email"), new_id)

    audit_log(client, action, current_user.get("email"), "employee_bank_account", emp_id,
              f"bank_name={payload.bank_name}")
    return {"message": "Bank account saved"}
