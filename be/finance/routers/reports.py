"""
be/finance/routers/reports.py
Financial Reporting & Excel Export Router.
All endpoints are gated with RBAC permission 'finance.report.read'.
Supports dual-format responses: default JSON (for UI tables) and XLSX (for Excel download).
"""
from typing import Dict, Any, Optional, Set, List
from datetime import datetime
from fastapi import APIRouter, Depends, Query, Response, Path

from core.permissions import require_permission, get_current_user_permissions
from finance.deps import get_reports_service, get_attention_service, get_forecast_service
from finance.services.reports_service import ReportsService
from finance.services.attention_service import AttentionQueueService
from finance.services.forecast_service import CashForecastService
from finance.schemas import (
    AttentionQueueResponse,
    AttentionReviewRequest,
    CashForecastResponse,
    ReportLibraryResponse,
    SavedReportViewCreate,
    SavedReportViewResponse,
    ReportDrilldownResponse,
    ProfitAndLossResponse,
    BalanceSheetResponse,
    TrialBalanceResponse,
    CashFlowStatementResponse,
    AgingReportResponse,
    ReportExportRequest,
    ReportExportAuditResponse,
    ReportScheduleCreate,
    ReportScheduleResponse,
    EmployeeCompensationReportResponse,
    CompanyCompensationReportResponse,
    StatutoryRemittedReportResponse,
    PayableStatusReportResponse,
)
from finance.services.excel_exporter import (
    export_transactions_xlsx,
    export_category_summary_xlsx,
    export_category_matrix_xlsx,
    export_balances_xlsx,
    export_cheques_xlsx,
)

