from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from core.permissions import require_permission
from deps import resolve_target_employee, audit_log, permission_scope, Scope
from models import (
    InsuranceCategoryCreate, InsuranceCategoryUpdate,
    InsuranceClaimCreate, InsuranceClaimAction,
)
from repositories.interfaces import InsuranceRepository, EmployeeRepository, AuditRepository
from repositories.deps import get_insurance_repo, get_employee_repo, get_audit_repo
from repositories.sheets.insurance import compute_consumption

router = APIRouter(prefix="/api/insurance", tags=["Insurance"])


@router.get("/categories")
def get_insurance_categories(
    current_user: dict = Depends(get_current_user),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
):
    perms = set(current_user.get("permissions", []))
    if "hr.insurance.read" not in perms and "self.claim.read" not in perms and current_user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Permission denied: 'hr.insurance.read' or 'self.claim.read' required",
        )
    return insurance_repo.list_categories()

get_insurance_categories.hrflow_permission_all = "hr.insurance.read"
get_insurance_categories.hrflow_permission_self = "self.claim.read"


@router.post("/categories", status_code=201)
def create_insurance_category(
    payload: InsuranceCategoryCreate,
    current_user: dict = Depends(require_permission("hr.insurance.write")),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
):
    try:
        new_id = insurance_repo.create_category(payload.name, payload.annual_limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"message": "Category created", "id": new_id}


@router.put("/categories/{cat_id}")
def update_insurance_category(
    cat_id: int,
    payload: InsuranceCategoryUpdate,
    current_user: dict = Depends(require_permission("hr.insurance.write")),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    ok = insurance_repo.update_category(cat_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category updated"}


@router.delete("/categories/{cat_id}")
def delete_insurance_category(
    cat_id: int,
    current_user: dict = Depends(require_permission("hr.insurance.write")),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
):
    ok = insurance_repo.delete_category(cat_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category deleted"}


@router.get("/consumption")
def get_insurance_consumption(
    employee_id: Optional[int] = Query(None),
    scope: Scope = Depends(permission_scope("hr.insurance.read", "self.claim.read")),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
):
    """
    Employee ownership is resolved by permission_scope before this
    route executes. Admins can access all employees' consumption or filter
    by employee_id; non-admins are structurally forced to their own
    employee_id.
    """
    scoped_employee_id = employee_id if scope.is_all else scope.employee_id
    return insurance_repo.get_consumption(scoped_employee_id=scoped_employee_id)

get_insurance_consumption.hrflow_permission_all = "hr.insurance.read"
get_insurance_consumption.hrflow_permission_self = "self.claim.read"


@router.get("/claims")
def get_insurance_claims(
    scope: Scope = Depends(permission_scope("hr.insurance.read", "self.claim.read")),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
):
    """Employee ownership is resolved by permission_scope
    before this route executes."""
    scoped_employee_id = None if scope.is_all else scope.employee_id
    return insurance_repo.list_claims(scoped_employee_id=scoped_employee_id)

get_insurance_claims.hrflow_permission_all = "hr.insurance.read"
get_insurance_claims.hrflow_permission_self = "self.claim.read"


@router.post("/claims", status_code=201)
def submit_insurance_claim(
    payload: InsuranceClaimCreate,
    current_user: dict = Depends(get_current_user),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    perms = set(current_user.get("permissions", []))
    has_write_all = "hr.insurance.write" in perms or current_user.get("role") == "admin"
    has_write_own = "self.claim.write" in perms

    if not has_write_all and not has_write_own:
        raise HTTPException(
            status_code=403,
            detail="Permission denied: 'hr.insurance.write' or 'self.claim.write' required",
        )

    if not insurance_repo.get_category_by_name(payload.category):
        raise HTTPException(status_code=400, detail="Unknown insurance category")

    if payload.document_url and len(payload.document_url) > 3_000_000:
        raise HTTPException(status_code=400, detail="Supporting document is too large")

    emp_id, employee_name, submitted_by_admin = resolve_target_employee(
        employee_repo, current_user, payload.employee_id, payload.employee_name,
        required_permission="hr.insurance.write"
    )

    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    claim_data = {
        "employee_id": emp_id,
        "employee_name": employee_name,
        "category": payload.category,
        "provider": payload.provider,
        "amount": payload.amount,
        "date": record_date,
        "status": status,
        "document_url": payload.document_url or "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    }

    detail_suffix = " (submitted by HR admin)" if submitted_by_admin else ""
    request_data = {
        "employee_id": emp_id,
        "employee_name": employee_name,
        "type": "Medical Insurance",
        "details": f"{payload.category} claim - EGP {payload.amount}{detail_suffix}",
        "date": record_date,
        "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    }

    claim_id = insurance_repo.create_claim(claim_data, request_data)
    return {"message": "Claim submitted", "id": claim_id}

submit_insurance_claim.hrflow_permission_all = "hr.insurance.write"
submit_insurance_claim.hrflow_permission_self = "self.claim.write"


@router.post("/claims/{claim_id}/action")
def action_insurance_claim(
    claim_id: int,
    payload: InsuranceClaimAction,
    current_user: dict = Depends(require_permission("hr.insurance.write")),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    ok = insurance_repo.action_claim(
        claim_id=claim_id,
        status=payload.status,
        reviewer_email=current_user["email"],
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Claim not found")

    audit_log(audit_repo, "insurance_claim.action", current_user.get("email"), "insurance_claim", claim_id, f"status={payload.status}")
    return {"message": f"Claim {payload.status.lower()}"}