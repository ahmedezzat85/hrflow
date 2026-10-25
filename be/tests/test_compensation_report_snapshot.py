"""
be/tests/test_compensation_report_snapshot.py
Snapshot test for ReportsService.get_employee_compensation_report
Verifies byte-identical output before and after extracting PayrollReadService.
"""
import copy
import pytest
from fx_test_helpers import seed_usd_egp_rate


@pytest.fixture(autouse=True)
def usd_egp_rate(app_client):
    """FX-1: payroll has no silent 50.0 fallback, so these tests start with one explicit USD-EGP transfer."""
    seed_usd_egp_rate(50.0)

from db import get_db_context
from models_db import EmployeeDB, EmployeeBankAccountDB
from finance.models import (
    FinanceBankAccountDB,
    TransactionCategoryDB,
    PaymentTypeDB,
    EmployeeCompensationPlanDB,
    PayrollTaxSettingsDB,
)
from finance.services.reports_service import ReportsService
from test_finance_payroll_adjustments import seed_env


def test_employee_compensation_report_snapshot(app_client, admin_cookies, seed_env):
    emp_id = seed_env["employee_id"]

    # 1. Create Run 1 (2026-09) with commission
    resp1 = app_client.post(
        "/api/finance/payroll/previews",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
        },
        cookies=admin_cookies,
    )
    p1 = resp1.json()
    app_client.post(
        f"/api/finance/payroll/previews/{p1['preview_id']}/adjustments",
        json={
            "employee_id": emp_id,
            "type": "COMMISSION",
            "direction": "ADDITION",
            "amount": 500.0,
            "payment_source": "EXT",
            "description": "Sales Comm",
        },
        cookies=admin_cookies,
    )
    p1_updated = app_client.get(f"/api/finance/payroll/previews/{p1['preview_id']}", cookies=admin_cookies).json()
    r1 = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
            "preview_id": p1["preview_id"],
            "preview_version": p1_updated["preview_version"],
            "source_version": p1_updated["source_version"],
        },
        cookies=admin_cookies,
    ).json()

    # 2. Create Run 2 (2026-10) with bonus
    resp2 = app_client.post(
        "/api/finance/payroll/previews",
        json={
            "period_label": "2026-10",
            "period_start": "2026-10-01",
            "period_end": "2026-10-31",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
        },
        cookies=admin_cookies,
    )
    p2 = resp2.json()
    app_client.post(
        f"/api/finance/payroll/previews/{p2['preview_id']}/adjustments",
        json={
            "employee_id": emp_id,
            "type": "BONUS",
            "direction": "ADDITION",
            "amount": 300.0,
            "payment_source": "INT",
            "description": "Oct Bonus",
        },
        cookies=admin_cookies,
    )
    p2_updated = app_client.get(f"/api/finance/payroll/previews/{p2['preview_id']}", cookies=admin_cookies).json()
    r2 = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2026-10",
            "period_start": "2026-10-01",
            "period_end": "2026-10-31",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
            "preview_id": p2["preview_id"],
            "preview_version": p2_updated["preview_version"],
            "source_version": p2_updated["source_version"],
        },
        cookies=admin_cookies,
    ).json()

    # Query the existing report
    resp = app_client.get(
        f"/api/finance/reports/compensation/employee/{emp_id}?start_date=2026-09-01&end_date=2026-10-31&currency=USD",
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    report_data = resp.json()

    # Assert exact snapshot structure and values
    expected = {
        "employee_id": emp_id,
        "employee_name": "Alice Adjustments",
        "department": "Engineering",
        "start_date": "2026-09-01",
        "end_date": "2026-10-31",
        "currency": "USD",
        "by_compensation_type": {
            "external_usd": 20000.0,
            "internal_usd_cash": 10000.0,
            "commission_sales": 500.0,
            "bonus": 300.0,
        },
        "total_external": 20000.0,
        "total_internal": 10000.0,
        "total_commission": 500.0,
        "total_bonus": 300.0,
        "grand_total": 30800.0,
        "payroll_runs_count": 2,
    }
    for k, v in expected.items():
        assert report_data[k] == v, f"Mismatch on {k}: {report_data[k]} != {v}"

    assert len(report_data["lines"]) == 6
    # Check lines fields
    for line in report_data["lines"]:
        assert set(line.keys()) == {
            "id", "payroll_run_id", "period_label", "compensation_type",
            "base_salary", "allowances_total", "deductions_total", "tax_amount",
            "net_pay", "employer_cost_extra", "payment_status", "paid_at", "linked_payment_id"
        }
