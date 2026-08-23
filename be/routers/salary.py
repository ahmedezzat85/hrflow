"""
salary.py
Salary & Raises router: salary history + applying raises, with support
for the Internal/External USD component split (see docs/analysis/
salary-advanced-plan.md and docs/analysis/salary-raise-redesign-plan.md).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user, require_admin
from deps import audit_log
from models import RaiseApply
from repositories.interfaces import SalaryRepository, AuditRepository
from repositories.deps import get_salary_repo, get_audit_repo

router = APIRouter(prefix="/api/salary", tags=["Salary"])


@router.get("/history")
def get_salary_history(
    employee_id: Optional[int] = Query(None),
    current_user: dict = Depends(get_current_user),
    salary_repo: SalaryRepository = Depends(get_salary_repo),
):
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        return salary_repo.get_history(employee_id=my_id)
    elif employee_id is not None:
        return salary_repo.get_history(employee_id=employee_id)
    return salary_repo.get_history()


@router.post("/raise", status_code=201)
def apply_raise(
    payload: RaiseApply,
    current_user: dict = Depends(require_admin),
    salary_repo: SalaryRepository = Depends(get_salary_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    try:
        result = salary_repo.apply_raise(
            employee_id=payload.employee_id,
            new_internal=payload.new_internal_salary_usd,
            new_external=payload.new_external_salary_usd,
            effective_date=payload.effective_date,
            reason=payload.reason,
            actor_email=current_user["email"],
        )
    except ValueError as exc:
        msg = str(exc)
        if "not found" in msg.lower():
            raise HTTPException(status_code=404, detail="Employee not found")
        raise HTTPException(status_code=400, detail=msg)

    emp = result.pop("employee", None)
    emp_id = emp["id"] if emp else payload.employee_id
    current_internal = result["previous_internal_salary_usd"]
    new_internal = result["new_internal_salary_usd"]
    internal_delta_pct = result["internal_delta_pct"]
    current_external = result["previous_external_salary_usd"]
    new_external = result["new_external_salary_usd"]
    external_delta_pct = result["external_delta_pct"]
    current_total = result["previous_salary"]
    new_total = result["new_salary"]
    total_delta_pct = result["pct_change"]

    audit_log(
        audit_repo, "salary.raise", current_user.get("email"), "employee", emp_id,
        f"internal: {current_internal} -> {new_internal} ({internal_delta_pct:+.2f}%), "
        f"external: {current_external} -> {new_external} ({external_delta_pct:+.2f}%), "
        f"total: {current_total} -> {new_total} ({total_delta_pct:+.2f}%), reason={payload.reason}",
    )

    return result
