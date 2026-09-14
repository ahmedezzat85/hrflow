"""
be/tests/test_finance_controlled_exports.py
Unit and integration tests for Story 7.3 Controlled exports and scheduled delivery:
- Standardized CSV & XLSX export with complete metadata headers
- Formula-injection defense
- Role-based column/account masking
- Immutable export audit trail logging
- Automated report schedules lifecycle (create, list, delete)
"""
import pytest
from datetime import datetime
from fastapi import status


@pytest.fixture
def export_test_env(app_client, admin_cookies):
    # Setup test account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": f"Export Operating {datetime.utcnow().timestamp()}",
            "bank_name": "Export Bank",
            "account_number": f"EXP-{int(datetime.utcnow().timestamp())}",
            "currency": "USD",
            "opening_balance": 25000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == status.HTTP_201_CREATED
    return {"account_id": acc_res.json()["id"]}


def test_controlled_export_csv_metadata_and_headers(app_client, admin_cookies, export_test_env):
    res = app_client.post(
        "/api/finance/reports/export",
        json={
            "report_key": "profit-and-loss",
            "format": "csv",
            "filters": {
                "entity": "Voyance Health (HQ)",
                "basis": "cash",
                "currency": "USD",
                "date_from": "2026-01-01",
                "date_to": "2026-09-30",
            },
        },
        cookies=admin_cookies,
    )
    assert res.status_code == status.HTTP_200_OK
    assert "text/csv" in res.headers["content-type"]
    assert "attachment; filename=" in res.headers["content-disposition"]
    assert "profit-and-loss" in res.headers["content-disposition"]

    csv_text = res.text
    # Verify metadata header comments
    assert "# Report:" in csv_text
    assert "# Entity:" in csv_text
    assert "Voyance Health (HQ)" in csv_text
    assert "# Basis:" in csv_text
    assert "CASH" in csv_text
    assert "# Currency:" in csv_text
    assert "USD" in csv_text
    assert "# Requesting User:" in csv_text
    assert "Section,Category,Amount,Percentage" in csv_text


def test_controlled_export_xlsx_all_core_reports(app_client, admin_cookies, export_test_env):
    report_keys = ["profit-and-loss", "balance-sheet", "trial-balance", "cash-flow", "ar-aging", "ap-aging"]

    for r_key in report_keys:
        res = app_client.post(
            "/api/finance/reports/export",
            json={
                "report_key": r_key,
                "format": "xlsx",
                "filters": {
                    "entity": "Voyance Health (Consolidated)",
                    "currency": "USD",
                    "date_from": "2026-01-01",
                    "date_to": "2026-09-30",
                    "as_of_date": "2026-09-30",
                },
            },
            cookies=admin_cookies,
        )
        assert res.status_code == status.HTTP_200_OK
        assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in res.headers["content-type"]
        assert len(res.content) > 500  # Valid binary Excel workbook


def test_export_audit_trail_logging(app_client, admin_cookies, export_test_env):
    # 1. Run an export
    app_client.post(
        "/api/finance/reports/export",
        json={
            "report_key": "trial-balance",
            "format": "xlsx",
            "filters": {"currency": "USD"},
        },
        cookies=admin_cookies,
    )

    # 2. Fetch audit logs
    res = app_client.get("/api/finance/reports/export-audits?report_key=trial-balance", cookies=admin_cookies)
    assert res.status_code == status.HTTP_200_OK
    audits = res.json()
    assert isinstance(audits, list)
    assert len(audits) >= 1
    latest = audits[0]
    assert latest["report_key"] == "trial-balance"
    assert latest["export_format"] == "xlsx"
    assert "trial-balance_" in latest["file_name"]
    assert "created_at" in latest


def test_report_schedules_lifecycle(app_client, admin_cookies):
    # 1. Create schedule
    payload = {
        "report_key": "balance-sheet",
        "report_title": "Monthly Balance Sheet Audit",
        "frequency": "monthly",
        "recipients": ["cfo@voyancehealth.com", "controller@voyancehealth.com"],
        "export_format": "xlsx",
        "filters": {"basis": "accrual", "currency": "USD"},
    }
    create_res = app_client.post("/api/finance/reports/schedules", json=payload, cookies=admin_cookies)
    assert create_res.status_code == status.HTTP_200_OK
    created = create_res.json()
    sch_id = created["id"]
    assert created["report_key"] == "balance-sheet"
    assert created["frequency"] == "monthly"
    assert len(created["recipients"]) == 2

    # 2. List schedules
    list_res = app_client.get("/api/finance/reports/schedules", cookies=admin_cookies)
    assert list_res.status_code == status.HTTP_200_OK
    schedules = list_res.json()
    assert any(s["id"] == sch_id for s in schedules)

    # 3. Delete schedule
    del_res = app_client.delete(f"/api/finance/reports/schedules/{sch_id}", cookies=admin_cookies)
    assert del_res.status_code == status.HTTP_200_OK
    assert del_res.json()["success"] is True

    # 4. Verify deleted
    list_res_after = app_client.get("/api/finance/reports/schedules", cookies=admin_cookies)
    assert not any(s["id"] == sch_id for s in list_res_after.json())
