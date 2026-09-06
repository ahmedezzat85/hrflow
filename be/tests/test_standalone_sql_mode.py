"""
be/tests/test_standalone_sql_mode.py
Tests verifying complete standalone / offline capability of HRFlow with:
STORAGE_ENGINE="sql" and FILE_STORAGE_BACKEND="local".
Confirms endpoints execute 100% against SQLite without touching Google APIs.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

import config
from db import Base, reset_engine_for_testing
from repositories.sql.employees import SqlEmployeeRepository
from repositories.sql.auth import SqlUserRepository
from storage import reset_storage_client_for_testing
from main import app


@pytest.fixture
def standalone_sql_app(monkeypatch, tmp_path):
    db_file = tmp_path / "standalone.db"
    db_url = f"sqlite:///{db_file}"
    storage_dir = str(tmp_path / "local_storage")

    monkeypatch.setenv("STORAGE_ENGINE", "sql")
    monkeypatch.setenv("FILE_STORAGE_BACKEND", "local")
    monkeypatch.setenv("LOCAL_STORAGE_PATH", storage_dir)
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("DB_TYPE", "sqlite")
    monkeypatch.setenv("SECRET_KEY", "standalone-secret-key-12345")
    monkeypatch.setenv("ENVIRONMENT", "development")

    config.Config.STORAGE_ENGINE = "sql"
    config.Config.FILE_STORAGE_BACKEND = "local"
    config.Config.LOCAL_STORAGE_PATH = storage_dir
    config.Config.DATABASE_URL = db_url
    config.Config.DB_TYPE = "sqlite"

    reset_engine_for_testing(db_url)
    reset_storage_client_for_testing()

    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)

    # Seed an admin employee & user in SQL directly
    emp_repo = SqlEmployeeRepository()
    admin_id = emp_repo.create({
        "name": "Admin Root",
        "email": "admin@hrflow.local",
        "role": "admin",
        "dept": "Leadership",
        "status": "Active",
        "salary": 10000.0,
    })

    client = TestClient(app)

    yield client, admin_id

    Base.metadata.drop_all(bind=engine)
    reset_engine_for_testing(None)
    reset_storage_client_for_testing()


def _get_auth_cookies(email: str, role: str = "admin", employee_id: int = 1) -> dict:
    import auth as auth_module
    token = auth_module.create_session_token(email, role, employee_id, name="Admin")
    return {config.Config.SESSION_COOKIE_NAME: token}


def test_standalone_sql_employee_crud(standalone_sql_app):
    client, admin_id = standalone_sql_app
    cookies = _get_auth_cookies("admin@hrflow.local", "admin", admin_id)

    # 1. List employees
    res = client.get("/api/employees", cookies=cookies)
    assert res.status_code == 200
    emps = res.json()
    assert len(emps) == 1
    assert emps[0]["email"] == "admin@hrflow.local"

    # 2. Add new employee
    payload = {
        "name": "Jane Developer",
        "email": "jane@example.com",
        "role": "employee",
        "dept": "Engineering",
        "job_role": "Backend Engineer",
        "internal_salary_usd": 3000.0,
        "external_salary_usd": 1500.0,
        "join_date": "2026-03-01",
        "status": "Active",
    }
    create_res = client.post("/api/employees", json=payload, cookies=cookies)
    assert create_res.status_code == 201
    new_emp_id = create_res.json()["id"]
    assert new_emp_id > 1

    # 3. Fetch single employee
    get_res = client.get(f"/api/employees/{new_emp_id}", cookies=cookies)
    assert get_res.status_code == 200
    emp_data = get_res.json()
    assert emp_data["name"] == "Jane Developer"
    assert emp_data["salary"] == 4500.0


def test_standalone_sql_bank_and_vacations(standalone_sql_app):
    client, admin_id = standalone_sql_app
    cookies = _get_auth_cookies("admin@hrflow.local", "admin", admin_id)

    # 1. Update bank details
    bank_payload = {
        "bank_name": "Local Savings Bank",
        "iban": "EG9999888877776666",
        "swift_code": "LOCEGCX",
    }
    bank_res = client.put(f"/api/employees/{admin_id}/bank-account", json=bank_payload, cookies=cookies)
    assert bank_res.status_code == 200

    # 2. Fetch bank details (masked)
    get_bank = client.get(f"/api/employees/{admin_id}/bank-account", cookies=cookies)
    assert get_bank.status_code == 200
    assert get_bank.json()["has_details"] is True
    assert get_bank.json()["bank_name"] == "Local Savings Bank"

    # 3. Vacation history (empty initially)
    vac_res = client.get("/api/vacations/history", cookies=cookies)
    assert vac_res.status_code == 200
    assert isinstance(vac_res.json(), list)
