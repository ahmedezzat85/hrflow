"""
test_employee_scope.py
Regression tests for dependency-based employee scoping introduced during
the architecture refactor. These prove that scope is resolved before list
and history handlers execute: admins may see all or request a specific
employee, while employees are always forced to their own employee_id.
"""


def test_admin_salary_history_without_filter_sees_all(app_client, admin_cookies):
    response = app_client.get("/api/salary/history", cookies=admin_cookies)
    assert response.status_code == 200
    assert {str(row["employee_id"]) for row in response.json()} == {"2", "3"}


def test_admin_salary_history_explicit_filter_is_honored(app_client, admin_cookies):
    response = app_client.get("/api/salary/history?employee_id=3", cookies=admin_cookies)
    assert response.status_code == 200
    assert all(str(row["employee_id"]) == "3" for row in response.json())


def test_employee_salary_history_query_parameter_is_overridden(app_client, employee_cookies):
    response = app_client.get("/api/salary/history?employee_id=3", cookies=employee_cookies)
    assert response.status_code == 200
    assert all(str(row["employee_id"]) == "2" for row in response.json())


def test_admin_vacation_history_without_filter_sees_all(app_client, admin_cookies, fake_sheets_client):
    fake_sheets_client.append_row("VacationHistory", {"id": 1, "employee_id": 2, "type": "Annual Leave", "start_date": "2026-01-01", "end_date": "2026-01-01", "days": 1, "status": "Approved"})
    fake_sheets_client.append_row("VacationHistory", {"id": 2, "employee_id": 3, "type": "Annual Leave", "start_date": "2026-02-01", "end_date": "2026-02-01", "days": 1, "status": "Approved"})
    response = app_client.get("/api/vacations/history", cookies=admin_cookies)
    assert response.status_code == 200
    assert {str(row["employee_id"]) for row in response.json()} == {"2", "3"}


def test_employee_vacation_history_query_parameter_is_overridden(app_client, employee_cookies, fake_sheets_client):
    fake_sheets_client.append_row("VacationHistory", {"id": 1, "employee_id": 2, "type": "Annual Leave", "start_date": "2026-01-01", "end_date": "2026-01-01", "days": 1, "status": "Approved"})
    fake_sheets_client.append_row("VacationHistory", {"id": 2, "employee_id": 3, "type": "Annual Leave", "start_date": "2026-02-01", "end_date": "2026-02-01", "days": 1, "status": "Approved"})
    response = app_client.get("/api/vacations/history?employee_id=3", cookies=employee_cookies)
    assert response.status_code == 200
    assert all(str(row["employee_id"]) == "2" for row in response.json())


def test_admin_requests_without_scope_sees_all(app_client, admin_cookies, fake_sheets_client):
    fake_sheets_client.append_row("Requests", {"id": 1, "employee_id": 2, "employee_name": "Employee Two", "type": "Work From Home", "details": "A", "date": "2026-01-01", "status": "Pending"})
    fake_sheets_client.append_row("Requests", {"id": 2, "employee_id": 3, "employee_name": "Employee Three", "type": "Work From Home", "details": "B", "date": "2026-01-02", "status": "Pending"})
    response = app_client.get("/api/requests", cookies=admin_cookies)
    assert response.status_code == 200
    assert {str(row["employee_id"]) for row in response.json()} == {"2", "3"}


def test_employee_requests_are_self_scoped(app_client, employee_cookies, fake_sheets_client):
    fake_sheets_client.append_row("Requests", {"id": 1, "employee_id": 2, "employee_name": "Employee Two", "type": "Work From Home", "details": "A", "date": "2026-01-01", "status": "Pending"})
    fake_sheets_client.append_row("Requests", {"id": 2, "employee_id": 3, "employee_name": "Employee Three", "type": "Work From Home", "details": "B", "date": "2026-01-02", "status": "Pending"})
    response = app_client.get("/api/requests", cookies=employee_cookies)
    assert response.status_code == 200
    assert all(str(row["employee_id"]) == "2" for row in response.json())


def test_admin_insurance_consumption_without_filter_sees_all(app_client, admin_cookies, fake_sheets_client):
    fake_sheets_client.append_row("InsuranceCategories", {"id": 1, "name": "Dental", "annual_limit": 5000})
    response = app_client.get("/api/insurance/consumption", cookies=admin_cookies)
    assert response.status_code == 200
    assert {str(row["employee_id"]) for row in response.json()} == {"2", "3"}


def test_admin_insurance_consumption_explicit_filter_is_honored(app_client, admin_cookies, fake_sheets_client):
    fake_sheets_client.append_row("InsuranceCategories", {"id": 1, "name": "Dental", "annual_limit": 5000})
    response = app_client.get("/api/insurance/consumption?employee_id=3", cookies=admin_cookies)
    assert response.status_code == 200
    assert all(str(row["employee_id"]) == "3" for row in response.json())


def test_employee_insurance_consumption_query_parameter_is_overridden(app_client, employee_cookies, fake_sheets_client):
    fake_sheets_client.append_row("InsuranceCategories", {"id": 1, "name": "Dental", "annual_limit": 5000})
    response = app_client.get("/api/insurance/consumption?employee_id=3", cookies=employee_cookies)
    assert response.status_code == 200
    assert all(str(row["employee_id"]) == "2" for row in response.json())


def test_admin_insurance_claims_without_scope_sees_all(app_client, admin_cookies, fake_sheets_client):
    fake_sheets_client.append_row("InsuranceClaims", {"id": 1, "employee_id": 2, "employee_name": "Employee Two", "category": "Dental", "provider": "Clinic A", "amount": 100, "date": "2026-01-01", "status": "Pending", "document_url": ""})
    fake_sheets_client.append_row("InsuranceClaims", {"id": 2, "employee_id": 3, "employee_name": "Employee Three", "category": "Dental", "provider": "Clinic B", "amount": 200, "date": "2026-01-02", "status": "Pending", "document_url": ""})
    response = app_client.get("/api/insurance/claims", cookies=admin_cookies)
    assert response.status_code == 200
    assert {str(row["employee_id"]) for row in response.json()} == {"2", "3"}


def test_employee_insurance_claims_are_self_scoped(app_client, employee_cookies, fake_sheets_client):
    fake_sheets_client.append_row("InsuranceClaims", {"id": 1, "employee_id": 2, "employee_name": "Employee Two", "category": "Dental", "provider": "Clinic A", "amount": 100, "date": "2026-01-01", "status": "Pending", "document_url": ""})
    fake_sheets_client.append_row("InsuranceClaims", {"id": 2, "employee_id": 3, "employee_name": "Employee Three", "category": "Dental", "provider": "Clinic B", "amount": 200, "date": "2026-01-02", "status": "Pending", "document_url": ""})
    response = app_client.get("/api/insurance/claims", cookies=employee_cookies)
    assert response.status_code == 200
    assert all(str(row["employee_id"]) == "2" for row in response.json())
