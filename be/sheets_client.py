"""
sheets_client.py
Thin data-access layer over Google Sheets using gspread.
"""
import gspread
from google.oauth2.service_account import Credentials
from threading import Lock
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
                   "employment_state"],
    "Requests": ["id","employee_id","employee_name","type","details","date",
                 "status","reviewed_by","reviewed_at","submitted_by"],
    "VacationHistory": ["id","employee_id","type","start_date","end_date","days","status","submitted_by"],
    "InsuranceClaims": ["id","employee_id","employee_name","category","provider",
                         "amount","date","status","document_url","submitted_by"],
    "InsuranceCategories": ["id","name","annual_limit"],
    "SalaryHistory": ["id","employee_id","date","previous_salary","new_salary",
                       "pct_change","reason","applied_by"],
    "Users": ["email","role","employee_id"],
    "EmployeeNotes": ["id","employee_id","date","category","note","created_by"],
    # EmployeeDocuments originally used only data_url; we now support
    # Drive-backed storage as well. The union schema keeps existing
    # data_url column unchanged and appends drive_file_id/view_url/
    # download_url at the end so legacy rows remain valid and new
    # uploads populate the additional metadata.
    "EmployeeDocuments": [
        "id","employee_id","name","file_type","data_url",
        "uploaded_by","uploaded_at","drive_file_id","view_url","download_url"
    ],
}

# Columns that must exist on an already-created tab. If a tab predates a
# column, the missing header is appended at the end of row 1 so existing
# data stays intact and new writes can populate the added column.
REQUIRED_COLUMNS = {
    "Employees": ["employment_state"],
}

_lock = Lock()


class SheetsClient:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._connect()
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
        existing = {ws.title for ws in self.spreadsheet.worksheets()}
        for tab_name, headers in SHEET_SCHEMAS.items():
            if tab_name not in existing:
                logger.info("Creating missing sheet tab '%s' with headers %s", tab_name, headers)
                ws = self.spreadsheet.add_worksheet(title=tab_name, rows=1000, cols=len(headers))
                ws.append_row(headers)
            else:
                ws = self._ws(tab_name)
                first_row = ws.row_values(1)
                if not first_row:
                    logger.warning("Sheet tab '%s' exists but has no header row - adding headers", tab_name)
                    ws.append_row(headers)
                # Legacy migration for EmployeeDocuments: if the tab was
                # created before Drive-backed documents were introduced,
                # it will only have the old headers
                #   id, employee_id, name, file_type, data_url, uploaded_by, uploaded_at
                # We transparently extend that header row to the union
                # schema so existing data stays intact and new uploads can
                # store drive_file_id/view_url/download_url.
                if tab_name == "EmployeeDocuments":
                    legacy_headers = [
                        "id","employee_id","name","file_type","data_url",
                        "uploaded_by","uploaded_at"
                    ]
                    if first_row == legacy_headers:
                        try:
                            ws.update('A1:J1', [SHEET_SCHEMAS["EmployeeDocuments"]])
                            logger.info(
                                "Migrated EmployeeDocuments header from legacy %s to union %s",
                                legacy_headers, SHEET_SCHEMAS["EmployeeDocuments"]
                            )
                        except Exception:
                            logger.exception(
                                "Failed to migrate EmployeeDocuments header row to union schema"
                            )
                            # Don't raise here; even if migration fails we
                            # prefer the app to keep running.

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
            headers = ws.row_values(1)
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
                        logger.info("Added missing column '%s' to tab '%s' (position %d)", col, tab_name, new_idx)
                    except Exception:
                        logger.exception("Failed to add missing column '%s' to tab '%s'", col, tab_name)

    def _ws(self, tab_name):
        try:
            return self.spreadsheet.worksheet(tab_name)
        except gspread.exceptions.WorksheetNotFound:
            logger.error("Worksheet '%s' not found in spreadsheet", tab_name)
            raise

    def get_all_records(self, tab_name):
        with _lock:
            try:
                records = self._ws(tab_name).get_all_records()
            except Exception:
                logger.exception("Failed to read records from tab '%s'", tab_name)
                raise
            logger.debug("Read %d records from tab '%s'", len(records), tab_name)
            return records

    def append_row(self, tab_name, row_dict):
        with _lock:
            try:
                ws = self._ws(tab_name)
                headers = ws.row_values(1)
                if not headers:
                    headers = SHEET_SCHEMAS.get(tab_name, list(row_dict.keys()))
                    ws.append_row(headers)
                row = [row_dict.get(h, "") for h in headers]
                ws.append_row(row)
            except Exception:
                logger.exception("Failed to append row to tab '%s': %s", tab_name, row_dict)
                raise
            logger.info("Appended row to tab '%s' (id=%s)", tab_name, row_dict.get("id", "?"))

    def update_row_by_match(self, tab_name, match_field, match_value, updates: dict):
        with _lock:
            ws = self._ws(tab_name)
            headers = ws.row_values(1)
            if match_field not in headers:
                logger.error("update_row_by_match: '%s' is not a column in tab '%s'", match_field, tab_name)
                raise ValueError(f"{match_field} not a column in {tab_name}")
            col_idx = headers.index(match_field) + 1
            col_values = ws.col_values(col_idx)
            row_num = None
            for i, v in enumerate(col_values[1:], start=2):
                if str(v) == str(match_value):
                    row_num = i
                    break
            if row_num is None:
                logger.warning("update_row_by_match: no row found in tab '%s' where %s=%s", tab_name, match_field, match_value)
                return False
            try:
                for field, value in updates.items():
                    if field in headers:
                        c_idx = headers.index(field) + 1
                        ws.update_cell(row_num, c_idx, value)
            except Exception:
                logger.exception("Failed to update row %d in tab '%s' with %s", row_num, tab_name, updates)
                raise
            logger.info("Updated row in tab '%s' where %s=%s with %s", tab_name, match_field, match_value, updates)
            return True

    def delete_row_by_match(self, tab_name, match_field, match_value):
        with _lock:
            ws = self._ws(tab_name)
            headers = ws.row_values(1)
            col_idx = headers.index(match_field) + 1
            col_values = ws.col_values(col_idx)
            for i, v in enumerate(col_values[1:], start=2):
                if str(v) == str(match_value):
                    try:
                        ws.delete_rows(i)
                    except Exception:
                        logger.exception("Failed to delete row %d in tab '%s' where %s=%s", i, tab_name, match_field, match_value)
                        raise
                    logger.info("Deleted row in tab '%s' where %s=%s", tab_name, match_field, match_value)
                    return True
            logger.warning("delete_row_by_match: no row found in tab '%s' where %s=%s", tab_name, match_field, match_value)
            return False

    def next_id(self, tab_name, id_field="id"):
        records = self.get_all_records(tab_name)
        ids = [int(r[id_field]) for r in records if str(r.get(id_field, "")).isdigit()]
        return (max(ids) + 1) if ids else 1


def get_client() -> SheetsClient:
    return SheetsClient()
