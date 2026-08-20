"""
sheets_client.py
Thin data-access layer over Google Sheets using gspread.
Includes in-memory TTL caching, write invalidation, batch row updates,
and quota error resilience.
"""
import copy
import random
import time
from threading import Lock
from typing import Optional

import gspread
from gspread import Cell
from google.oauth2.service_account import Credentials

from config import Config
from logging_config import get_logger

logger = get_logger("sheets_client")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

SHEET_SCHEMAS = {
    "Employees": ["id","name","email","role","dept","job_role",
                  "salary","join_date","status","vac_total","vac_used","next_raise",
                  "employment_state","internal_salary_usd","external_salary_usd",
                  "invoice_id","address_line_1","address_line_2"],
    "Requests": ["id","employee_id","employee_name","type","details","date",
                 "status","reviewed_by","reviewed_at","submitted_by"],
    "VacationHistory": ["id","employee_id","type","start_date","end_date","days","status","submitted_by"],
    "InsuranceClaims": ["id","employee_id","employee_name","category","provider",
                         "amount","date","status","document_url","submitted_by"],
    "InsuranceCategories": ["id","name","annual_limit"],
    "SalaryHistory": ["id","employee_id","date","previous_salary","new_salary",
                       "pct_change","reason","applied_by",
                       "previous_internal_usd","previous_external_usd",
                       "new_internal_usd","new_external_usd"],
    "Users": ["email","role","employee_id"],
    "EmployeeNotes": ["id","employee_id","date","category","note","created_by"],
    "EmployeeDocuments": [
        "id","employee_id","name","file_type","data_url",
        "uploaded_by","uploaded_at","drive_file_id","view_url","download_url"
    ],
    "CompanyDocuments": [
        "id","name","file_type","category","drive_file_id",
        "view_url","download_url","uploaded_by","uploaded_at"
    ],
    # External-salary invoice generation (docs/analysis/invoice-autopay-plan.md).
    # One row per successfully-generated (or attempted) invoice, keyed by
    # employee + payment period, to enforce idempotency and provide history.
    "Invoices": [
        "id","employee_id","employee_name","invoice_number",
        "payment_year","payment_month","invoice_date","amount_usd",
        "currency","document_name","drive_file_id","drive_web_url",
        "template_version","status","failure_reason",
        "generated_by","created_at",
    ],
}

REQUIRED_COLUMNS = {
    "Employees": ["employment_state", "internal_salary_usd", "external_salary_usd",
                  "invoice_id", "address_line_1", "address_line_2"],
    "SalaryHistory": ["previous_internal_usd", "previous_external_usd",
                       "new_internal_usd", "new_external_usd"],
}

_lock = Lock()
_instance_lock = Lock()


def _is_quota_error(exc: Exception) -> bool:
    """Checks whether an exception represents a Google API 429 / Quota Exceeded error."""
    err_str = str(exc).lower()
    if "quota" in err_str or "resource_exhausted" in err_str or "rate limit" in err_str:
        return True
    if hasattr(exc, "response") and getattr(exc.response, "status_code", None) == 429:
        return True
    return False


