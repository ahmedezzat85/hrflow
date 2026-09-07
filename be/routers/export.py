"""
be/routers/export.py
Router handling Admin data exports to local CSV and Google Sheets.
HRFlow uses SQL exclusively for operational data, with Google Sheets available
as an export destination for HR reporting.
"""
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from auth import require_admin
from config import Config
from deps import audit_log
from models import SheetsExportRequest
from repositories.interfaces import AuditRepository
from repositories.deps import get_audit_repo
from services.export import (
    format_csv,
    get_employees_export_data,
    get_insurance_export_data,
    get_salary_history_export_data,
    get_vacations_export_data,
    get_invoices_export_data,
    export_to_google_sheets,
)
from logging_config import get_logger

logger = get_logger("routers.export")

router = APIRouter(prefix="/api/export", tags=["Export"])

VALID_DATASETS = {
    "employees": "Employees Directory",
    "insurance": "Medical Insurance Claims",
    "salary": "Salary & Raise History",
    "vacations": "Vacation & Leaves",
    "invoices": "Contractor Invoices",
}


def _extract_dataset_data(
    dataset: str,
    year: Optional[int] = None,
    month: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
):
    if dataset == "employees":
        return get_employees_export_data()
    elif dataset == "insurance":
        return get_insurance_export_data(year=year, start_date=start_date, end_date=end_date, status=status)
    elif dataset == "salary":
        return get_salary_history_export_data()
    elif dataset == "vacations":
        return get_vacations_export_data(year=year)
    elif dataset == "invoices":
        return get_invoices_export_data(year=year, month=month)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid dataset '{dataset}'. Must be one of: {list(VALID_DATASETS.keys())}",
        )


@router.get("/status")
def get_export_status(current_user: dict = Depends(require_admin)):
    """Checks whether the Google Sheets export integration is configured."""
    has_creds = bool(Config.GOOGLE_CREDENTIALS_FILE and os.path.exists(Config.GOOGLE_CREDENTIALS_FILE))
    has_sheet_id = bool(Config.SPREADSHEET_ID and Config.SPREADSHEET_ID.strip())
    sheets_ready = has_creds and has_sheet_id

    return {
        "google_sheets_available": sheets_ready,
        "spreadsheet_id": Config.SPREADSHEET_ID if sheets_ready else None,
        "datasets": VALID_DATASETS,
    }


@router.get("/{dataset}/csv")
def export_dataset_csv(
    dataset: str,
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    current_user: dict = Depends(require_admin),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    """Exports the specified HR dataset as a local CSV download (UTF-8 with BOM)."""
    dataset_key = dataset.lower().strip()
    headers, rows = _extract_dataset_data(
        dataset_key,
        year=year,
        month=month,
        start_date=start_date,
        end_date=end_date,
        status=status,
    )

    csv_bytes = format_csv(headers, rows)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"hrflow_{dataset_key}_{timestamp}.csv"

    # Audit log
    audit_log(
        audit_repo,
        action="export_csv",
        actor_email=current_user["email"],
        target_type=dataset_key,
        target_id=None,
        details=f"Exported {len(rows)} records to CSV ({filename})",
    )

    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.post("/{dataset}/sheets")
def export_dataset_to_google_sheets(
    dataset: str,
    payload: SheetsExportRequest = SheetsExportRequest(),
    current_user: dict = Depends(require_admin),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    """Exports the specified HR dataset to a worksheet in Google Sheets."""
    dataset_key = dataset.lower().strip()

    # Verify Google Sheets configuration
    if not Config.SPREADSHEET_ID:
        raise HTTPException(
            status_code=400,
            detail="Google Sheets export is not configured (SPREADSHEET_ID is missing). Please download as CSV instead.",
        )

    headers, rows = _extract_dataset_data(
        dataset_key,
        year=payload.year,
        month=payload.month,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status=payload.status,
    )

    # Determine worksheet title
    date_tag = datetime.utcnow().strftime("%Y%m%d_%H%M")
    default_title = f"Export_{dataset_key.capitalize()}_{date_tag}"
    worksheet_title = payload.worksheet_title.strip() if payload.worksheet_title else default_title

    try:
        result = export_to_google_sheets(worksheet_title=worksheet_title, headers=headers, rows=rows)
    except Exception as exc:
        logger.exception("Google Sheets export failed for dataset '%s'", dataset_key)
        raise HTTPException(
            status_code=502,
            detail=f"Failed to export to Google Sheets: {str(exc)}. Please check Google service account credentials and permissions.",
        )

    # Audit log
    audit_log(
        audit_repo,
        action="export_sheets",
        actor_email=current_user["email"],
        target_type=dataset_key,
        target_id=None,
        details=f"Exported {len(rows)} records to Google Sheet worksheet '{worksheet_title}'",
    )

    return {
        "success": True,
        "message": f"Successfully exported {len(rows)} records to Google Sheets worksheet '{worksheet_title}'",
        "worksheet_title": result["worksheet_title"],
        "spreadsheet_url": result["spreadsheet_url"],
        "spreadsheet_id": result["spreadsheet_id"],
        "rows_count": result["rows_count"],
    }
