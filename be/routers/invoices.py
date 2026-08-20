"""
routers/invoices.py
External-salary "Consultant Fees" invoice generation and history endpoints
(docs/analysis/invoice-autopay-plan.md). Admin-only: these expose salary
amounts and generate documents on behalf of employees, so access follows
the same require_admin pattern as salary raises and employee CRUD.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import sheets_client
from auth import require_admin
from deps import audit_log
from models import InvoiceGenerateRequest
from services.invoices import generate_invoices_bulk, generate_invoice_for_employee

router = APIRouter(prefix="/api/invoices", tags=["Invoices"])


@router.get("/eligible")
def preview_eligible_employees(
    payment_year: int = Query(...),
    payment_month: int = Query(..., ge=1, le=12),
    current_user: dict = Depends(require_admin),
):
    """
    Read-only preview: for each employee, reports whether they are
    eligible, already have an invoice for this period, or would be
    skipped (with the reason) - without generating or uploading anything.
    """
    from services.invoices import check_eligibility, find_existing_invoice, InvoiceEligibilityError

    client = sheets_client.get_client()
    employees = client.get_all_records("Employees")
    results = []
    for emp in employees:
        existing = find_existing_invoice(client, emp["id"], payment_year, payment_month)
        if existing:
            results.append({
                "employee_id": emp["id"], "employee_name": emp.get("name", ""),
                "status": "already_exists", "invoice_number": existing.get("invoice_number"),
            })
            continue
        try:
            check_eligibility(emp)
            results.append({
                "employee_id": emp["id"], "employee_name": emp.get("name", ""),
                "status": "eligible",
            })
        except InvoiceEligibilityError as exc:
            results.append({
                "employee_id": emp["id"], "employee_name": emp.get("name", ""),
                "status": "skipped", "reason": str(exc),
            })
    return {"payment_year": payment_year, "payment_month": payment_month, "results": results}


@router.post("/generate")
def generate_invoices(payload: InvoiceGenerateRequest, current_user: dict = Depends(require_admin)):
    result = generate_invoices_bulk(
        payload.payment_year, payload.payment_month, current_user.get("email"), payload.skip_existing,
    )
    audit_log(
        sheets_client.get_client(), "invoice.generate_bulk", current_user.get("email"), "invoice_batch",
        f"{payload.payment_year}-{payload.payment_month:02d}",
        f"summary={result['summary']}",
    )
    return result


@router.post("/generate/{employee_id}")
def generate_invoice_single(
    employee_id: int, payload: InvoiceGenerateRequest, current_user: dict = Depends(require_admin),
):
    client = sheets_client.get_client()
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(employee_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    result = generate_invoice_for_employee(
        client, emp, payload.payment_year, payload.payment_month,
        current_user.get("email"), payload.skip_existing,
    )
    audit_log(
        client, "invoice.generate_single", current_user.get("email"), "employee", employee_id,
        f"period={payload.payment_year}-{payload.payment_month:02d}, status={result['status']}",
    )
    if result["status"] == "failed":
        raise HTTPException(status_code=502, detail=f"Invoice generation failed: {result.get('reason')}")
    return result


@router.get("")
def list_invoices(
    employee_id: Optional[int] = Query(None),
    payment_year: Optional[int] = Query(None),
    payment_month: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    current_user: dict = Depends(require_admin),
):
    client = sheets_client.get_client()
    invoices = client.get_all_records("Invoices")
    if employee_id is not None:
        invoices = [i for i in invoices if str(i.get("employee_id")) == str(employee_id)]
    if payment_year is not None:
        invoices = [i for i in invoices if str(i.get("payment_year")) == str(payment_year)]
    if payment_month is not None:
        invoices = [i for i in invoices if str(i.get("payment_month")) == str(payment_month)]
    if status is not None:
        invoices = [i for i in invoices if i.get("status") == status]
    invoices.sort(key=lambda i: str(i.get("created_at", "")), reverse=True)
    return invoices


@router.get("/{invoice_id}")
def get_invoice(invoice_id: int, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    invoices = client.get_all_records("Invoices")
    inv = next((i for i in invoices if str(i.get("id")) == str(invoice_id)), None)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv
