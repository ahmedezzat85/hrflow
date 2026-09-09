"""
be/tests/test_finance_placeholders.py
Unit and integration tests for Phase 2: Placeholder Architecture.
Verifies all 6 /api/finance/* stub endpoints are wired, gated with RBAC permissions,
and return expected placeholder schemas.
"""
import pytest


def test_finance_stubs_admin_authorized(app_client, admin_cookies):
    """Admin holding system_admin role can access all finance stub routes."""
    # 1. Invoices
    inv_res = app_client.get("/api/finance/invoices", cookies=admin_cookies)
    assert inv_res.status_code == 200
    invoices = inv_res.json()
    assert len(invoices) >= 2
    assert "invoice_number" in invoices[0]
    assert "total" in invoices[0]
    assert "status" in invoices[0]

    # 2. Bills
    bills_res = app_client.get("/api/finance/bills", cookies=admin_cookies)
    assert bills_res.status_code == 200
    bills = bills_res.json()
    assert len(bills) >= 2
    assert "bill_number" in bills[0]
    assert "vendor_name" in bills[0]

    # 3. Payroll runs
    payroll_res = app_client.get("/api/finance/payroll/runs", cookies=admin_cookies)
    assert payroll_res.status_code == 200
    runs = payroll_res.json()
    assert len(runs) >= 2
    assert "period_label" in runs[0]
    assert "total_net" in runs[0]

    # 4. Bank accounts (real CRUD as of Phase 4.1)
    app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Voyance Primary",
            "bank_name": "Chase",
            "account_number": "1234567890",
            "currency": "USD",
            "current_balance": 50000.0,
        },
        cookies=admin_cookies,
    )
    accounts_res = app_client.get("/api/finance/accounts", cookies=admin_cookies)
    assert accounts_res.status_code == 200
    accounts = accounts_res.json()
    assert len(accounts) >= 1
    assert "account_name" in accounts[0]
    assert "current_balance" in accounts[0]
    # Account numbers must be masked
    assert "******" in accounts[0]["account_number"]

    # 5. Subscriptions
    subs_res = app_client.get("/api/finance/subscriptions", cookies=admin_cookies)
    assert subs_res.status_code == 200
    subs = subs_res.json()
    assert len(subs) >= 2
    assert "billing_cycle" in subs[0]
    assert "auto_generate_bill" in subs[0]

    # 6. Reports summary
    rep_res = app_client.get("/api/finance/reports/summary", cookies=admin_cookies)
    assert rep_res.status_code == 200
    summary = rep_res.json()
    assert "balance" in summary
    assert "revenue_mtd" in summary
    assert "cost_mtd" in summary


def test_finance_stubs_employee_forbidden(app_client, employee_cookies):
    """Employee without finance.* permissions is rejected with 403 Forbidden on all finance routes."""
    endpoints = [
        "/api/finance/invoices",
        "/api/finance/bills",
        "/api/finance/payroll/runs",
        "/api/finance/accounts",
        "/api/finance/subscriptions",
        "/api/finance/reports/summary",
    ]
    for endpoint in endpoints:
        res = app_client.get(endpoint, cookies=employee_cookies)
        assert res.status_code == 403, f"Expected 403 for employee on {endpoint}, got {res.status_code}"
        assert "Permission denied" in res.json().get("detail", "")


def test_employee_my_payslips_allowed(app_client, employee_cookies):
    """Employee holding 'self.payslip.read' can access /api/finance/payroll/payslips/my."""
    res = app_client.get("/api/finance/payroll/payslips/my", cookies=employee_cookies)
    assert res.status_code == 200
    payslips = res.json()
    assert isinstance(payslips, list)
    if len(payslips) > 0:
        assert "net_pay" in payslips[0]
        assert "period_label" in payslips[0]


def test_finance_stubs_unauthenticated_rejected(app_client):
    """Unauthenticated calls without cookies return 401 Unauthorized."""
    endpoints = [
        "/api/finance/invoices",
        "/api/finance/bills",
        "/api/finance/payroll/runs",
        "/api/finance/accounts",
        "/api/finance/subscriptions",
        "/api/finance/reports/summary",
        "/api/finance/payroll/payslips/my",
    ]
    for endpoint in endpoints:
        res = app_client.get(endpoint)
        assert res.status_code == 401
