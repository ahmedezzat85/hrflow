"""
be/finance/routers/payroll.py
API router for Guided Payroll Runs, Lifecycle State Transitions,
Disbursements, GL Journal Posting, and Employee Payslips (Story 8.1).
"""
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, Query, Path, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from core.permissions import require_permission
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
    """Lists company payroll runs with metadata and lifecycle status."""
    return service.list_runs(status_filter=status, search=search, limit=limit, offset=offset)


@router.post("/runs/preview", response_model=PayrollRunPreviewResponse)
def preview_payroll_run(
    req: PayrollRunPreviewRequest,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.write")),
):
    """
    Evaluates active staff to preview payroll calculations,
    detect readiness exceptions, evaluate variance vs prior period, and preview balanced GL journal.
    """
    return service.preview_run(
        period_label=req.period_label,
        period_start=req.period_start,
        period_end=req.period_end,
        bank_account_id=req.bank_account_id,
        fx_rate_source=req.fx_rate_source,
        fx_rate_value=req.fx_rate_value,
    )


@router.post("/runs/generate", response_model=PayrollRunResponse, status_code=status.HTTP_201_CREATED)
def generate_payroll_run_from_plans(
    req: PayrollRunGenerateRequest,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.write")),
):
    """Generates a payroll run and split lines directly from active employee compensation plans (FUX-417)."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.generate_run_from_compensation_plans(
        period_label=req.period_label,
        period_start=req.period_start,
        period_end=req.period_end,
        fx_rate_source=req.fx_rate_source or "first_of_month",
        fx_rate_value=req.fx_rate_value,
        bank_account_id=req.bank_account_id,
        user_email=user_email,
    )


@router.post("/runs", response_model=PayrollRunResponse, status_code=status.HTTP_201_CREATED)
def create_payroll_run(
    req: PayrollRunCreate,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.write")),
):
    """Creates a guided payroll run and snapshots employee line items."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.create_run(
        period_label=req.period_label,
        period_start=req.period_start,
        period_end=req.period_end,
        bank_account_id=req.bank_account_id,
        currency=req.currency,
        user_email=user_email,
        fx_rate_source=req.fx_rate_source,
        fx_rate_value=req.fx_rate_value,
    )


@router.get("/runs/{run_id}", response_model=PayrollRunResponse)
def get_payroll_run_detail(
    run_id: int = Path(..., description="Payroll Run ID"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.read")),
):
    """Returns complete payroll run detail including employee lines, liabilities, exceptions, and journal info."""
    return service.get_run(run_id=run_id)


@router.post("/runs/{run_id}/lines", response_model=PayrollLineResponse, status_code=status.HTTP_201_CREATED)
def add_payroll_line(
    run_id: int = Path(..., description="Payroll Run ID"),
    req: PayrollLineCreate = ...,
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.write")),
):
    """Adds an ad-hoc commission or bonus line to a draft payroll run (FUX-418)."""
    return service.add_ad_hoc_line(
        run_id=run_id,
        employee_id=req.employee_id,
        compensation_type=req.compensation_type,
        amount=req.amount or req.base_salary,
        notes=req.notes or req.snapshot_notes,
        is_taxable_local=req.is_taxable_local,
        is_insurable=req.is_insurable,
    )


@router.delete("/runs/{run_id}/lines/{line_id}")
def delete_payroll_line(
    run_id: int = Path(..., description="Payroll Run ID"),
    line_id: int = Path(..., description="Payroll Line ID to delete"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.write")),
):
    """Removes an ad-hoc or mistakenly added line from a draft payroll run (FUX-418)."""
    return service.delete_line(run_id=run_id, line_id=line_id)


@router.post("/runs/{run_id}/approve", response_model=PayrollRunResponse)
def approve_payroll_run(
    run_id: int = Path(..., description="Payroll Run ID to approve"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.write")),
):
    """Maker-checker approval for payroll run. Enforces blocking exception verification."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.approve_run(run_id=run_id, user_email=user_email)


@router.post("/runs/{run_id}/finalize", response_model=PayrollRunResponse)
def finalize_payroll_run(
    run_id: int = Path(..., description="Payroll Run ID to finalize"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.write")),
):
    """Locks the payroll run against edits and enables funding/disbursement."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.finalize_run(run_id=run_id, user_email=user_email)


@router.post("/runs/{run_id}/pay", response_model=PayrollRunResponse)
def execute_payroll_payment(
    req: PayrollPaymentRequest,
    run_id: int = Path(..., description="Payroll Run ID to disburse"),
    service: PayrollService = Depends(get_payroll_service),
    current_user: dict = Depends(require_permission("finance.payroll.write")),
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
    current_user: dict = Depends(require_permission("finance.payroll.write")),
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
