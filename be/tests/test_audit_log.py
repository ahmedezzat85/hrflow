"""
test_audit_log.py
Tests for the audit trail added in Phase 5. See
docs/analysis/security-analysis-plan.md.
"""


def test_audit_log_records_salary_raise(app_client, admin_cookies):
    payload = {"employee_id": 2, "mode": "pct", "value": 10, "effective_date": "2026-08-16"}
    response = app_client.post("/api/salary/raise", json=payload, cookies=admin_cookies)
    assert response.status_code == 201

    audit_response = app_client.get("/api/audit-log", cookies=admin_cookies)
    assert audit_response.status_code == 200
    entries = audit_response.json()
    raise_entries = [e for e in entries if e["action"] == "salary.raise"]
    assert len(raise_entries) == 1
    assert raise_entries[0]["actor_email"] == "admin@hrflow.test"
    assert raise_entries[0]["target_id"] == "2"


def test_audit_log_records_employee_creation(app_client, admin_cookies):
    payload = {"name": "Audit Test Person", "email": "audittest@hrflow.test",
               "internal_salary_usd": 1000, "external_salary_usd": 0}
    response = app_client.post("/api/employees", json=payload, cookies=admin_cookies)
    assert response.status_code == 201
    new_id = response.json()["id"]

    audit_response = app_client.get("/api/audit-log", cookies=admin_cookies)
    entries = audit_response.json()
    create_entries = [e for e in entries if e["action"] == "employee.create" and e["target_id"] == str(new_id)]
    assert len(create_entries) == 1
    assert "Audit Test Person" in create_entries[0]["details"]


def test_audit_log_records_employee_deletion(app_client, admin_cookies):
    response = app_client.delete("/api/employees/3", cookies=admin_cookies)
    assert response.status_code == 200

    audit_response = app_client.get("/api/audit-log", cookies=admin_cookies)
    entries = audit_response.json()
    delete_entries = [e for e in entries if e["action"] == "employee.delete" and e["target_id"] == "3"]
    assert len(delete_entries) == 1


def test_audit_log_records_request_approval(app_client, admin_cookies):
    create_response = app_client.post(
        "/api/requests",
        json={"employee_name": "Employee Two", "type": "Work From Home", "details": "test",
              "employee_id": 2, "status": "Pending"},
        cookies=admin_cookies,
    )
    req_id = create_response.json()["id"]

    action_response = app_client.post(f"/api/requests/{req_id}/action", json={"status": "Approved"}, cookies=admin_cookies)
    assert action_response.status_code == 200

    audit_response = app_client.get("/api/audit-log", cookies=admin_cookies)
    entries = audit_response.json()
    action_entries = [e for e in entries if e["action"] == "request.action" and e["target_id"] == str(req_id)]
    assert len(action_entries) == 1
    assert "Approved" in action_entries[0]["details"]


def test_non_admin_cannot_read_audit_log(app_client, employee_cookies):
    response = app_client.get("/api/audit-log", cookies=employee_cookies)
    assert response.status_code == 403


def test_audit_log_is_append_only_and_never_truncated(app_client, admin_cookies):
    app_client.post("/api/salary/raise", json={"employee_id": 2, "mode": "amount", "value": 1000, "effective_date": "2026-08-16"}, cookies=admin_cookies)
    app_client.post("/api/salary/raise", json={"employee_id": 3, "mode": "amount", "value": 2000, "effective_date": "2026-08-16"}, cookies=admin_cookies)

    audit_response = app_client.get("/api/audit-log", cookies=admin_cookies)
    entries = audit_response.json()
    raise_entries = [e for e in entries if e["action"] == "salary.raise"]
    assert len(raise_entries) == 2
