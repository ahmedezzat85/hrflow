"""
sheets_client.py
Thin data-access layer over Google Sheets using gspread.
Every "table" in our HR system is simply one tab (worksheet) inside a single
Google Spreadsheet. This module centralizes all read/write logic so the rest
of the backend never talks to gspread directly.

Sheet tabs expected in the spreadsheet (create these exact tab names):
  1. Employees
  2. Requests          (Vacation / WFH / Medical Insurance requests - pending workflow)
  3. VacationHistory
  4. InsuranceClaims
  5. SalaryHistory
  6. Users             (maps a Google Workspace email -> role/employee_id; no passwords stored)
  7. EmployeeDocuments
  8. CompanyDocuments  (Document Hub - company-wide documents/policies)
  9. AuditLog

Each tab's header row (row 1) defines the column names used as dict keys
throughout the backend - see SHEET_SCHEMAS below for the exact expected
headers per tab.

NOTE (salary-advanced Phase 1, docs/analysis/salary-advanced-plan.md):
this reconstruction is based on the sum of known commits touching this
file (initial schema, EmployeeDocuments evolution, Document Hub schema,
employment_state column, singleton race-condition fix, logging additions,
InsuranceCategories/AuditLog additions referenced by other routers). If
the live file differs in any section NOT touched by this change (e.g.
exact logging call sites), that's expected drift from reconstruction and
is not something this change addresses - see AGENTS.md "GitHub tool
quirk" for why this file was reconstructed from history rather than read
directly.
"""
import logging
import gspread
from google.oauth2.service_account import Credentials
from threading import Lock
from config import Config
from logging_config import get_logger

logger = get_logger("main")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

# Expected header row for each tab - used to auto-create tabs if missing.
# NOTE: no password_hash column anywhere - authentication is fully delegated
# to Google Sign-In; these tabs only store role/profile data.
#
# Employees.salary (legacy, single EGP-ish figure) is superseded by
# internal_salary_usd / external_salary_usd (see docs/analysis/
# salary-advanced-plan.md, Phase 1) but is kept on the schema/sheet for
# backward compatibility with any not-yet-migrated code/reports. The API
# no longer writes to it via EmployeeCreate.
SHEET_SCHEMAS = {
    "Employees": [
        "id","name","email","role","dept","job_role",
        "salary","internal_salary_usd","external_salary_usd",
        "join_date","status","vac_total","vac_used","next_raise",
        "employment_state",
    ],
    "Requests": [
        "id","employee_id","employee_name","type","details","date",
        "status","reviewed_by","reviewed_at","submitted_by",
    ],
    "VacationHistory": [
        "id","employee_id","type","start_date","end_date","days","status","submitted_by",
    ],
    "InsuranceClaims": [
        "id","employee_id","employee_name","category","provider",
        "amount","date","status","document_url","submitted_by",
    ],
    "InsuranceCategories": ["id","name","annual_limit"],
    # SalaryHistory.previous_salary / new_salary (legacy combined totals)
    # are kept for backward compatibility with any not-yet-migrated
    # frontend/report code; the new *_usd component columns are the
    # source of truth going forward (docs/analysis/salary-advanced-plan.md).
    "SalaryHistory": [
        "id","employee_id","date",
        "previous_internal_usd","previous_external_usd",
        "new_internal_usd","new_external_usd",
        "previous_salary","new_salary",
        "pct_change","reason","applied_by",
    ],
    "Users": ["email","role","employee_id"],
    "EmployeeDocuments": [
        "id","employee_id","name","file_type","data_url",
        "uploaded_by","uploaded_at","drive_file_id","view_url","download_url",
    ],
    # Company-wide documents/policies (Document Hub) - not tied to an
    # employee. Stored in a shared "Company Documents" Drive sub-folder.
    "CompanyDocuments": [
        "id","name","file_type","category","drive_file_id",
        "view_url","download_url","uploaded_by","uploaded_at",
    ],
    "AuditLog": [
        "id","timestamp","actor_email","action","target_type","target_id","details",
    ],
}

# Columns that must exist on an already-created tab. If a tab predates a
# column, the missing header is appended at the end of row 1 so existing
# data stays intact and new writes can populate the added column.
REQUIRED_COLUMNS = {
    "Employees": [
        "employment_state",
        # salary-advanced Phase 1 (docs/analysis/salary-advanced-plan.md):
        # existing sheets migrate automatically on next startup; both
        # default to blank/0 for pre-existing rows and require a manual
        # EmployeeUpdate pass to populate real values.
        "internal_salary_usd",
        "external_salary_usd",
    ],
    "SalaryHistory": [
        "previous_internal_usd",
        "previous_external_usd",
        "new_internal_usd",
        "new_external_usd",
    ],
}

_lock = Lock()  # gspread client / worksheet writes are not thread-safe by default
# Guards singleton CREATION only (see SheetsClient.__new__ below). This is
# a SEPARATE lock from _lock above, which guards individual read/write
# operations on an already-connected client. Without this, concurrent
# requests hitting get_client() for the first time (e.g. the frontend's
# Promise.all() firing several endpoints at once on page load) can race:
# one thread sets cls._instance before _connect() has finished setting
# self.spreadsheet, and a second thread returns that half-built instance
# and crashes with "AttributeError: 'SheetsClient' object has no
# attribute 'spreadsheet'".
_instance_lock = Lock()


