"""
test_authorization.py
Integration tests exercising the FastAPI app end-to-end (via TestClient)
against in-memory fake Sheets/Drive clients. Focused on access-control
paths flagged in docs/analysis/security-analysis-plan.md - regression
tests for findings #1, #6, #7, #9 and the Phase 1 cookie-session migration.
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

    monkeypatch.setattr("main.login_with_google", fake_login_with_google)

    response = app_client.post("/api/auth/google", json={"credential": "whatever"})
    assert response.status_code == 200
    assert "token" not in response.json()
    assert app_client.cookies.get("hrflow_session") is not None
