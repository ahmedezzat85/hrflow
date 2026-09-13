"""
be/finance/routers/reports.py
Financial Reporting & Excel Export Router.
All endpoints are gated with RBAC permission 'finance.report.read'.
Supports dual-format responses: default JSON (for UI tables) and XLSX (for Excel download).
"""
from typing import Dict, Any, Optional, Set
from datetime import datetime
from fastapi import APIRouter, Depends, Query, Response, Path

from core.permissions import require_permission, get_current_user_permissions
from finance.deps import get_reports_service, get_attention_service, get_forecast_service
from finance.services.reports_service import ReportsService
from finance.services.attention_service import AttentionQueueService
from finance.services.forecast_service import CashForecastService
from finance.schemas import AttentionQueueResponse, AttentionReviewRequest, CashForecastResponse
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
    search: Optional[str] = Query(None, description="Search reference/description/cheque"),
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
