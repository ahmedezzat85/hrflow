"""
be/tests/test_finance_context_kpis.py
Integration and unit tests for Finance Context Bar & Trustworthy KPIs (Story 2.1).
Covers:
- Contextual query scoping: entity, period, accounting basis, currency.
- Cash vs Accrual calculation differences and accuracy.
- KPI metadata: formulas, source coverage, period, definitions, and drill-down targets.
- Margin validity: calculated only when revenue > 0, safely handled when revenue is 0.
- Multi-currency conversion policy disclosure.
"""
import pytest
from datetime import datetime


def test_finance_summary_context_defaults(app_client, admin_cookies):
    res = app_client.get("/api/finance/reports/summary", cookies=admin_cookies)
    assert res.status_code == 200
    data = res.json()

    # Core backward-compatible fields
    assert "balance" in data
    assert "revenue_mtd" in data
    assert "cost_mtd" in data
    assert "net_mtd" in data
    assert data["period"] == "MTD"
    assert data["basis"] == "cash"
    assert data["currency"] == "USD"
    assert "conversion_policy" in data

    # Trustworthy KPI metadata
    assert "kpis" in data
    kpis = data["kpis"]
    for kpi_key in ["total_cash", "revenue", "operating_spend", "net_result", "operating_margin"]:
        assert kpi_key in kpis
        kpi = kpis[kpi_key]
        assert "label" in kpi
        assert "definition" in kpi
        assert "formula" in kpi
        assert "source_coverage" in kpi
        assert "drilldown_section" in kpi


def test_cash_vs_accrual_basis_calculation(app_client, admin_cookies):
    today_str = datetime.utcnow().strftime("%Y-%m-%d")

    # 1. Create USD Bank Account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "KPI Test Ops Account",
            "account_number": "ACC-KPI-9901",
            "currency": "USD",
            "opening_balance": 50000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    acc_id = acc_res.json()["id"]

    # 2. Add Cash Inflow (Cash revenue)
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": today_str,
            "amount": 12000.0,
            "direction": "in",
            "currency": "USD",
            "reference": "Cash Sales Receipt",
            "description": "Immediate direct revenue",
        },
        cookies=admin_cookies,
    )

    # 3. Add Cash Outflow (Cash expense)
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": today_str,
            "amount": 4000.0,
            "direction": "out",
            "currency": "USD",
            "reference": "Cloud hosting cash payment",
            "description": "Direct hosting cost",
        },
        cookies=admin_cookies,
    )

    # 4. Create Customer and Sales Invoice (Accrual revenue)
    cust_res = app_client.post(
        "/api/finance/customers",
        json={"name": "KPI Test Customer", "contact_email": "kpi@test.com"},
        cookies=admin_cookies,
    )
    cust_id = cust_res.json()["id"]

    inv_res = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": cust_id,
            "invoice_number": f"INV-KPI-{datetime.utcnow().strftime('%H%M%S')}",
            "issue_date": today_str,
            "due_date": today_str,
            "status": "sent",
            "currency": "USD",
            "lines": [{"description": "Enterprise Licensing", "quantity": 1, "unit_price": 30000.0}],
        },
        cookies=admin_cookies,
    )
    assert inv_res.status_code == 201

    # 5. Create Vendor and Bill (Accrual spend)
    vend_res = app_client.post(
        "/api/finance/vendors",
        json={"name": "KPI Test Vendor"},
        cookies=admin_cookies,
    )
    vend_id = vend_res.json()["id"]

    bill_res = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vend_id,
            "bill_number": f"BILL-KPI-{datetime.utcnow().strftime('%H%M%S')}",
            "issue_date": today_str,
            "due_date": today_str,
            "currency": "USD",
            "lines": [{"description": "Security Audit", "quantity": 1, "unit_price": 10000.0}],
        },
        cookies=admin_cookies,
    )
    assert bill_res.status_code == 201

    # 6. Test Cash Basis Query
    cash_res = app_client.get(
        "/api/finance/reports/summary?basis=cash&period=MTD&currency=USD",
        cookies=admin_cookies,
    )
    assert cash_res.status_code == 200
    cash_data = cash_res.json()
    assert cash_data["basis"] == "cash"
    # Cash revenue must include the 12,000 transaction
    assert cash_data["revenue_mtd"] >= 12000.0
    # Cash cost must include the 4,000 transaction
    assert cash_data["cost_mtd"] >= 4000.0
    assert cash_data["net_mtd"] == round(cash_data["revenue_mtd"] - cash_data["cost_mtd"], 2)
    assert cash_data["margin_valid"] is True
    assert cash_data["margin_pct"] is not None

    # 7. Test Accrual Basis Query
    accrual_res = app_client.get(
        "/api/finance/reports/summary?basis=accrual&period=MTD&currency=USD",
        cookies=admin_cookies,
    )
    assert accrual_res.status_code == 200
    accrual_data = accrual_res.json()
    assert accrual_data["basis"] == "accrual"
    # Accrual revenue must include the 30,000 invoice
    assert accrual_data["revenue_mtd"] >= 30000.0
    # Accrual cost must include the 10,000 bill
    assert accrual_data["cost_mtd"] >= 10000.0
    assert accrual_data["net_mtd"] == round(accrual_data["revenue_mtd"] - accrual_data["cost_mtd"], 2)
    assert accrual_data["margin_valid"] is True
    assert accrual_data["kpis"]["revenue"]["drilldown_section"] == "finance-invoices"
    assert accrual_data["kpis"]["operating_spend"]["drilldown_section"] == "finance-bills"


def test_currency_and_margin_validity(app_client, admin_cookies):
    # Query currency with no revenue (e.g. EGP if no transactions seeded yet)
    res = app_client.get(
        "/api/finance/reports/summary?currency=EGP&period=MTD",
        cookies=admin_cookies,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["currency"] == "EGP"

    margin_kpi = data["kpis"]["operating_margin"]
    if data["revenue_mtd"] <= 0:
        assert data["margin_valid"] is False
        assert data["margin_pct"] is None
        assert margin_kpi["is_valid"] is False
    else:
        assert data["margin_valid"] is True
        assert data["margin_pct"] is not None


def test_multi_currency_policy_disclosure(app_client, admin_cookies):
    res = app_client.get(
        "/api/finance/reports/summary?currency=all",
        cookies=admin_cookies,
    )
    assert res.status_code == 200
    data = res.json()
    assert "without conversion" in data["conversion_policy"]