router = APIRouter(prefix="/api/finance/reports", tags=["Finance - Reports"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/summary", response_model=Dict[str, Any])
def get_finance_summary(
    entity: Optional[str] = Query("all", description="Company / Entity filter (e.g. 'all', 'Voyance Health', 'Voyance US')"),
    period: str = Query("MTD", description="Period filter: MTD, QTD, YTD, all"),
    basis: str = Query("cash", pattern="^(cash|accrual)$", description="Accounting basis: cash or accrual"),
    currency: str = Query("USD", description="Currency filter: USD, EGP, all"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """KPI metric summary for executive finance dashboard with contextual scoping and metadata."""
    return service.get_finance_summary(
        entity=entity,
        period=period,
        basis=basis,
        currency=currency,
    )


@router.get("/attention-queue", response_model=AttentionQueueResponse)
def get_attention_queue(
    severity: str = Query("all", description="Filter by severity: all, urgent, warning, info"),
    item_type: str = Query("all", description="Filter by type: all, overdue_receivable, bill_due, pending_approval, unreconciled_statement, negative_cash, bounced_cheque"),
    owner: Optional[str] = Query(None, description="Filter by owner or counterparty contact"),
    search: Optional[str] = Query(None, description="Keyword search in title, counterparty, and description"),
    include_reviewed: bool = Query(False, description="Whether to include previously reviewed/resolved items"),
    limit: int = Query(50, ge=1, le=200, description="Max items to return"),
    service: AttentionQueueService = Depends(get_attention_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
    user_permissions: Set[str] = Depends(get_current_user_permissions),
):
    """
    Consolidated Needs-Attention queue for the finance overview dashboard (Story 2.2).
    Aggregates exceptions across authorized finance domains with deterministic priority rules.
    """
    return service.get_attention_queue(
        current_user=current_user,
        user_permissions=user_permissions,
        severity=severity,
        item_type=item_type,
        owner=owner,
        search=search,
        include_reviewed=include_reviewed,
        limit=limit,
    )


@router.post("/attention-queue/{item_key:path}/review")
def review_attention_item(
    item_key: str = Path(..., description="Deduplication key of the attention item"),
    payload: Optional[AttentionReviewRequest] = None,
    service: AttentionQueueService = Depends(get_attention_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Marks an attention queue item as reviewed or resolved so it disappears on refresh.
    """
    status = payload.status if payload else "reviewed"
    notes = payload.notes if payload else ""
    user_email = current_user.get("email") or "finance.operator"
    record = service.review_item(
        item_key=item_key,
        status=status,
        reviewed_by=user_email,
        notes=notes,
    )
    return {
        "success": True,
        "deduplication_key": record.deduplication_key,
        "status": record.status,
        "reviewed_by": record.reviewed_by,
        "reviewed_at": record.reviewed_at.isoformat() if record.reviewed_at else None,
    }


@router.get("/cash-forecast", response_model=CashForecastResponse)
def get_cash_forecast(
    currency: str = Query("all", description="Currency filter: all, USD, EGP"),
    horizon_days: int = Query(90, ge=30, le=180, description="Forecast horizon in days (e.g. 30, 60, 90)"),
    include_expected: bool = Query(True, description="Whether to include expected recurring subscriptions"),
    service: CashForecastService = Depends(get_forecast_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Cash position and 30/60/90-day forecast for the executive finance dashboard (Story 2.3).
    Differentiates bank vs book balance, separates available and reconciled balances,
    and breaks down confirmed contractual obligations from estimated expected items.
    """
    return service.get_cash_forecast(
        currency=currency,
        horizon_days=horizon_days,
        include_expected=include_expected,
    )


@router.get("/transactions")
def get_transactions_report(
    date_from: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    account_id: Optional[int] = Query(None, description="Filter by bank account ID"),
    category_id: Optional[int] = Query(None, description="Filter by category ID"),
    payment_type_id: Optional[int] = Query(None, description="Filter by payment type ID"),
    direction: Optional[str] = Query(None, description="Filter by direction ('in' or 'out')"),
    search: Optional[str] = Query(None, description="Search reference/description/cheque/payee"),
    payee_type: Optional[str] = Query(None, description="Filter by payee type ('none', 'vendor', 'employee')"),
    include_internal: bool = Query(True, description="Whether to include internal employee disbursements"),
    format: str = Query("json", pattern="^(json|xlsx)$"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Arbitrary-range transaction ledger report with running totals and multi-criteria filters.
    """
    data = service.get_transactions_report(
        date_from=date_from,
        date_to=date_to,
        account_id=account_id,
        category_id=category_id,
        payment_type_id=payment_type_id,
        direction=direction,
        search=search,
        payee_type=payee_type,
        include_internal=include_internal,
    )

    if format == "xlsx":
        xlsx_bytes = export_transactions_xlsx(data)
        filename = f"transactions_ledger_{date_from or 'start'}_to_{date_to or 'end'}.xlsx"
        return Response(
            content=xlsx_bytes,
            media_type=XLSX_MIME,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return data


@router.get("/category-summary")
def get_category_summary_report(
    date_from: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    currency: Optional[str] = Query(None, description="Filter by currency"),
    include_internal: bool = Query(True, description="Whether to include internal employee disbursements"),
    format: str = Query("json", pattern="^(json|xlsx)$"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Category spend rollup mirroring the monthly SPENT block.
    """
    data = service.get_category_summary_report(
        date_from=date_from,
        date_to=date_to,
        currency=currency,
        include_internal=include_internal,
    )

    if format == "xlsx":
        xlsx_bytes = export_category_summary_xlsx(data)
        filename = f"category_spend_rollup_{date_from or 'start'}_to_{date_to or 'end'}.xlsx"
        return Response(
            content=xlsx_bytes,
            media_type=XLSX_MIME,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return data


@router.get("/category-by-period-matrix")
def get_category_by_period_matrix(
    year: int = Query(default=2026, description="Fiscal / Calendar Year"),
    period_group: str = Query("month", pattern="^(month|quarter)$", description="Group by month or quarter"),
    currency: Optional[str] = Query(None, description="Filter by currency"),
    include_internal: bool = Query(True, description="Whether to include internal employee disbursements"),
    format: str = Query("json", pattern="^(json|xlsx)$"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Annual Category × Period matrix (Jan-Dec or Q1-Q4) with row totals and % of total spend.
    """
    data = service.get_category_by_period_matrix(
        year=year,
        period_group=period_group,
        currency=currency,
        include_internal=include_internal,
    )

    if format == "xlsx":
        xlsx_bytes = export_category_matrix_xlsx(data)
        filename = f"spend_matrix_{year}_{period_group}.xlsx"
        return Response(
            content=xlsx_bytes,
            media_type=XLSX_MIME,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return data


@router.get("/balances")
def get_point_in_time_balances(
    as_of_date: Optional[str] = Query(None, description="As of date (YYYY-MM-DD, defaults to today)"),
    format: str = Query("json", pattern="^(json|xlsx)$"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Calculates point-in-time balances for all bank/cash accounts excluding transactions after as_of_date.
    """
    if not as_of_date:
        as_of_date = datetime.utcnow().strftime("%Y-%m-%d")

    data = service.get_point_in_time_balances(as_of_date=as_of_date)

    if format == "xlsx":
        xlsx_bytes = export_balances_xlsx(data)
        filename = f"account_balances_as_of_{as_of_date}.xlsx"
        return Response(
            content=xlsx_bytes,
            media_type=XLSX_MIME,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return data


@router.get("/cheques")
def get_cheques_report(
    fiscal_year: Optional[int] = Query(None, description="Fiscal year (defaults to current year)"),
    account_id: Optional[int] = Query(None, description="Filter by bank account"),
    status: Optional[str] = Query(None, description="Filter by status (issued/cleared/bounced/voided)"),
    format: str = Query("json", pattern="^(json|xlsx)$"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Cheque register report by fiscal year with status breakdown and totals.
    """
    if not fiscal_year:
        fiscal_year = datetime.utcnow().year

    data = service.get_cheques_report(
        fiscal_year=fiscal_year,
        account_id=account_id,
        status=status,
    )

    if format == "xlsx":
        xlsx_bytes = export_cheques_xlsx(data)
        filename = f"cheque_register_FY{fiscal_year}.xlsx"
        return Response(
            content=xlsx_bytes,
            media_type=XLSX_MIME,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return data


# =========================================================================
# Story 7.1: Standard Report Library & Shell Endpoints
# =========================================================================

@router.get("/library", response_model=ReportLibraryResponse)
def get_report_library(
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Returns the standard report library catalog grouped into 6 business question domains.
    """
    return service.get_report_library()


@router.get("/saved-views", response_model=List[SavedReportViewResponse])
def list_saved_report_views(
    report_key: Optional[str] = Query(None, description="Filter by report key"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Lists saved filter definitions and preset views for reports.
    """
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.list_saved_views(report_key=report_key, user_email=user_email)


@router.post("/saved-views", response_model=SavedReportViewResponse)
def create_saved_report_view(
    req: SavedReportViewCreate,
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Saves a report view definition (filters, basis, period, currency) for one-click restoration.
    """
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    try:
        return service.create_saved_view(
            report_key=req.report_key,
            view_name=req.view_name,
            filters=req.filters,
            user_email=user_email,
            is_default=req.is_default,
        )
    except ValueError as ex:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ex))


@router.delete("/saved-views/{view_id}")
def delete_saved_report_view(
    view_id: int,
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Deletes a saved report view definition.
    """
    from fastapi import HTTPException, status
    deleted = service.delete_saved_view(view_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved view not found")
    return {"success": True, "id": view_id}


@router.get("/drilldown", response_model=ReportDrilldownResponse)
def get_report_drilldown(
    report_key: str = Query(..., description="Report identifier"),
    drilldown_type: str = Query(..., description="category | account | cheques | etc"),
    drilldown_id: Optional[str] = Query(None, description="Identifier of category, account, etc"),
    date_from: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    currency: Optional[str] = Query(None, description="Currency filter"),
    entity: Optional[str] = Query(None, description="Entity filter"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Fetches the granular contributing ledger transactions or documents
    for a clicked total, cell, or category in any report without losing context.
    """
    return service.get_report_drilldown(
        report_key=report_key,
        drilldown_type=drilldown_type,
        drilldown_id=drilldown_id,
        date_from=date_from,
        date_to=date_to,
        currency=currency,
        entity=entity,
    )


# ----------------------------------------------------------------------
# Core Accounting & Aging Reports Endpoints (Story 7.2)
# ----------------------------------------------------------------------
@router.get("/profit-and-loss", response_model=ProfitAndLossResponse)
def get_profit_and_loss(
    entity: Optional[str] = Query("all", description="Entity filter"),
    date_from: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    basis: str = Query("cash", pattern="^(cash|accrual)$", description="Accounting basis: cash or accrual"),
    currency: str = Query("USD", description="Currency filter"),
    comparison: str = Query("none", pattern="^(none|prior_period|prior_year)$", description="Comparison type"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """Profit & Loss Statement supporting cash/accrual basis and period comparisons."""
    return service.get_profit_and_loss(
        entity=entity,
        date_from=date_from,
        date_to=date_to,
        basis=basis,
        currency=currency,
        comparison=comparison,
    )


@router.get("/balance-sheet", response_model=BalanceSheetResponse)
def get_balance_sheet(
    entity: Optional[str] = Query("all", description="Entity filter"),
    as_of_date: Optional[str] = Query(None, description="As of date (YYYY-MM-DD)"),
    basis: str = Query("accrual", pattern="^(cash|accrual)$", description="Accounting basis"),
    currency: str = Query("USD", description="Currency filter"),
    comparison: str = Query("none", description="Comparison mode"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """Balance Sheet displaying Assets, Liabilities, and Balancing Equity as of cutoff date."""
    return service.get_balance_sheet(
        entity=entity,
        as_of_date=as_of_date,
        basis=basis,
        currency=currency,
        comparison=comparison,
    )


@router.get("/trial-balance", response_model=TrialBalanceResponse)
def get_trial_balance(
    entity: Optional[str] = Query("all", description="Entity filter"),
    as_of_date: Optional[str] = Query(None, description="As of date (YYYY-MM-DD)"),
    currency: str = Query("USD", description="Currency filter"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """Trial Balance report ensuring Debits == Credits with zero net variance."""
    return service.get_trial_balance(
        entity=entity,
        as_of_date=as_of_date,
        currency=currency,
    )


@router.get("/cash-flow", response_model=CashFlowStatementResponse)
def get_cash_flow_statement(
    entity: Optional[str] = Query("all", description="Entity filter"),
    date_from: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    currency: str = Query("USD", description="Currency filter"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """Statement of Cash Flows reconciling Operating and Financing activities with liquidity."""
    return service.get_cash_flow_statement(
        entity=entity,
        date_from=date_from,
        date_to=date_to,
        currency=currency,
    )


@router.get("/ar-aging", response_model=AgingReportResponse)
def get_ar_aging_report(
    entity: Optional[str] = Query("all", description="Entity filter"),
    as_of_date: Optional[str] = Query(None, description="As of date (YYYY-MM-DD)"),
    currency: str = Query("USD", description="Currency filter"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """Accounts Receivable Aging schedule partitioned into 30-day buckets per customer."""
    return service.get_ar_aging_report(
        entity=entity,
        as_of_date=as_of_date,
        currency=currency,
    )


@router.get("/ap-aging", response_model=AgingReportResponse)
def get_ap_aging_report(
    entity: Optional[str] = Query("all", description="Entity filter"),
    as_of_date: Optional[str] = Query(None, description="As of date (YYYY-MM-DD)"),
    currency: str = Query("USD", description="Currency filter"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """Accounts Payable Aging schedule partitioned into 30-day buckets per vendor."""
    return service.get_ap_aging_report(
        entity=entity,
        as_of_date=as_of_date,
        currency=currency,
    )


# =========================================================================
# Story 7.3: Controlled Exports & Scheduled Delivery
# =========================================================================

@router.post("/export")
def export_report_file(
    req: ReportExportRequest,
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
    user_perms: Set[str] = Depends(get_current_user_permissions),
):
    """
    Standardized export service for all financial reports (Story 7.3).
    Includes complete metadata, formula-injection defense, and role-based data redaction.
    Records an immutable audit event for every export operation.
    """
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    can_view_sensitive = "finance.bank.manage" in user_perms or "finance.admin" in user_perms or "admin" in user_perms

    file_bytes, file_name, mime_type = service.generate_report_export(
        report_key=req.report_key,
        export_format=req.format,
        filters=req.filters,
        user_email=user_email,
        can_view_sensitive=can_view_sensitive,
    )

    return Response(
        content=file_bytes,
        media_type=mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{file_name}"',
            "X-Export-Report-Key": req.report_key,
            "X-Export-Format": req.format.lower(),
        },
    )


@router.get("/export-audits", response_model=List[ReportExportAuditResponse])
def list_export_audits(
    report_key: Optional[str] = Query(None, description="Filter audits by report key"),
    limit: int = Query(50, ge=1, le=200, description="Max audit records"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Returns audit trail of report downloads and exports with requesting user and filter metadata.
    """
    return service.list_export_audits(report_key=report_key, limit=limit)


@router.get("/schedules", response_model=List[ReportScheduleResponse])
def list_report_schedules(
    report_key: Optional[str] = Query(None, description="Filter schedules by report key"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Lists automated and scheduled report deliveries.
    """
    return service.list_schedules(report_key=report_key)


@router.post("/schedules", response_model=ReportScheduleResponse)
def create_report_schedule(
    req: ReportScheduleCreate,
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Creates a scheduled report delivery with defined frequency, recipient list, and filters.
    """
    user_email = current_user.get("email") if isinstance(current_user, dict) else None
    return service.create_schedule(
        report_key=req.report_key,
        report_title=req.report_title,
        frequency=req.frequency,
        recipients=req.recipients,
        export_format=req.export_format,
        filters=req.filters,
        created_by=user_email,
    )


@router.delete("/schedules/{schedule_id}")
def delete_report_schedule(
    schedule_id: int = Path(..., description="Schedule ID to cancel"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Cancels and removes a scheduled report delivery.
    """
    from fastapi import HTTPException, status
    deleted = service.delete_schedule(schedule_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report schedule not found")
    return {"success": True, "id": schedule_id}


# =========================================================================
# FUX-419: Compensation & Spend Reporting Endpoints
# =========================================================================

@router.get("/compensation/employee/{employee_id}", response_model=EmployeeCompensationReportResponse)
def get_employee_compensation_report(
    employee_id: int = Path(..., description="Employee ID"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    currency: str = Query("USD", description="Currency filter"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Per-employee compensation report: total external, internal, commission, bonus,
    and grand total for a given employee across an arbitrary date range.
    """
    return service.get_employee_compensation_report(
        employee_id=employee_id,
        start_date=start_date,
        end_date=end_date,
        currency=currency,
    )


@router.get("/compensation/company", response_model=CompanyCompensationReportResponse)
def get_company_compensation_report(
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    currency: str = Query("USD", description="Currency filter"),
    breakdown_employees: bool = Query(True, description="Include per-employee breakdown"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Company salary spend report: aggregate total compensation across all employees
    for a selected period, broken down by compensation type, with per-employee breakdown.
    """
    return service.get_company_compensation_report(
        start_date=start_date,
        end_date=end_date,
        currency=currency,
        breakdown_employees=breakdown_employees,
    )


@router.get("/statutory/remitted", response_model=StatutoryRemittedReportResponse)
def get_statutory_remitted_report(
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    currency: str = Query("USD", description="Currency filter"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Statutory obligations paid report: sums StatutoryObligationDB.amount_remitted
    grouped by obligation_type and period, filtered to periods within range.
    """
    return service.get_statutory_remitted_report(
        start_date=start_date,
        end_date=end_date,
        currency=currency,
    )


@router.get("/payroll/payable-status", response_model=PayableStatusReportResponse)
def get_payroll_payable_status_report(
    period: Optional[str] = Query(None, description="Payroll period (e.g. 2026-09)"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    employee_id: Optional[int] = Query(None, description="Optional employee filter"),
    currency: str = Query("USD", description="Currency filter"),
    service: ReportsService = Depends(get_reports_service),
    current_user: dict = Depends(require_permission("finance.report.read")),
):
    """
    Payable/paid status view: one row per money-flow type (external, internal, tax, insurance)
    per employee/company with pending/settled amounts.
    """
    return service.get_payroll_payable_status_report(
        period=period,
        start_date=start_date,
        end_date=end_date,
        employee_id=employee_id,
        currency=currency,
    )




