"""
routers/insurance.py
Medical insurance categories, consumption tracking, and claims. Moved
from main.py during the router-decomposition refactor - pure structural
move, no behavior change.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import sheets_client
from auth import get_current_user, require_admin
from deps import resolve_target_employee, audit_log
from models import (
    InsuranceCategoryCreate, InsuranceCategoryUpdate,
    InsuranceClaimCreate, InsuranceClaimAction,
)

router = APIRouter(prefix="/api/insurance", tags=["Insurance"])

APPROACHING_THRESHOLD_PCT = 80


def compute_consumption(employees, categories, claims):
    approved_claims = [c for c in claims if c.get("status") == "Approved"]
    results = []
    for emp in employees:
        emp_id = emp["id"]
        emp_claims = [c for c in approved_claims if str(c.get("employee_id")) == str(emp_id)]
        cat_results = []
        total_limit = 0.0
        total_consumed = 0.0
        for cat in categories:
            limit = float(cat.get("annual_limit") or 0)
            consumed = sum(float(c.get("amount") or 0) for c in emp_claims if c.get("category") == cat["name"])
            remaining = max(limit - consumed, 0)
            pct_used = round((consumed / limit) * 100, 1) if limit > 0 else 0
            if limit > 0 and consumed >= limit:
                status = "limit_reached"
            elif limit > 0 and pct_used >= APPROACHING_THRESHOLD_PCT:
                status = "approaching"
            else:
                status = "ok"
            cat_results.append({
                "category_id": cat["id"], "category": cat["name"], "limit": limit, "consumed": consumed,
                "remaining": remaining, "pct_used": pct_used, "status": status,
            })
            total_limit += limit
            total_consumed += consumed
        total_pct = round((total_consumed / total_limit) * 100, 1) if total_limit > 0 else 0
        if total_limit > 0 and total_consumed >= total_limit:
            total_status = "limit_reached"
        elif total_limit > 0 and total_pct >= APPROACHING_THRESHOLD_PCT:
            total_status = "approaching"
        else:
            total_status = "ok"
        results.append({
            "employee_id": emp_id, "employee_name": emp["name"], "categories": cat_results,
            "total_limit": total_limit, "total_consumed": total_consumed,
            "total_remaining": max(total_limit - total_consumed, 0),
            "total_pct_used": total_pct, "total_status": total_status,
        })
    return results


@router.get("/categories")
def get_insurance_categories(current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    return client.get_all_records("InsuranceCategories")


@router.post("/categories", status_code=201)
def create_insurance_category(payload: InsuranceCategoryCreate, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    categories = client.get_all_records("InsuranceCategories")
    if any(c["name"].strip().lower() == payload.name.strip().lower() for c in categories):
        raise HTTPException(status_code=400, detail="A category with this name already exists")
    new_id = client.next_id("InsuranceCategories")
    client.append_row("InsuranceCategories", {"id": new_id, "name": payload.name, "annual_limit": payload.annual_limit})
    return {"message": "Category created", "id": new_id}


@router.put("/categories/{cat_id}")
def update_insurance_category(cat_id: int, payload: InsuranceCategoryUpdate, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    ok = client.update_row_by_match("InsuranceCategories", "id", cat_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category updated"}


@router.delete("/categories/{cat_id}")
def delete_insurance_category(cat_id: int, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    ok = client.delete_row_by_match("InsuranceCategories", "id", cat_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category deleted"}


@router.get("/consumption")
def get_insurance_consumption(employee_id: Optional[int] = Query(None), current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    employees = client.get_all_records("Employees")
    categories = client.get_all_records("InsuranceCategories")
    claims = client.get_all_records("InsuranceClaims")

    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        employees = [e for e in employees if str(e["id"]) == my_id]
    elif employee_id is not None:
        employees = [e for e in employees if str(e["id"]) == str(employee_id)]

    return compute_consumption(employees, categories, claims)


@router.get("/claims")
def get_insurance_claims(current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    claims = client.get_all_records("InsuranceClaims")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        claims = [c for c in claims if str(c["employee_id"]) == my_id]
    return claims


@router.post("/claims", status_code=201)
def submit_insurance_claim(payload: InsuranceClaimCreate, current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    categories = client.get_all_records("InsuranceCategories")
    if not any(c["name"] == payload.category for c in categories):
        raise HTTPException(status_code=400, detail="Unknown insurance category")

    if payload.document_url and len(payload.document_url) > 3_000_000:
        raise HTTPException(status_code=400, detail="Supporting document is too large")

    emp_id, employee_name, submitted_by_admin = resolve_target_employee(
        client, current_user, payload.employee_id, payload.employee_name
    )

    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    claim_id = client.next_id("InsuranceClaims")
    client.append_row("InsuranceClaims", {
        "id": claim_id, "employee_id": emp_id, "employee_name": employee_name,
        "category": payload.category, "provider": payload.provider, "amount": payload.amount,
        "date": record_date, "status": status,
        "document_url": payload.document_url or "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })

    detail_suffix = " (submitted by HR admin)" if submitted_by_admin else ""
    req_id = client.next_id("Requests")
    client.append_row("Requests", {
        "id": req_id, "employee_id": emp_id, "employee_name": employee_name, "type": "Medical Insurance",
        "details": f"{payload.category} claim - EGP {payload.amount}{detail_suffix}",
        "date": record_date, "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })
    return {"message": "Claim submitted", "id": claim_id}


@router.post("/claims/{claim_id}/action")
def action_insurance_claim(claim_id: int, payload: InsuranceClaimAction, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    ok = client.update_row_by_match("InsuranceClaims", "id", claim_id, {"status": payload.status})
    if not ok:
        raise HTTPException(status_code=404, detail="Claim not found")
    audit_log(client, "insurance_claim.action", current_user.get("email"), "insurance_claim", claim_id, f"status={payload.status}")
    return {"message": f"Claim {payload.status.lower()}"}
