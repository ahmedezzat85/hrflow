"""
test_authorization.py
Integration tests exercising the FastAPI app end-to-end (via TestClient)
against in-memory fake Sheets/Drive clients. Focused on access-control
paths flagged in docs/analysis/security-analysis-plan.md - regression
tests for findings #1, #6, #7, #9, #10 and the Phase 1 cookie-session migration.
"""
import base64


def test_unauthenticated_request_is_rejected(app_client):
    response = app_client.get("/api/employees")
    assert response.status_code == 401


def test_employee_cannot_see_other_employees_in_list(app_client, employee_cookies):
    response = app_client.get("/api/employees", cookies=employee_cookies)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == 2


def test_admin_sees_all_employees(app_client, admin_cookies):
    response = app_client.get("/api/employees", cookies=admin_cookies)
    assert response.status_code == 200
    assert len(response.json()) == 3


def test_employee_cannot_view_another_employees_profile(app_client, employee_cookies):
    response = app_client.get("/api/employees/3", cookies=employee_cookies)
    assert response.status_code == 403


def test_admin_can_view_any_employee_profile(app_client, admin_cookies):
    response = app_client.get("/api/employees/3", cookies=admin_cookies)
    assert response.status_code == 200
    assert response.json()["name"] == "Employee Three"


def test_non_admin_cannot_create_employee(app_client, employee_cookies):
    payload = {"name": "New Person", "email": "new@hrflow.test"}
    response = app_client.post("/api/employees", json=payload, cookies=employee_cookies)
    assert response.status_code == 403


def test_admin_can_create_employee(app_client, admin_cookies):
    payload = {"name": "New Person", "email": "new@hrflow.test"}
    response = app_client.post("/api/employees", json=payload, cookies=admin_cookies)
    assert response.status_code == 201


def test_salary_history_query_param_cannot_be_used_to_view_others(app_client, employee_cookies):
    response = app_client.get("/api/salary/history?employee_id=3", cookies=employee_cookies)
    assert response.status_code == 200
    data = response.json()
    assert all(str(row["employee_id"]) == "2" for row in data)


def test_salary_history_admin_can_filter_by_employee_id(app_client, admin_cookies):
    response = app_client.get("/api/salary/history?employee_id=3", cookies=admin_cookies)
    assert response.status_code == 200
    data = response.json()
    assert all(str(row["employee_id"]) == "3" for row in data)


def test_employee_cannot_apply_raise(app_client, employee_cookies):
    payload = {"employee_id": 2, "mode": "pct", "value": 50}
    response = app_client.post("/api/salary/raise", json=payload, cookies=employee_cookies)
    assert response.status_code == 403


def test_admin_apply_raise_computes_correct_new_salary(app_client, admin_cookies):
    payload = {"employee_id": 2, "mode": "pct", "value": 10, "effective_date": "2026-08-16"}
    response = app_client.post("/api/salary/raise", json=payload, cookies=admin_cookies)
    assert response.status_code == 201
    data = response.json()
    assert data["previous_salary"] == 40000.0
    assert data["new_salary"] == 44000.0
    assert data["pct_change"] == 10.0


def test_employee_cannot_view_another_employees_documents(app_client, employee_cookies):
    response = app_client.get("/api/employees/3/documents", cookies=employee_cookies)
    assert response.status_code == 403


def test_employee_cannot_submit_request_on_behalf_of_another(app_client, employee_cookies):
    payload = {"employee_name": "Employee Three", "type": "Work From Home",
               "details": "test", "employee_id": 3}
    response = app_client.post("/api/requests", json=payload, cookies=employee_cookies)
    assert response.status_code == 403


def test_admin_can_submit_request_on_behalf_of_employee(app_client, admin_cookies):
    payload = {"employee_name": "ignored - resolved server-side", "type": "Work From Home",
               "details": "WFH day", "employee_id": 3, "status": "Approved"}
    response = app_client.post("/api/requests", json=payload, cookies=admin_cookies)
    assert response.status_code == 201


def _valid_pdf_data_url():
    return "data:application/pdf;base64," + base64.b64encode(b"%PDF-1.4\ntest content").decode()


def _fake_html_disguised_as_pdf():
    return "data:application/pdf;base64," + base64.b64encode(
        b"<html><script>alert(document.cookie)</script></html>"
    ).decode()


def test_document_upload_accepts_real_pdf(app_client, employee_cookies):
    payload = {"name": "My ID", "file_type": "pdf", "data_url": _valid_pdf_data_url()}
    response = app_client.post("/api/employees/2/documents", json=payload, cookies=employee_cookies)
    assert response.status_code == 201


def test_document_upload_rejects_disguised_html_content(app_client, employee_cookies):
    payload = {"name": "Fake ID", "file_type": "pdf", "data_url": _fake_html_disguised_as_pdf()}
    response = app_client.post("/api/employees/2/documents", json=payload, cookies=employee_cookies)
    assert response.status_code == 400


