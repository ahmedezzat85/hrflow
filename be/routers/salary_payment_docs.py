"""
routers/salary_payment_docs.py
External-salary "Consultant Fees" payment receipt document generation and history endpoints
(docs/analysis/invoice-autopay-plan.md). Admin-only: these expose salary
amounts and generate documents on behalf of employees, so access follows
the same require_admin pattern as salary raises and employee CRUD.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_admin
from deps import audit_log
from models import SalaryPaymentDocGenerateRequest, InvoiceGenerateRequest
from services.salary_payment_docs import (
    generate_salary_payment_docs_bulk,
    generate_salary_payment_doc_for_employee,
    check_eligibility,
    find_existing_salary_payment_doc,
    SalaryPaymentDocEligibilityError,
    get_salary_payment_doc_pdf_bytes,
)
from repositories.interfaces import SalaryPaymentDocRepository, InvoiceRepository, EmployeeRepository, AuditRepository
from repositories.deps import get_salary_payment_doc_repo, get_invoice_repo, get_employee_repo, get_audit_repo

router = APIRouter(prefix="/api/salary-payment-docs", tags=["Salary Payment Documents"])
# Secondary router for backward compatibility with /api/invoices
compat_router = APIRouter(prefix="/api/invoices", tags=["Invoices (HR Legacy)"])


@router.get("/eligible")
@compat_router.get("/eligible")
def preview_eligible_employees(
    payment_year: int = Query(...),
    payment_month: int = Query(..., ge=1, le=12),
    current_user: dict = Depends(require_admin),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    invoice_repo: SalaryPaymentDocRepository = Depends(get_salary_payment_doc_repo),
):
    """
    Read-only preview: for each employee, reports whether they are
    eligible, already have a payment document for this period, or would be
    skipped (with the reason) - without generating or uploading anything.
    """
    employees = employee_repo.list_all()
    results = []
    for emp in employees:
        existing = find_existing_salary_payment_doc(invoice_repo, emp["id"], payment_year, payment_month)
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
        except SalaryPaymentDocEligibilityError as exc:
            results.append({
                "employee_id": emp["id"], "employee_name": emp.get("name", ""),
                "status": "skipped", "reason": str(exc),
            })
    return {"payment_year": payment_year, "payment_month": payment_month, "results": results}


@router.post("/generate")
@compat_router.post("/generate")
def generate_invoices(
    payload: SalaryPaymentDocGenerateRequest,
    current_user: dict = Depends(require_admin),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    invoice_repo: SalaryPaymentDocRepository = Depends(get_salary_payment_doc_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    result = generate_salary_payment_docs_bulk(
        payload.payment_year, payload.payment_month, current_user.get("email"), payload.skip_existing,
        invoice_repo=invoice_repo, employee_repo=employee_repo,
    )
    audit_log(
        audit_repo, "invoice.generate_bulk", current_user.get("email"), "invoice_batch",
        f"{payload.payment_year}-{payload.payment_month:02d}",
        f"summary={result['summary']}",
    )
    return result


@router.post("/generate/{employee_id}")
@compat_router.post("/generate/{employee_id}")
def generate_invoice_single(
    employee_id: int,
    payload: SalaryPaymentDocGenerateRequest,
    current_user: dict = Depends(require_admin),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    invoice_repo: SalaryPaymentDocRepository = Depends(get_salary_payment_doc_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    emp = employee_repo.get_by_id(employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    result = generate_salary_payment_doc_for_employee(
        invoice_repo, emp, payload.payment_year, payload.payment_month,
        current_user.get("email"), payload.skip_existing,
    )
    audit_log(
        audit_repo, "invoice.generate_single", current_user.get("email"), "employee", employee_id,
        f"period={payload.payment_year}-{payload.payment_month:02d}, status={result['status']}",
    )
    if result["status"] == "failed":
        raise HTTPException(status_code=502, detail=f"Invoice generation failed: {result.get('reason')}")
    return result


@router.get("")
@compat_router.get("")
def list_invoices(
    employee_id: Optional[int] = Query(None),
    payment_year: Optional[int] = Query(None),
    payment_month: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    current_user: dict = Depends(require_admin),
    invoice_repo: SalaryPaymentDocRepository = Depends(get_salary_payment_doc_repo),
):
    return invoice_repo.list_all(
        employee_id=employee_id,
        payment_year=payment_year,
        payment_month=payment_month,
        status=status,
    )


@router.get("/{invoice_id}")
@compat_router.get("/{invoice_id}")
def get_invoice(
    invoice_id: int,
    current_user: dict = Depends(require_admin),
    invoice_repo: SalaryPaymentDocRepository = Depends(get_salary_payment_doc_repo),
):
    inv = invoice_repo.get_by_id(invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv


@router.get("/{invoice_id}/stream")
@compat_router.get("/{invoice_id}/stream")
def stream_invoice_pdf(
    invoice_id: int,
    download: bool = Query(False),
    current_user: dict = Depends(require_admin),
    invoice_repo: SalaryPaymentDocRepository = Depends(get_salary_payment_doc_repo),
):
    import urllib.parse
    import io
    from fastapi.responses import StreamingResponse

    inv = invoice_repo.get_by_id(invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    try:
        import services.salary_payment_docs as spd_mod
        get_pdf_fn = getattr(spd_mod, "get_invoice_pdf_bytes", getattr(spd_mod, "get_salary_payment_doc_pdf_bytes", get_salary_payment_doc_pdf_bytes))
        pdf_bytes, filename = get_pdf_fn(inv)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"PDF preview unavailable: {exc}")

    disposition = "attachment" if download else "inline"
    safe_filename = urllib.parse.quote(filename)
    headers = {
        "Content-Disposition": f'{disposition}; filename="{filename}"; filename*=UTF-8\'\'{safe_filename}',
        "Content-Type": "application/pdf",
        "Cache-Control": "public, max-age=3600",
    }
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)