class SheetsClient:
    _instance = None

    def __new__(cls):
        if cls._instance is not None:
            return cls._instance
        with _instance_lock:
            if cls._instance is None:
                instance = super().__new__(cls)
                instance._cache = {}
                instance._worksheets = {}
                instance._headers = {}
                instance._connect()
                cls._instance = instance
        return cls._instance

    def _connect(self):
        logger.info("Connecting to Google Sheets (spreadsheet_id=%s)", Config.SPREADSHEET_ID)
        try:
            creds = Credentials.from_service_account_file(
                Config.GOOGLE_CREDENTIALS_FILE, scopes=SCOPES
            )
            self.gc = gspread.authorize(creds)
            self.spreadsheet = self.gc.open_by_key(Config.SPREADSHEET_ID)
        except Exception:
            logger.exception("Failed to connect to Google Sheets. Check GOOGLE_CREDENTIALS_FILE and SPREADSHEET_ID.")
            raise
        logger.info("Connected to Google Sheets successfully")
        self._ensure_tabs_exist()

    def _ensure_tabs_exist(self):
        try:
            worksheets = self.spreadsheet.worksheets()
            existing = {ws.title: ws for ws in worksheets}
            self._worksheets.update(existing)
        except Exception:
            logger.exception("Failed to list worksheets from spreadsheet")
            existing = {}

        for tab_name, headers in SHEET_SCHEMAS.items():
            if tab_name not in existing:
                logger.info("Creating missing sheet tab '%s' with headers %s", tab_name, headers)
                ws = self.spreadsheet.add_worksheet(title=tab_name, rows=1000, cols=len(headers))
                ws.append_row(headers)
                self._worksheets[tab_name] = ws
                self._headers[tab_name] = headers
            else:
                ws = self._ws(tab_name)
                first_row = self._headers_for(tab_name, force_refresh=True)
                if not first_row:
                    logger.warning("Sheet tab '%s' exists but has no header row - adding headers", tab_name)
                    ws.append_row(headers)
                    self._headers[tab_name] = headers
                if tab_name == "EmployeeDocuments":
                    legacy_headers = [
                        "id","employee_id","name","file_type","data_url",
                        "uploaded_by","uploaded_at"
                    ]
                    if first_row == legacy_headers:
                        try:
                            ws.update('A1:J1', [SHEET_SCHEMAS["EmployeeDocuments"]])
                            self._headers[tab_name] = SHEET_SCHEMAS["EmployeeDocuments"]
                            logger.info(
                                "Migrated EmployeeDocuments header from legacy %s to union %s",
                                legacy_headers, SHEET_SCHEMAS["EmployeeDocuments"]
                            )
                        except Exception:
                            logger.exception(
                                "Failed to migrate EmployeeDocuments header row to union schema"
                            )

        self._ensure_required_columns()

    def _ensure_required_columns(self):
        """Appends any REQUIRED_COLUMNS missing from an existing tab's
        header row, so older spreadsheets gain newly introduced columns
        (e.g. Employees.employment_state) without manual edits."""
        for tab_name, required in REQUIRED_COLUMNS.items():
            try:
                ws = self._ws(tab_name)
            except Exception:
                continue
            headers = self._headers_for(tab_name)
            if not headers:
                continue
            for col in required:
                if col not in headers:
                    try:
                        new_idx = len(headers) + 1
                        if ws.col_count < new_idx:
                            ws.add_cols(new_idx - ws.col_count)
                        ws.update_cell(1, new_idx, col)
                        headers.append(col)
                        self._headers[tab_name] = headers
                        logger.info("Added missing column '%s' to tab '%s' (position %d)", col, tab_name, new_idx)
                    except Exception:
                        logger.exception("Failed to add missing column '%s' to tab '%s'", col, tab_name)

    def _ws(self, tab_name: str):
        if tab_name in self._worksheets:
            return self._worksheets[tab_name]
        try:
            ws = self.spreadsheet.worksheet(tab_name)
            self._worksheets[tab_name] = ws
            return ws
        except gspread.exceptions.WorksheetNotFound:
            logger.error("Worksheet '%s' not found in spreadsheet", tab_name)
            raise

    def _headers_for(self, tab_name: str, force_refresh: bool = False):
        if not force_refresh and tab_name in self._headers:
            return self._headers[tab_name]
        try:
            ws = self._ws(tab_name)
            headers = ws.row_values(1)
            if headers:
                self._headers[tab_name] = headers
            elif tab_name in SHEET_SCHEMAS:
                self._headers[tab_name] = SHEET_SCHEMAS[tab_name]
            return self._headers.get(tab_name, [])
        except Exception:
            return SHEET_SCHEMAS.get(tab_name, [])

    def invalidate_cache(self, tab_name: Optional[str] = None):
        """Invalidates in-memory records cache for a specific tab or all tabs."""
        with _lock:
            if tab_name:
                self._cache.pop(tab_name, None)
                logger.debug("Invalidated sheets cache for tab '%s'", tab_name)
            else:
                self._cache.clear()
                logger.debug("Invalidated entire sheets cache")

    def _execute_with_retry(self, fn, max_retries: int = 3, initial_delay: float = 1.0):
        """Executes a Google Sheets API operation with exponential backoff on 429/quota errors."""
        for attempt in range(max_retries):
            try:
                return fn()
            except Exception as exc:
                if _is_quota_error(exc) and attempt < max_retries - 1:
                    delay = initial_delay * (2 ** attempt) + random.uniform(0.1, 0.4)
                    logger.warning(
                        "Google Sheets quota hit (attempt %d/%d). Retrying in %.2fs...",
                        attempt + 1, max_retries, delay
                    )
                    time.sleep(delay)
                    continue
                raise

    def get_all_records(self, tab_name: str, force_refresh: bool = False):
        """Reads all records from a tab with thread-safe TTL caching and quota resilience."""
        ttl = getattr(Config, "SHEETS_CACHE_TTL_SECONDS", 30)

        # 1. Check in-memory cache
        if not force_refresh and ttl > 0:
            with _lock:
                cached = self._cache.get(tab_name)
                if cached and (time.time() - cached["timestamp"] < ttl):
                    logger.debug("Cache HIT for tab '%s' (%d records, age=%.1fs)", tab_name, len(cached["records"]), time.time() - cached["timestamp"])
                    return copy.deepcopy(cached["records"])

        # 2. Fetch from Google Sheets API
        with _lock:
            # Re-check under lock in case another thread already populated the cache
            if not force_refresh and ttl > 0:
                cached = self._cache.get(tab_name)
                if cached and (time.time() - cached["timestamp"] < ttl):
                    return copy.deepcopy(cached["records"])

            try:
                records = self._execute_with_retry(lambda: self._ws(tab_name).get_all_records())
                self._cache[tab_name] = {
                    "records": copy.deepcopy(records),
                    "timestamp": time.time(),
                }
                logger.debug("Read and cached %d records from tab '%s'", len(records), tab_name)
                return records
            except Exception as exc:
                # Quota Fallback: If quota exceeded and we have stale cached data, serve it!
                stale = self._cache.get(tab_name)
                if _is_quota_error(exc) and stale:
                    logger.warning(
                        "Google Sheets quota exceeded for tab '%s'; serving stale cached records (age=%.1fs) as resilient fallback",
                        tab_name, time.time() - stale["timestamp"]
                    )
                    return copy.deepcopy(stale["records"])

                logger.exception("Failed to read records from tab '%s'", tab_name)
                raise

    def append_row(self, tab_name: str, row_dict: dict):
        with _lock:
            try:
                ws = self._ws(tab_name)
                headers = self._headers_for(tab_name)
                if not headers:
                    headers = SHEET_SCHEMAS.get(tab_name, list(row_dict.keys()))
                    ws.append_row(headers)
                    self._headers[tab_name] = headers
                row = [row_dict.get(h, "") for h in headers]
                self._execute_with_retry(lambda: ws.append_row(row))
                # Invalidate cache for this tab so subsequent reads see the new row
                self._cache.pop(tab_name, None)
            except Exception:
                logger.exception("Failed to append row to tab '%s': %s", tab_name, row_dict)
                raise
        logger.info("Appended row to tab '%s' (id=%s)", tab_name, row_dict.get("id", "?"))

    def update_row_by_match(self, tab_name: str, match_field: str, match_value, updates: dict):
        with _lock:
            ws = self._ws(tab_name)
            headers = self._headers_for(tab_name)
            if match_field not in headers:
                logger.error("update_row_by_match: '%s' is not a column in tab '%s'", match_field, tab_name)
                raise ValueError(f"{match_field} not a column in {tab_name}")
            col_idx = headers.index(match_field) + 1
            col_values = self._execute_with_retry(lambda: ws.col_values(col_idx))
            row_num = None
            for i, v in enumerate(col_values[1:], start=2):
                if str(v) == str(match_value):
                    row_num = i
                    break
            if row_num is None:
                logger.warning("update_row_by_match: no row found in tab '%s' where %s=%s", tab_name, match_field, match_value)
                return False
            try:
                # Single-request batch update for all modified cells in this row
                cell_updates = []
                for field, value in updates.items():
                    if field in headers:
                        c_idx = headers.index(field) + 1
                        cell_updates.append(Cell(row=row_num, col=c_idx, value=value))
                if cell_updates:
                    self._execute_with_retry(lambda: ws.update_cells(cell_updates))
                # Invalidate cache for this tab
                self._cache.pop(tab_name, None)
            except Exception:
                logger.exception("Failed to update row %d in tab '%s' with %s", row_num, tab_name, updates)
                raise
        logger.info("Updated row in tab '%s' where %s=%s with %s (batched %d cells in 1 API call)", tab_name, match_field, match_value, updates, len(cell_updates))
        return True

    def delete_row_by_match(self, tab_name: str, match_field: str, match_value):
        with _lock:
            ws = self._ws(tab_name)
            headers = self._headers_for(tab_name)
            col_idx = headers.index(match_field) + 1
            col_values = self._execute_with_retry(lambda: ws.col_values(col_idx))
            for i, v in enumerate(col_values[1:], start=2):
                if str(v) == str(match_value):
                    try:
                        self._execute_with_retry(lambda: ws.delete_rows(i))
                        # Invalidate cache for this tab
                        self._cache.pop(tab_name, None)
                    except Exception:
                        logger.exception("Failed to delete row %d in tab '%s' where %s=%s", i, tab_name, match_field, match_value)
                        raise
                    logger.info("Deleted row in tab '%s' where %s=%s", tab_name, match_field, match_value)
                    return True
        logger.warning("delete_row_by_match: no row found in tab '%s' where %s=%s", tab_name, match_field, match_value)
        return False

    def next_id(self, tab_name: str, id_field: str = "id") -> int:
        records = self.get_all_records(tab_name)
        ids = [int(r[id_field]) for r in records if str(r.get(id_field, "")).isdigit()]
        return (max(ids) + 1) if ids else 1


def get_client() -> SheetsClient:
    return SheetsClient()