def test_health_endpoint_requires_no_auth(app_client):
    response = app_client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_security_headers_present_on_every_response(app_client):
    response = app_client.get("/api/health")
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "SAMEORIGIN"
    assert "content-security-policy" in response.headers


def test_login_response_never_contains_a_token_field(app_client, monkeypatch):
    def fake_login_with_google(credential):
        return {"token": "fake.jwt.token", "role": "admin", "employee_id": 1, "name": "Admin"}

    monkeypatch.setattr("routers.auth.login_with_google", fake_login_with_google)

    response = app_client.post("/api/auth/google", json={"credential": "whatever"})
    assert response.status_code == 200
    assert "token" not in response.json()
    assert app_client.cookies.get("hrflow_session") is not None


def test_login_sets_httponly_session_cookie_with_correct_flags(app_client, monkeypatch):
    """
    Regression test for finding #10: the Set-Cookie header issued by
    /api/auth/google must actually carry HttpOnly and SameSite=lax (and,
    in production, Secure) - not just have the right value in
    Config.COOKIE_SECURE/COOKIE_SAMESITE, but be reflected in the real
    HTTP response header sent to the browser.
    """
    def fake_login_with_google(credential):
        return {"token": "fake.jwt.token", "role": "admin", "employee_id": 1, "name": "Admin"}

    monkeypatch.setattr("routers.auth.login_with_google", fake_login_with_google)

    response = app_client.post("/api/auth/google", json={"credential": "whatever"})
    assert response.status_code == 200

    set_cookie_header = response.headers.get("set-cookie", "")
    assert "hrflow_session=" in set_cookie_header
    assert "httponly" in set_cookie_header.lower()
    assert "samesite=lax" in set_cookie_header.lower()


def test_cookie_secure_flag_is_reflected_in_production_response(monkeypatch, fake_sheets_client, fake_drive_client):
    """
    Confirms that when ENVIRONMENT=production, the Set-Cookie header
    issued at login actually carries the Secure attribute end-to-end.

    Since the router-decomposition refactor (docs/analysis/
    architecture-review-plan.md), `routers/auth.py` does its own
    `from config import Config` at import time. Reloading `config` and
    `main` does NOT cascade-reload `routers.auth` - Python's importlib
    reload() only re-executes the one module passed to it, and any
    already-imported module that references the old Config object (via
    `from config import Config`) keeps that stale reference until it is
    explicitly reloaded too. So `routers.auth` must be reloaded
    explicitly, in the correct order: config -> routers.auth -> main
    (main imports routers.auth, so it must be reloaded last to pick up
    the fresh router module).
    """
    import importlib

    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SECRET_KEY", "a-real-random-secret-value")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.hrflow.example.com")
    monkeypatch.setenv("ALLOWED_WORKSPACE_DOMAIN", "hrflow.example.com")

    import config as config_module
    importlib.reload(config_module)

    import routers.auth as auth_router_module
    importlib.reload(auth_router_module)

    import sheets_client
    import drive_client
    import auth as auth_module
    import main as main_module
    importlib.reload(main_module)

    monkeypatch.setattr(sheets_client, "get_client", lambda: fake_sheets_client)
    monkeypatch.setattr(drive_client, "get_drive_client", lambda: fake_drive_client)
    monkeypatch.setattr(auth_module, "get_client", lambda: fake_sheets_client)

    def fake_login_with_google(credential):
        return {"token": "fake.jwt.token", "role": "admin", "employee_id": 1, "name": "Admin"}
    monkeypatch.setattr(auth_router_module, "login_with_google", fake_login_with_google)

    from fastapi.testclient import TestClient
    prod_client = TestClient(main_module.app)

    response = prod_client.post("/api/auth/google", json={"credential": "whatever"})
    assert response.status_code == 200
    set_cookie_header = response.headers.get("set-cookie", "")
    assert "secure" in set_cookie_header.lower()
    assert "httponly" in set_cookie_header.lower()

    # monkeypatch auto-reverts os.environ on test teardown, but the
    # already-imported config/routers.auth/main modules would otherwise
    # keep reflecting THIS test's production values for the rest of the
    # pytest session (module state persists across tests in the same
    # process). Explicitly reload all three back to development-mode
    # settings now, using the real dev defaults from conftest.py, so
    # later tests never see production config leaked from this test.
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-for-pytest-only-do-not-use-in-prod")
    monkeypatch.setenv("ALLOWED_ORIGINS", "*")
    monkeypatch.delenv("ALLOWED_WORKSPACE_DOMAIN", raising=False)
    importlib.reload(config_module)
    importlib.reload(auth_router_module)
    importlib.reload(main_module)
