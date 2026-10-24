"""
be/analytics/router.py
API endpoints for Employee Pay Analytics (view and export).
Routes are mounted under /api/analytics/employees/{employee_id}/pay.
"""
import json
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Path, Request, status, Response
from sqlalchemy.orm import Session

from db import get_db
from core.permissions import require_any_permission, get_current_user_permissions
from repositories.interfaces import EmployeeRepository, AuditRepository
from repositories.deps import get_employee_repo, get_audit_repo
from finance.services.payroll_read_service import PayrollReadService
from finance.services.compensation_plan_service import CompensationPlanService
from analytics.schemas import EmployeePayViewResponse
from analytics.services.employee_pay_service import EmployeePayService
from analytics.exporters import export_employee_pay_xlsx, export_employee_pay_csv

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


def get_payroll_read_service(db: Session = Depends(get_db)) -> PayrollReadService:
    return PayrollReadService(db)


def get_comp_plan_service(db: Session = Depends(get_db)) -> CompensationPlanService:
    return CompensationPlanService(db)


def get_employee_pay_service(
    db: Session = Depends(get_db),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    payroll_read_service: PayrollReadService = Depends(get_payroll_read_service),
    comp_plan_service: CompensationPlanService = Depends(get_comp_plan_service),
) -> EmployeePayService:
    return EmployeePayService(
        db=db,
        employee_repo=employee_repo,
        payroll_read_service=payroll_read_service,
        comp_plan_service=comp_plan_service,
    )


@router.get(
    "/employees/{employee_id}/pay",
    response_model=EmployeePayViewResponse,
    response_model_exclude_none=True,
)
def get_employee_pay(
    request: Request,
    employee_id: int = Path(..., description="Target employee ID"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    group_by: str = Query("month", regex="^(month|quarter)$", description="Group by month or quarter"),
    currency: str = Query("USD", description="Currency filter"),
    service: EmployeePayService = Depends(get_employee_pay_service),
    current_user: dict = Depends(require_any_permission("finance.report.read", "hr.salary.read")),
    db: Session = Depends(get_db),
):
    """
    Employee-level pay analytics: payments series split into base external,
    base internal, commission, and bonus, plus compensation plan & raise history.
    Sections caller lacks permission for are omitted from the response.
    """
    perms = get_current_user_permissions(request, current_user=current_user, db=db)
    can_view_payments = "finance.report.read" in perms
    can_view_plan = "hr.salary.read" in perms

    if not (can_view_payments or can_view_plan):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied: requires finance.report.read or hr.salary.read",
        )

    return service.get_employee_pay_view(
        employee_id=employee_id,
        start_date=start_date,
        end_date=end_date,
        group_by=group_by,
        currency=currency,
        can_view_payments=can_view_payments,
        can_view_plan=can_view_plan,
    )


@router.get("/employees/{employee_id}/pay/export")
def export_employee_pay(
    request: Request,
    employee_id: int = Path(..., description="Target employee ID"),
    format: str = Query("xlsx", regex="^(xlsx|csv)$", description="Export file format"),
    dataset: str = Query("monthly", regex="^(monthly|raises)$", description="CSV dataset (monthly or raises)"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    group_by: str = Query("month", regex="^(month|quarter)$", description="Group by month or quarter"),
    currency: str = Query("USD", description="Currency filter"),
    service: EmployeePayService = Depends(get_employee_pay_service),
    audit_repo: AuditRepository = Depends(get_audit_repo),
    current_user: dict = Depends(require_any_permission("finance.report.read", "hr.salary.read")),
    db: Session = Depends(get_db),
):
    """
    Export employee pay analytics as XLSX or CSV with formula injection neutralization.
    Writes audit event via HR AuditRepository.
    """
    perms = get_current_user_permissions(request, current_user=current_user, db=db)
    can_view_payments = "finance.report.read" in perms
    can_view_plan = "hr.salary.read" in perms

    # Validate permission against requested format and dataset
    if format == "csv":
        if dataset == "monthly" and not can_view_payments:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: 'finance.report.read' required to export monthly payments",
            )
        if dataset == "raises" and not can_view_plan:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: 'hr.salary.read' required to export raises",
            )
    else:  # xlsx
        if not (can_view_payments or can_view_plan):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: at least one of finance.report.read or hr.salary.read required",
            )

    pay_data = service.get_employee_pay_view(
        employee_id=employee_id,
        start_date=start_date,
        end_date=end_date,
        group_by=group_by,
        currency=currency,
        can_view_payments=can_view_payments,
        can_view_plan=can_view_plan,
    )

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filters = {
        "start_date": start_date,
        "end_date": end_date,
        "group_by": group_by,
        "currency": currency,
    }

    if format == "csv":
        csv_text = export_employee_pay_csv(pay_data, dataset=dataset)
        content_bytes = csv_text.encode("utf-8")
        filename = f"employee_{employee_id}_pay_{dataset}_{timestamp}.csv"
        media_type = "text/csv; charset=utf-8"
    else:
        content_bytes = export_employee_pay_xlsx(
            pay_data,
            can_view_payments=can_view_payments,
            can_view_plan=can_view_plan,
        )
        filename = f"employee_{employee_id}_pay_{timestamp}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    # Audit write through HR AuditRepository (Decision 9)
    audit_repo.log(
        action="analytics.employee_pay.export",
        actor_email=current_user.get("email") or "unknown@hrflow.internal",
        target_type="employee",
        target_id=str(employee_id),
        details=json.dumps({
            "format": format,
            "dataset": dataset,
            "filters": filters,
            "filename": filename,
        }),
    )

    return Response(
        content=content_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )
