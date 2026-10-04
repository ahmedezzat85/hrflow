"""
be/finance/routers/payroll.py
API router for Guided Payroll Runs, Lifecycle State Transitions,
Disbursements, GL Journal Posting, and Employee Payslips (Story 8.1).
"""
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, Query, Path, HTTPException, status, Response, Request
from sqlalchemy.orm import Session

from db import get_db
from core.permissions import require_permission, get_current_user_permissions
from finance.schemas import (
    PayrollRunResponse,
    PayrollRunPreviewRequest,
    PayrollRunPreviewResponse,
    PayrollRunCreate,
    PayrollRunGenerateRequest,
    PayrollPaymentRequest,
    EmployeePayslipResponse,
    PayrollLineCreate,
    PayrollLineResponse,
    PayrollAdjustmentCreate,
    PayrollAdjustmentUpdate,
    PayrollAdjustmentResponse,
    PayrollSettingsUpdate,
    PayrollSettingsResponse,
    PayrollTaxSettingsCreate,
    PayrollTaxSettingsResponse,
)
from finance.services.payroll_service import PayrollService

router = APIRouter(prefix="/api/finance/payroll", tags=["Finance - Payroll"])


def get_payroll_service(db: Session = Depends(get_db)) -> PayrollService:
    return PayrollService(db)


@router.get("/runs", response_model=List[PayrollRunResponse])
def list_payroll_runs(
    status: Optional[str] = Query(None, description="Filter by status (draft, approved, finalized, paid, partially_paid)"),
    search: Optional[str] = Query(None, description="Search by period label"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Lists payroll runs with period, totals, and lifecycle status."""
    return service.list_runs(status_filter=status, search=search, limit=limit, offset=offset)


@router.post("/previews", response_model=PayrollRunPreviewResponse)
@router.post("/runs/preview", response_model=PayrollRunPreviewResponse)
def preview_payroll_run(
    req: PayrollRunPreviewRequest,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """
    Evaluates active staff to preview net payments,
    detect route-specific readiness issues, and evaluate net variance vs prior period.
    """
    return service.preview_run(
        period_label=req.period_label,
        period_start=req.period_start,
        period_end=req.period_end,
        payment_date=req.payment_date,
        bank_account_id=req.bank_account_id,
        external_funding_account_id=req.external_funding_account_id,
        internal_funding_account_id=req.internal_funding_account_id,
        fx_rate_source=req.fx_rate_source,
        fx_rate_value=req.fx_rate_value,
    )


@router.get("/previews/{preview_id}", response_model=PayrollRunPreviewResponse)
def get_preview(
    preview_id: str = Path(..., description="Preview ID"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Returns active state of a preview including recipients, adjustments, and recalculated totals."""
    return service.get_preview(preview_id)


@router.get("/previews/{preview_id}/adjustments", response_model=List[PayrollAdjustmentResponse])
def list_preview_adjustments(
    preview_id: str = Path(..., description="Preview ID"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Lists active draft adjustments for the specified preview."""
    return service.list_preview_adjustments(preview_id)


@router.post("/previews/{preview_id}/adjustments", response_model=PayrollAdjustmentResponse, status_code=status.HTTP_201_CREATED)
def create_preview_adjustment(
    preview_id: str = Path(..., description="Preview ID"),
    req: PayrollAdjustmentCreate = ...,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.prepare")),
):
    """Adds a Commission or Bonus adjustment to a preview and immediately updates recipient and run totals."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.create_preview_adjustment(preview_id, req, user_email)


@router.patch("/previews/{preview_id}/adjustments/{adjustment_id}", response_model=PayrollAdjustmentResponse)
def update_preview_adjustment(
    preview_id: str = Path(..., description="Preview ID"),
    adjustment_id: str = Path(..., description="Adjustment ID"),
    req: PayrollAdjustmentUpdate = ...,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.prepare")),
):
    """Updates an existing adjustment on a preview and recalculates totals immediately."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.update_preview_adjustment(preview_id, adjustment_id, req, user_email)


@router.delete("/previews/{preview_id}/adjustments/{adjustment_id}")
def delete_preview_adjustment(
    preview_id: str = Path(..., description="Preview ID"),
    adjustment_id: str = Path(..., description="Adjustment ID"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.prepare")),
):
    """Removes an adjustment from a preview and recalculates totals immediately."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.delete_preview_adjustment(preview_id, adjustment_id, user_email)


@router.post("/runs/generate", response_model=PayrollRunResponse, status_code=status.HTTP_201_CREATED)
def generate_payroll_run_from_plans(
    req: PayrollRunGenerateRequest,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.prepare")),
):
    """Generates a payroll run and split net payment lines directly from active employee compensation plans."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.generate_run_from_compensation_plans(
        period_label=req.period_label,
        period_start=req.period_start,
        period_end=req.period_end,
        payment_date=req.payment_date,
        fx_rate_source=req.fx_rate_source or "first_of_month",
        fx_rate_value=req.fx_rate_value,
        bank_account_id=req.bank_account_id,
        external_funding_account_id=req.external_funding_account_id,
        internal_funding_account_id=req.internal_funding_account_id,
        user_email=user_email,
    )


@router.post("/runs", response_model=PayrollRunResponse, status_code=status.HTTP_201_CREATED)
def create_payroll_run(
    req: PayrollRunCreate,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.prepare")),
):
    """Creates a net-payment payroll run and snapshots employee payment lines."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.create_run(
        period_label=req.period_label,
        period_start=req.period_start,
        period_end=req.period_end,
        payment_date=req.payment_date,
        bank_account_id=req.bank_account_id,
        external_funding_account_id=req.external_funding_account_id,
        internal_funding_account_id=req.internal_funding_account_id,
        currency=req.currency,
        user_email=user_email,
        fx_rate_source=req.fx_rate_source,
        fx_rate_value=req.fx_rate_value,
        preview_id=req.preview_id,
        preview_version=req.preview_version,
        source_version=req.source_version,
        idempotency_key=req.idempotency_key,
        submit_for_approval=req.submit_for_approval,
    )


@router.get("/runs/{run_id}", response_model=PayrollRunResponse)
def get_payroll_run_detail(
    run_id: int = Path(..., description="Payroll Run ID"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Returns complete payroll run detail including employee payment lines, readiness issues, and payment status."""
    return service.get_run(run_id=run_id)


@router.post("/runs/{run_id}/lines", response_model=PayrollLineResponse, status_code=status.HTTP_201_CREATED)
def add_payroll_line(
    run_id: int = Path(..., description="Payroll Run ID"),
    req: PayrollLineCreate = ...,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.prepare")),
):
    """Adds an ad-hoc commission or bonus line to a draft payroll run."""
    return service.add_ad_hoc_line(
        run_id=run_id,
        employee_id=req.employee_id,
        compensation_type=req.compensation_type,
        amount=req.amount or req.base_salary,
        notes=req.notes or req.snapshot_notes,
    )


@router.delete("/runs/{run_id}/lines/{line_id}")
def delete_payroll_line(
    run_id: int = Path(..., description="Payroll Run ID"),
    line_id: int = Path(..., description="Payroll Line ID to delete"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.prepare")),
):
    """Removes an ad-hoc or mistakenly added line from a draft payroll run."""
    return service.delete_line(run_id=run_id, line_id=line_id)


@router.post("/runs/{run_id}/refresh", response_model=PayrollRunResponse)
def refresh_payroll_run(
    run_id: int = Path(..., description="Draft Payroll Run ID to re-check against current data"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.prepare")),
):
    """Recomputes a draft run's plan lines and readiness issues from current data, keeping ad-hoc lines."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.refresh_run(run_id=run_id, user_email=user_email)


@router.post("/runs/{run_id}/submit", response_model=PayrollRunResponse)
def submit_payroll_run(
    run_id: int = Path(..., description="Payroll Run ID to submit for approval"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.prepare")),
):
    """Submits a draft payroll run for maker-checker approval."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.submit_run(run_id=run_id, user_email=user_email)


@router.post("/runs/{run_id}/approve", response_model=PayrollRunResponse)
def approve_payroll_run(
    request: Request,
    run_id: int = Path(..., description="Payroll Run ID to approve"),
    allow_self_approval: bool = Query(False, description="Allow self-approval to bypass maker-checker"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.approve")),
    db: Session = Depends(get_db),
):
    """Maker-checker approval for payroll run. Enforces blocking exception verification and prevents self-approval."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    effective_self_approval = False
    if allow_self_approval:
        perms = get_current_user_permissions(request, current_user=current_user, db=db)
        if bool(current_user.get("is_super_admin")) or ("finance.payroll.prepare" in perms and "finance.payroll.approve" in perms):
            effective_self_approval = True
    return service.approve_run(run_id=run_id, user_email=user_email, allow_self_approval=effective_self_approval)


@router.post("/runs/{run_id}/finalize", response_model=PayrollRunResponse)
def finalize_payroll_run(
    run_id: int = Path(..., description="Payroll Run ID to finalize"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.approve")),
):
    """Locks the payroll run against edits and enables funding/disbursement."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.finalize_run(run_id=run_id, user_email=user_email)


@router.get("/runs/{run_id}/export")
def export_payroll_run_csv(
    run_id: int = Path(..., description="Payroll Run ID to export"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Exports net payment details with base amounts, adjustments, and final payments as CSV."""
    csv_data = service.export_run_csv(run_id)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="payroll_run_{run_id}.csv"'},
    )


@router.post("/runs/{run_id}/pay", response_model=PayrollRunResponse)
def execute_payroll_payment(
    req: PayrollPaymentRequest,
    run_id: int = Path(..., description="Payroll Run ID to disburse"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.pay")),
):
    """
    Executes net salary funding and disbursements.
    Supports partial failure recovery without rerunning already-successful lines.
    """
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.execute_payment(
        run_id=run_id,
        user_email=user_email,
        bank_account_id=req.bank_account_id,
        retry_failed_only=req.retry_failed_only,
        simulate_partial_failure_ids=req.simulate_partial_failure_ids,
    )


@router.post("/runs/{run_id}/post-journal")
def post_payroll_journal(
    run_id: int = Path(..., description="Payroll Run ID to post to GL"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.pay")),
):
    """Generates and links a balanced General Ledger transaction for the payroll run."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.post_journal(run_id=run_id, user_email=user_email)


@router.get("/payslips/my", response_model=List[EmployeePayslipResponse])
def list_my_payslips(
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("self.payslip.read")),
):
    """Returns personal payslips for the authenticated employee."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else ""
    return service.get_my_payslips(user_email=user_email)


@router.get("/runs/{run_id}/payslips/{employee_id}", response_model=EmployeePayslipResponse)
def get_employee_payslip(
    run_id: int = Path(..., description="Payroll Run ID"),
    employee_id: int = Path(..., description="Employee ID"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Itemized payslip detail for a specific employee on a run."""
    return service.get_employee_payslip(run_id=run_id, employee_id=employee_id)


@router.get("/settings", response_model=PayrollSettingsResponse)
def get_payroll_settings(
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Get current organization-wide social insurance contribution rates."""
    return service.get_payroll_settings()


@router.put("/settings", response_model=PayrollSettingsResponse)
def update_payroll_settings(
    payload: PayrollSettingsUpdate,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.settings.write")),
):
    """Update organization-wide social insurance contribution rates (Super Admin only)."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.update_payroll_settings(
        employee_rate=payload.employee_rate,
        employer_rate=payload.employer_rate,
        user_email=user_email,
    )


# -----------------------------------------------------------------------------
# Effective-Dated Income Tax Settings Endpoints (D-009)
# -----------------------------------------------------------------------------
@router.get("/tax-settings/template")
def get_tax_brackets_template(
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll_tax.read")),
):
    """Get owner-approved default tax brackets and limit template."""
    return service.get_default_tax_brackets_template()


@router.get("/tax-settings/effective", response_model=PayrollTaxSettingsResponse)
def get_effective_tax_settings(
    period_start: str = Query(..., description="First day of payroll period YYYY-MM-01"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll_tax.read")),
):
    """Resolve effective income tax settings for a payroll period."""
    settings = service.get_effective_tax_settings(period_start)
    if not settings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No effective tax settings found on or before {period_start}",
        )
    return settings


@router.get("/tax-settings", response_model=List[PayrollTaxSettingsResponse])
def list_tax_settings(
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll_tax.read")),
):
    """List all effective-dated income tax settings versions."""
    return service.list_tax_settings()


@router.post("/tax-settings", response_model=PayrollTaxSettingsResponse, status_code=status.HTTP_201_CREATED)
def create_tax_settings(
    payload: PayrollTaxSettingsCreate,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll_tax.write")),
):
    """Create a new effective-dated payroll tax settings version (Super-Admin / Financial-Admin only)."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    brackets_dicts = [b.model_dump() for b in payload.brackets]
    return service.create_tax_settings(
        effective_from=payload.effective_from,
        tax_limit_p_egp=payload.tax_limit_p_egp,
        brackets=brackets_dicts,
        user_email=user_email,
    )


