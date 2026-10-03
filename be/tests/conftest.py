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
import email_validator

# `.test` is an IANA special-use domain. The test suite intentionally uses
# @hrflow.test fixture addresses, so tell email-validator this is a test
# process before Pydantic's EmailStr validation runs. This affects pytest
# only; production email validation remains unchanged.
email_validator.TEST_ENVIRONMENT = True

os.environ["SECRET_KEY"] = "test-secret-key-for-pytest-only-do-not-use-in-prod"
os.environ["GOOGLE_OAUTH_CLIENT_ID"] = "test-client-id.apps.googleusercontent.com"
os.environ["ALLOWED_ORIGINS"] = "*"
os.environ["ENVIRONMENT"] = "development"
os.environ["STORAGE_ENGINE"] = "sql"
os.environ["DB_TYPE"] = "sqlite"
os.environ["DATABASE_URL"] = "sqlite:///./hrflow_test.db"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config import Config
Config.STORAGE_ENGINE = "sql"
Config.DB_TYPE = "sqlite"
Config.DATABASE_URL = "sqlite:///./hrflow_test.db"



class FakeSheetsClient:
    def __init__(self, seed=None):
        self._data = copy.deepcopy(seed) if seed else {}
        self.is_backfilling = False
        self.auto_sync_to_sql = True

    def get_all_records(self, sheet_name):
        if getattr(self, "is_backfilling", False):
            return copy.deepcopy(self._data.get(sheet_name, []))
        try:
            from config import Config
            if Config.STORAGE_ENGINE == "sql":
                res = None
                if sheet_name == "InsuranceClaims":
                    from repositories.sql.insurance import SqlInsuranceRepository
                    res = SqlInsuranceRepository().list_claims()
                elif sheet_name == "Requests":
                    from repositories.sql.requests import SqlRequestRepository
                    res = SqlRequestRepository().list_requests()
                elif sheet_name == "Employees":
                    from repositories.sql.employees import SqlEmployeeRepository
                    res = SqlEmployeeRepository().list_all()
                elif sheet_name == "VacationHistory":
                    from repositories.sql.vacations import SqlVacationRepository
                    res = SqlVacationRepository().get_history()
                elif sheet_name == "InsuranceCategories":
                    from repositories.sql.insurance import SqlInsuranceRepository
                    res = SqlInsuranceRepository().list_categories()
                elif sheet_name == "SalaryHistory":
                    from repositories.sql.salary import SqlSalaryRepository
                    res = SqlSalaryRepository().get_history()
                if res:
                    return res
        except Exception:
            pass
        return copy.deepcopy(self._data.get(sheet_name, []))

    def append_row(self, sheet_name, row):
        self._data.setdefault(sheet_name, []).append(copy.deepcopy(row))
        if getattr(self, "auto_sync_to_sql", True):
            try:
                from config import Config
                if Config.STORAGE_ENGINE == "sql":
                    from scripts.backfill_sheets_to_sql import backfill_all
                    backfill_all(client=self)
            except Exception:
                pass

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
                if getattr(self, "auto_sync_to_sql", True):
                    try:
                        from config import Config
                        if Config.STORAGE_ENGINE == "sql":
                            from scripts.backfill_sheets_to_sql import backfill_all
                            backfill_all(client=self)
                    except Exception:
                        pass
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

    def upload_invoice_file(self, payment_year, payment_month, file_name, file_bytes, employee_id=None, employee_name="", pdf_bytes=None):
        file_id = f"fake-drive-invoice-{self._next_file_id}"
        self._next_file_id += 1
        self.uploaded_files[file_id] = {
            "name": file_name,
            "bytes": file_bytes,
            "pdf_bytes": pdf_bytes,
            "employee_id": employee_id,
            "period": f"{payment_year}-{payment_month:02d}",
        }
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
         "dept": "Ops", "job_role": "HR Admin", "salary": 60000, "internal_salary_usd": 60000, "external_salary_usd": 0, "join_date": "2020-01-01",
         "status": "Active", "vac_total": 21, "vac_used": 0, "next_raise": "2027-01-01",
         "employment_state": "Full-Time"},
        {"id": 2, "name": "Employee Two", "email": "employee@hrflow.test", "role": "employee",
         "dept": "Engineering", "job_role": "Developer", "salary": 40000, "internal_salary_usd": 40000, "external_salary_usd": 0, "join_date": "2021-01-01",
         "status": "Active", "vac_total": 21, "vac_used": 5, "next_raise": "2027-01-01",
         "employment_state": "Full-Time"},
        {"id": 3, "name": "Employee Three", "email": "employee3@hrflow.test", "role": "employee",
         "dept": "Sales", "job_role": "Sales Rep", "salary": 35000, "internal_salary_usd": 35000, "external_salary_usd": 0, "join_date": "2022-01-01",
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
def app_client(monkeypatch, fake_sheets_client, fake_drive_client, tmp_path):
    import sheets_client
    import drive_client
    import auth as auth_module
    from config import Config
    from db import Base, reset_engine_for_testing
    from scripts.backfill_sheets_to_sql import backfill_all

    monkeypatch.setattr(sheets_client, "get_client", lambda: fake_sheets_client)
    monkeypatch.setattr(drive_client, "get_drive_client", lambda: fake_drive_client)
    monkeypatch.setattr(auth_module, "get_client", lambda: fake_sheets_client)

    if Config.STORAGE_ENGINE == "sql":
        test_db_file = tmp_path / "test_app_sql.db"
        test_db_url = f"sqlite:///{test_db_file}"
        monkeypatch.setattr(Config, "DATABASE_URL", test_db_url)
        monkeypatch.setattr(Config, "DB_TYPE", "sqlite")
        reset_engine_for_testing(test_db_url)
        from sqlalchemy import create_engine
        engine = create_engine(test_db_url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        stats = backfill_all(client=fake_sheets_client)
        print("BACKFILL STATS:", stats)

    import main as main_module
    from fastapi.testclient import TestClient
    client = TestClient(main_module.app)
    yield client

    if Config.STORAGE_ENGINE == "sql":
        reset_engine_for_testing(None)


def seed_default_roles(db):
    """Create the permission catalog rows and the five seeded roles (create-once)."""
    from core.role_seed import DEFAULT_ROLES, sync_catalog
    from core.rbac_models import PermissionDB, RoleDB, RolePermissionDB

    sync_catalog(db)
    for key, role_def in DEFAULT_ROLES.items():
        role = db.query(RoleDB).filter(RoleDB.system_key == key).first()
        if not role:
            role = RoleDB(
                name=role_def.name,
                system_key=role_def.system_key,
                is_locked=role_def.is_locked,
                description=role_def.description,
            )
            db.add(role)
            db.flush()
        if db.query(RolePermissionDB).filter(RolePermissionDB.role_id == role.id).count() == 0:
            for perm_key in role_def.permissions:
                perm = db.query(PermissionDB).filter(PermissionDB.key == perm_key).first()
                if perm:
                    db.add(RolePermissionDB(role_id=role.id, permission_id=perm.id))
            db.flush()
    db.commit()


def create_test_user(email, role_key=None, employee_id=None, name=None):
    """Create (or reset) a users row in the active test database with at most one
    assigned role (by system_key) and return a session cookie dict for it.
    The employee baseline comes from employee_id, never from a role row."""
    import auth as auth_module
    import config as config_module
    from db import get_db_context
    from models_db import UserDB
    from core.rbac_models import RoleDB, UserRoleDB

    with get_db_context() as db:
        seed_default_roles(db)
        user = db.query(UserDB).filter(UserDB.email == email).first()
        if user is None:
            user = UserDB(email=email)
            db.add(user)
        user.name = name or email.split("@")[0]
        user.employee_id = employee_id
        user.archived_at = None
        db.flush()
        db.query(UserRoleDB).filter(UserRoleDB.user_id == user.id).delete()
        if role_key:
            role = db.query(RoleDB).filter(RoleDB.system_key == role_key).one()
            db.add(UserRoleDB(user_id=user.id, role_id=role.id))
        db.commit()
        uid = user.id
    token = auth_module.create_session_token(email, employee_id=employee_id, name=name or email.split("@")[0], uid=uid)
    return {config_module.Config.SESSION_COOKIE_NAME: token}


def _login_cookie_for(app_client, email):
    users = {"admin@hrflow.test": ("super_admin", 1), "employee@hrflow.test": (None, 2),
             "employee3@hrflow.test": (None, 3)}
    role_key, employee_id = users[email]
    return create_test_user(email, role_key=role_key, employee_id=employee_id)


@pytest.fixture
def admin_cookies(app_client):
    return _login_cookie_for(app_client, "admin@hrflow.test")


@pytest.fixture
def employee_cookies(app_client):
    return _login_cookie_for(app_client, "employee@hrflow.test")


@pytest.fixture
def other_employee_cookies(app_client):
    return _login_cookie_for(app_client, "employee3@hrflow.test")