class SheetsClient:
    _instance = None

    def __new__(cls):
        # Fast path: already fully connected, no locking needed.
        if cls._instance is not None:
            return cls._instance
        with _instance_lock:
            # Re-check inside the lock in case another thread finished
            # connecting while we were waiting for the lock.
            if cls._instance is None:
                instance = super().__new__(cls)
                instance._connect()
                cls._instance = instance
        return cls._instance

    def _connect(self):
        logger.info("Connecting to Google Sheets (spreadsheet_id=%s)", Config.SPREADSHEET_ID)
        creds = Credentials.from_service_account_file(
            Config.GOOGLE_CREDENTIALS_FILE, scopes=SCOPES
        )
        self.gc = gspread.authorize(creds)
        self.spreadsheet = self.gc.open_by_key(Config.SPREADSHEET_ID)
        self._ensure_tabs_exist()
        logger.info("Connected to Google Sheets successfully")

    def _ensure_tabs_exist(self):
        """
        Creates any missing tabs with the correct header row. Also fixes
        the case where a tab already exists but is completely empty (e.g.
        you created it manually in the Sheets UI before running the
        backend) - in that case row 1 has no headers yet, so we write them
        now instead of silently leaving the tab headerless.
        """
        existing = {ws.title for ws in self.spreadsheet.worksheets()}
        for tab_name, headers in SHEET_SCHEMAS.items():
            if tab_name not in existing:
                logger.info("Creating missing tab '%s' with %d columns", tab_name, len(headers))
                ws = self.spreadsheet.add_worksheet(title=tab_name, rows=1000, cols=len(headers))
                ws.append_row(headers)
            else:
                ws = self._ws(tab_name)
                first_row = ws.row_values(1)
                if not first_row:
                    logger.info("Tab '%s' exists but has no header row - writing headers now", tab_name)
                    ws.append_row(headers)

        self._ensure_required_columns()

    def _ensure_required_columns(self):
        """Appends any REQUIRED_COLUMNS missing from an existing tab's
        header row, so older spreadsheets gain newly introduced columns
        (e.g. Employees.employment_state, Employees.internal_salary_usd)
        without manual edits."""
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
        return self.spreadsheet.worksheet(tab_name)

    # ---------- Generic helpers ----------
    def get_all_records(self, tab_name):
        """Returns list of dicts, one per row, keyed by header row."""
        with _lock:
            return self._ws(tab_name).get_all_records()

    def append_row(self, tab_name, row_dict):
        """
        Appends a dict as a new row, ordering values by the tab's header row.
        Guards against a headerless tab (which previously caused rows to be
        silently appended as empty lists) by falling back to the tab's
        expected schema if row 1 is blank, and writing that header row now.
        """
        with _lock:
            ws = self._ws(tab_name)
            headers = ws.row_values(1)
            if not headers:
                headers = SHEET_SCHEMAS.get(tab_name, list(row_dict.keys()))
                ws.append_row(headers)
            row = [row_dict.get(h, "") for h in headers]
            ws.append_row(row)
            logger.debug("Appended row to '%s' (%d columns)", tab_name, len(row))

    def update_row_by_match(self, tab_name, match_field, match_value, updates: dict):
        """Finds the first row where match_field == match_value and updates given columns."""
        with _lock:
            ws = self._ws(tab_name)
            headers = ws.row_values(1)
            if match_field not in headers:
                raise ValueError(f"{match_field} not a column in {tab_name}")
            col_idx = headers.index(match_field) + 1
            col_values = ws.col_values(col_idx)
            row_num = None
            for i, v in enumerate(col_values[1:], start=2):
                if str(v) == str(match_value):
                    row_num = i
                    break
            if row_num is None:
                logger.warning("update_row_by_match: no row found in '%s' where %s=%s", tab_name, match_field, match_value)
                return False
            for field, value in updates.items():
                if field in headers:
                    c_idx = headers.index(field) + 1
                    ws.update_cell(row_num, c_idx, value)
            logger.debug("Updated row in '%s' where %s=%s (fields=%s)", tab_name, match_field, match_value, list(updates.keys()))
            return True

    def delete_row_by_match(self, tab_name, match_field, match_value):
        with _lock:
            ws = self._ws(tab_name)
            headers = ws.row_values(1)
            col_idx = headers.index(match_field) + 1
            col_values = ws.col_values(col_idx)
            for i, v in enumerate(col_values[1:], start=2):
                if str(v) == str(match_value):
                    ws.delete_rows(i)
                    logger.debug("Deleted row from '%s' where %s=%s", tab_name, match_field, match_value)
                    return True
            logger.warning("delete_row_by_match: no row found in '%s' where %s=%s", tab_name, match_field, match_value)
            return False

    def next_id(self, tab_name, id_field="id"):
        """Simple auto-increment helper based on max existing id in the tab."""
        records = self.get_all_records(tab_name)
        ids = [int(r[id_field]) for r in records if str(r.get(id_field, "")).isdigit()]
        return (max(ids) + 1) if ids else 1


def get_client() -> SheetsClient:
    return SheetsClient()
