from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user, require_admin
from deps import resolve_target_employee, audit_log, resolve_employee_scope, current_user_employee_scope
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
    return insurance_repo.list_categories()


@router.post("/categories", status_code=201)
def create_insurance_category(
    payload: InsuranceCategoryCreate,
    current_user: dict = Depends(require_admin),
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
    current_user: dict = Depends(require_admin),
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
    current_user: dict = Depends(require_admin),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
):
    ok = insurance_repo.delete_category(cat_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category deleted"}


@router.get("/consumption")
def get_insurance_consumption(
    scoped_employee_id: Optional[int] = Depends(resolve_employee_scope),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
):
    """
    Employee ownership is resolved by resolve_employee_scope before this
    route executes. Admins can access all employees' consumption or filter
    by employee_id; non-admins are structurally forced to their own
    employee_id.
    """
    return insurance_repo.get_consumption(scoped_employee_id=scoped_employee_id)


@router.get("/claims")
def get_insurance_claims(
    scoped_employee_id: Optional[int] = Depends(current_user_employee_scope),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
):
    """Employee ownership is resolved by current_user_employee_scope
    before this route executes."""
    return insurance_repo.list_claims(scoped_employee_id=scoped_employee_id)


@router.post("/claims", status_code=201)
def submit_insurance_claim(
    payload: InsuranceClaimCreate,
    current_user: dict = Depends(get_current_user),
    insurance_repo: InsuranceRepository = Depends(get_insurance_repo),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    if not insurance_repo.get_category_by_name(payload.category):
        raise HTTPException(status_code=400, detail="Unknown insurance category")

    if payload.document_url and len(payload.document_url) > 3_000_000:
        raise HTTPException(status_code=400, detail="Supporting document is too large")

    emp_id, employee_name, submitted_by_admin = resolve_target_employee(
        employee_repo, current_user, payload.employee_id, payload.employee_name
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


@router.post("/claims/{claim_id}/action")
def action_insurance_claim(
    claim_id: int,
    payload: InsuranceClaimAction,
    current_user: dict = Depends(require_admin),
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