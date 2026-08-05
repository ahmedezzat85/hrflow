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

Each tab's header row (row 1) defines the column names used as dict keys
throughout the backend - see SHEET_SCHEMAS below for the exact expected
headers per tab.
"""
import gspread
from google.oauth2.service_account import Credentials
from threading import Lock
from config import Config

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

# Expected header row for each tab - used to auto-create tabs if missing.
# NOTE: no password_hash column anywhere - authentication is fully delegated
# to Google Sign-In; these tabs only store role/profile data.
SHEET_SCHEMAS = {
    "Employees": ["id","name","email","role","dept","job_role",
                   "salary","join_date","status","vac_total","vac_used","next_raise"],
    "Requests": ["id","employee_id","employee_name","type","details","date",
                 "status","reviewed_by","reviewed_at"],
    "VacationHistory": ["id","employee_id","type","start_date","end_date","days","status"],
    "InsuranceClaims": ["id","employee_id","employee_name","claim_type","provider",
                         "amount","date","status"],
    "SalaryHistory": ["id","employee_id","date","previous_salary","new_salary",
                       "pct_change","reason","applied_by"],
    "Users": ["email","role","employee_id"],
}

_lock = Lock()  # gspread client / worksheet writes are not thread-safe by default


class SheetsClient:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._connect()
        return cls._instance

    def _connect(self):
        creds = Credentials.from_service_account_file(
            Config.GOOGLE_CREDENTIALS_FILE, scopes=SCOPES
        )
        self.gc = gspread.authorize(creds)
        self.spreadsheet = self.gc.open_by_key(Config.SPREADSHEET_ID)
        self._ensure_tabs_exist()

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
                ws = self.spreadsheet.add_worksheet(title=tab_name, rows=1000, cols=len(headers))
                ws.append_row(headers)
            else:
                ws = self._ws(tab_name)
                first_row = ws.row_values(1)
                if not first_row:
                    ws.append_row(headers)

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
                return False
            for field, value in updates.items():
                if field in headers:
                    c_idx = headers.index(field) + 1
                    ws.update_cell(row_num, c_idx, value)
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
                    return True
            return False

    def next_id(self, tab_name, id_field="id"):
        """Simple auto-increment helper based on max existing id in the tab."""
        records = self.get_all_records(tab_name)
        ids = [int(r[id_field]) for r in records if str(r.get(id_field, "")).isdigit()]
        return (max(ids) + 1) if ids else 1


def get_client() -> SheetsClient:
    return SheetsClient()
