"""
conftest.py
Shared pytest fixtures for the HRFlow backend test suite. Tests never
touch a real Google Sheet or Drive - FakeSheetsClient/FakeDriveClient are
in-memory stand-ins implementing the same interface as the real clients,
so main.py's endpoint code runs unmodified against them. See
docs/analysis/security-analysis-plan.md, Phase 5.

Patch targets updated during the router-decomposition refactor
(docs/analysis/architecture-review-plan.md): routers now call
`sheets_client.get_client()` / `drive_client.get_drive_client()` via
module-attribute access rather than importing the function by name, so
patching those source modules is the single correct patch point
regardless of how many routers use them - patching main_module no longer
has any effect, since main.py itself no longer imports these functions.
"""
import os
import sys
import copy

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-only-do-not-use-in-prod")
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
os.environ.setdefault("ALLOWED_ORIGINS", "*")
os.environ.setdefault("ENVIRONMENT", "development")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class FakeSheetsClient:
    def __init__(self, seed=None):
        self._data = copy.deepcopy(seed) if seed else {}

    def get_all_records(self, sheet_name):
        return copy.deepcopy(self._data.get(sheet_name, []))

    def append_row(self, sheet_name, row):
        self._data.setdefault(sheet_name, []).append(copy.deepcopy(row))

    def next_id(self, sheet_name):
        rows = self._data.get(sheet_name, [])
        if not rows:
            return 1
        return max(int(r["id"]) for r in rows) + 1

    def update_row_by_match(self, sheet_name, key_field, key_value, updates):
        rows = self._data.get(sheet_name, [])
        for row in rows:
            if str(row.get(key_field)) == str(key_value):
                row.update(updates)
                return True
        return False

    def delete_row_by_match(self, sheet_name, key_field, key_value):
        rows = self._data.get(sheet_name, [])
        before = len(rows)
        self._data[sheet_name] = [r for r in rows if str(r.get(key_field)) != str(key_value)]
        return len(self._data[sheet_name]) < before


class FakeDriveClient:
    def __init__(self):
        self.uploaded_files = {}
        self._next_file_id = 1

    def upload_file(self, emp_id, emp_name, doc_name, data_url):
        file_id = f"fake-drive-file-{self._next_file_id}"
        self._next_file_id += 1
        self.uploaded_files[file_id] = {"emp_id": emp_id, "name": doc_name, "data_url": data_url}
        return {"file_id": file_id, "view_url": f"https://drive.fake/{file_id}/view", "download_url": f"https://drive.fake/{file_id}/download"}

    def upload_company_file(self, doc_name, data_url):
        file_id = f"fake-drive-company-file-{self._next_file_id}"
        self._next_file_id += 1
        self.uploaded_files[file_id] = {"name": doc_name, "data_url": data_url}
        return {"file_id": file_id, "view_url": f"https://drive.fake/{file_id}/view", "download_url": f"https://drive.fake/{file_id}/download"}

    def download_file(self, file_id):
        return b"fake file bytes", "application/octet-stream", "fake.bin"

    def delete_file(self, file_id):
        return self.uploaded_files.pop(file_id, None) is not None


SEED_DATA = {
    "Users": [
        {"email": "admin@hrflow.test", "role": "admin", "employee_id": 1},
        {"email": "employee@hrflow.test", "role": "employee", "employee_id": 2},
    ],
    "Employees": [
        {"id": 1, "name": "Admin One", "email": "admin@hrflow.test", "role": "admin",
         "dept": "Ops", "job_role": "HR Admin", "salary": 60000, "join_date": "2020-01-01",
         "status": "Active", "vac_total": 21, "vac_used": 0, "next_raise": "2027-01-01",
         "employment_state": "Full-Time"},
        {"id": 2, "name": "Employee Two", "email": "employee@hrflow.test", "role": "employee",
         "dept": "Engineering", "job_role": "Developer", "salary": 40000, "join_date": "2021-01-01",
         "status": "Active", "vac_total": 21, "vac_used": 5, "next_raise": "2027-01-01",
         "employment_state": "Full-Time"},
        {"id": 3, "name": "Employee Three", "email": "employee3@hrflow.test", "role": "employee",
         "dept": "Sales", "job_role": "Sales Rep", "salary": 35000, "join_date": "2022-01-01",
         "status": "Active", "vac_total": 21, "vac_used": 2, "next_raise": "2027-06-01",
         "employment_state": "Full-Time"},
    ],
    "SalaryHistory": [
        {"id": 1, "employee_id": 2, "date": "2025-01-01", "previous_salary": 35000,
         "new_salary": 40000, "pct_change": "+14.29%", "reason": "Annual raise", "applied_by": "admin@hrflow.test"},
        {"id": 2, "employee_id": 3, "date": "2025-06-01", "previous_salary": 30000,
         "new_salary": 35000, "pct_change": "+16.67%", "reason": "Promotion", "applied_by": "admin@hrflow.test"},
    ],
    "InsuranceCategories": [
        {"id": 1, "name": "Dental", "annual_limit": 10000},
        {"id": 2, "name": "Optical", "annual_limit": 5000},
    ],
    "InsuranceClaims": [],
    "Requests": [],
    "VacationHistory": [],
    "EmployeeNotes": [],
    "EmployeeDocuments": [],
    "CompanyDocuments": [],
    "AuditLog": [],
}


@pytest.fixture
def fake_sheets_client():
    return FakeSheetsClient(seed=SEED_DATA)


@pytest.fixture
def fake_drive_client():
    return FakeDriveClient()


@pytest.fixture
def app_client(monkeypatch, fake_sheets_client, fake_drive_client):
    import sheets_client
    import drive_client
    import auth as auth_module

    monkeypatch.setattr(sheets_client, "get_client", lambda: fake_sheets_client)
    monkeypatch.setattr(drive_client, "get_drive_client", lambda: fake_drive_client)
    monkeypatch.setattr(auth_module, "get_client", lambda: fake_sheets_client)

    import main as main_module
    from fastapi.testclient import TestClient
    return TestClient(main_module.app)


def _login_cookie_for(app_client, email):
    import auth as auth_module
    users = {"admin@hrflow.test": ("admin", 1), "employee@hrflow.test": ("employee", 2),
             "employee3@hrflow.test": ("employee", 3)}
    role, employee_id = users[email]
    token = auth_module.create_session_token(email, role, employee_id, name=email.split("@")[0])
    import config as config_module
    return {config_module.Config.SESSION_COOKIE_NAME: token}


@pytest.fixture
def admin_cookies(app_client):
    return _login_cookie_for(app_client, "admin@hrflow.test")


@pytest.fixture
def employee_cookies(app_client):
    return _login_cookie_for(app_client, "employee@hrflow.test")


@pytest.fixture
def other_employee_cookies(app_client):
    return _login_cookie_for(app_client, "employee3@hrflow.test")
