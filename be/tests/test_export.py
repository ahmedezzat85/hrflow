"""
be/tests/test_export.py
Tests verifying CSV and Google Sheets export endpoints for Admins.
"""
import io
import csv
import pytest
from unittest.mock import MagicMock

from config import Config


def test_get_export_status(app_client, admin_cookies):
    res = app_client.get("/api/export/status", cookies=admin_cookies)
    assert res.status_code == 200
    data = res.json()
    assert "google_sheets_available" in data
    assert "datasets" in data
    assert "employees" in data["datasets"]
    assert "insurance" in data["datasets"]
    assert "salary" in data["datasets"]


def test_export_employees_csv(app_client, admin_cookies):
    res = app_client.get("/api/export/employees/csv", cookies=admin_cookies)
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "attachment; filename=\"hrflow_employees_" in res.headers["content-disposition"]

    # Decode CSV (handling utf-8-sig BOM)
    content = res.content.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(content))
    rows = list(reader)

    assert len(rows) >= 2  # Header + at least 1 employee
    header = rows[0]
    assert "Employee ID" in header
    assert "Full Name" in header
    assert "Total Salary USD" in header
    assert "Bank Name" in header
    assert "IBAN" in header

    # Verify seeded employee data is present
    emails = [r[header.index("Email")] for r in rows[1:]]
    assert "admin@hrflow.test" in emails
    assert "employee@hrflow.test" in emails


def test_export_insurance_csv_with_period_filter(app_client, admin_cookies):
    # Submit an insurance claim
    create_payload = {
        "employee_id": 2,
        "employee_name": "Employee Two",
        "category": "Dental",
        "provider": "Smile Clinic",
        "amount": 250.0,
        "record_date": "2026-05-15",
    }
    claim_res = app_client.post("/api/insurance/claims", json=create_payload, cookies=admin_cookies)
    assert claim_res.status_code == 201

    # Filter for 2026
    res = app_client.get("/api/export/insurance/csv?year=2026", cookies=admin_cookies)
    assert res.status_code == 200
    content = res.content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(content)))

    assert len(rows) >= 2
    header = rows[0]
    assert "Claim ID" in header
    assert "Healthcare Provider" in header
    providers = [r[header.index("Healthcare Provider")] for r in rows[1:]]
    assert "Smile Clinic" in providers

    # Filter for 2024 (should be empty except header)
    res_empty = app_client.get("/api/export/insurance/csv?year=2024", cookies=admin_cookies)
    assert res_empty.status_code == 200
    content_empty = res_empty.content.decode("utf-8-sig")
    rows_empty = list(csv.reader(io.StringIO(content_empty)))
    assert len(rows_empty) == 1  # Only header


def test_export_salary_csv(app_client, admin_cookies):
    res = app_client.get("/api/export/salary/csv", cookies=admin_cookies)
    assert res.status_code == 200
    content = res.content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(content)))
    assert len(rows) >= 1
    header = rows[0]
    assert "History ID" in header
    assert "New Salary USD" in header
    assert "Reason / Note" in header


def test_export_vacations_csv(app_client, admin_cookies):
    res = app_client.get("/api/export/vacations/csv", cookies=admin_cookies)
    assert res.status_code == 200
    content = res.content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(content)))
    assert len(rows) >= 1
    header = rows[0]
    assert "Request ID" in header
    assert "Leave Type" in header
    assert "Days Count" in header


def test_export_invoices_csv(app_client, admin_cookies):
    res = app_client.get("/api/export/invoices/csv", cookies=admin_cookies)
    assert res.status_code == 200
    content = res.content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(content)))
    assert len(rows) >= 1
    header = rows[0]
    assert "Invoice ID" in header
    assert "Payment Period" in header
    assert "Amount USD" in header


def test_export_google_sheets(app_client, admin_cookies, monkeypatch):
    import sheets_client

    mock_client = MagicMock()
    mock_client.export_to_worksheet.return_value = {
        "worksheet_title": "Export_Employees_Custom",
        "rows_count": 3,
        "spreadsheet_url": "https://docs.google.com/spreadsheets/d/test-sheet-id/edit#gid=12345",
        "spreadsheet_id": "test-sheet-id",
    }
    monkeypatch.setattr(sheets_client, "get_client", lambda: mock_client)
    monkeypatch.setattr(Config, "SPREADSHEET_ID", "test-sheet-id")

    payload = {
        "worksheet_title": "Export_Employees_Custom",
    }
    res = app_client.post("/api/export/employees/sheets", json=payload, cookies=admin_cookies)
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["worksheet_title"] == "Export_Employees_Custom"
    assert "spreadsheet_url" in data
    assert mock_client.export_to_worksheet.called


def test_export_google_sheets_fails_without_spreadsheet_id(app_client, admin_cookies, monkeypatch):
    monkeypatch.setattr(Config, "SPREADSHEET_ID", "")
    res = app_client.post("/api/export/employees/sheets", json={}, cookies=admin_cookies)
    assert res.status_code == 400
    assert "SPREADSHEET_ID is missing" in res.json()["detail"]


def test_export_requires_admin(app_client, employee_cookies):
    # Non-admin user attempting export
    res_csv = app_client.get("/api/export/employees/csv", cookies=employee_cookies)
    assert res_csv.status_code == 403

    res_sheets = app_client.post("/api/export/employees/sheets", json={}, cookies=employee_cookies)
    assert res_sheets.status_code == 403


def test_export_invalid_dataset(app_client, admin_cookies):
    res = app_client.get("/api/export/unknown_dataset/csv", cookies=admin_cookies)
    assert res.status_code == 400
    assert "Invalid dataset" in res.json()["detail"]
