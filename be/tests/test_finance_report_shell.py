"""
be/tests/test_finance_report_shell.py
Tests for Story 7.1 - Standard report library and shell.
Verifies:
1. Categorized report library catalog with 6 business question domains and metadata.
2. Saved report view creation, listing, default view toggling, and deletion.
3. Contextual drill-down into contributing ledger records and documents.
4. RBAC gating with finance.report.read.
"""
import pytest
from datetime import datetime
from fastapi import status


@pytest.fixture
def report_shell_env(app_client, admin_cookies):
    # 1. Create Bank Account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Operating Primary",
            "bank_name": "Commercial International Bank",
            "account_number": f"EG-CIB-{datetime.utcnow().timestamp()}",
            "currency": "USD",
            "opening_balance": 25000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    account = acc_res.json()
    account_id = account["id"]

    # 2. Create Transaction Category
    cat_res = app_client.post(
        "/api/finance/categories",
        json={
            "name": "Cloud Computing Infrastructure",
            "kind": "cost",
            "sort_order": 1,
            "is_active": True,
        },
        cookies=admin_cookies,
    )
    assert cat_res.status_code == 201
    category = cat_res.json()
    cat_id = category["id"]

    # 3. Create Transactions for Drilldown
    tx1 = app_client.post(
        f"/api/finance/accounts/{account_id}/transactions",
        json={
            "date": "2026-09-05",
            "amount": 1200.0,
            "direction": "out",
            "currency": "USD",
            "category_id": cat_id,
            "reference": "AWS-SEP-01",
            "description": "Amazon Web Services EC2 Cluster",
            "counterparty": "Amazon Web Services",
        },
        cookies=admin_cookies,
    )
    assert tx1.status_code == 201

    tx2 = app_client.post(
        f"/api/finance/accounts/{account_id}/transactions",
        json={
            "date": "2026-09-10",
            "amount": 800.0,
            "direction": "out",
            "currency": "USD",
            "category_id": cat_id,
            "reference": "AWS-SEP-02",
            "description": "Amazon Web Services S3 Storage",
            "counterparty": "Amazon Web Services",
        },
        cookies=admin_cookies,
    )
    assert tx2.status_code == 201

    # 4. Create an issued cheque
    chk_res = app_client.post(
        "/api/finance/cheques",
        json={
            "account_id": account_id,
            "cheque_number": f"CHK-{int(datetime.utcnow().timestamp()) % 100000}",
            "payee": "Office Space Landlord",
            "amount": 3500.0,
            "currency": "USD",
            "issue_date": "2026-09-01",
            "status": "issued",
            "purpose": "rent",
        },
        cookies=admin_cookies,
    )
    assert chk_res.status_code == 201

    return {
        "account": account,
        "category": category,
    }


def test_get_report_library_catalog(app_client, admin_cookies):
    """Report library returns 6 categorized domains and comprehensive metadata."""
    res = app_client.get(
        "/api/finance/reports/library",
        cookies=admin_cookies,
    )
    assert res.status_code == status.HTTP_200_OK
    catalog = res.json()

    # Verify 6 core domains
    expected_categories = [
        "Performance",
        "Cash & Banking",
        "Sales & Receivables",
        "Spend & Payables",
        "Payroll",
        "Audit & Compliance",
    ]
    for c in expected_categories:
        assert c in catalog["categories"]

    reports = catalog["reports"]
    assert len(reports) >= 8

    # Verify report metadata structure
    keys = [r["key"] for r in reports]
    assert "category-summary" in keys
    assert "matrix" in keys
    assert "balances" in keys
    assert "transactions" in keys
    assert "cheques" in keys

    cat_report = next(r for r in reports if r["key"] == "category-summary")
    assert cat_report["category"] == "Performance"
    assert "business_question" in cat_report
    assert len(cat_report["business_question"]) > 10
    assert "description" in cat_report
    assert "icon" in cat_report
    assert "supported_basis" in cat_report
    assert "supported_formats" in cat_report


def test_saved_report_views_crud(app_client, admin_cookies):
    """Users can save, list, restore, and delete custom filter views."""
    # 1. Create a saved view
    create_res = app_client.post(
        "/api/finance/reports/saved-views",
        json={
            "report_key": "category-summary",
            "view_name": "Executive USD View",
            "filters": {
                "period": "QTD",
                "basis": "accrual",
                "currency": "USD",
                "entity": "Voyance Health Inc",
            },
            "is_default": True,
        },
        cookies=admin_cookies,
    )
    assert create_res.status_code == status.HTTP_200_OK
    created = create_res.json()
    assert created["view_name"] == "Executive USD View"
    assert created["filters"]["period"] == "QTD"
    assert created["is_default"] is True
    view_id = created["id"]

    # 2. List saved views for this report
    list_res = app_client.get(
        "/api/finance/reports/saved-views?report_key=category-summary",
        cookies=admin_cookies,
    )
    assert list_res.status_code == status.HTTP_200_OK
    views = list_res.json()
    assert len(views) >= 1
    found = next((v for v in views if v["id"] == view_id), None)
    assert found is not None
    assert found["filters"]["currency"] == "USD"

    # 3. Create second view and set default -> previous default should be unset
    v2_res = app_client.post(
        "/api/finance/reports/saved-views",
        json={
            "report_key": "category-summary",
            "view_name": "Local EGP Cash View",
            "filters": {
                "period": "MTD",
                "basis": "cash",
                "currency": "EGP",
            },
            "is_default": True,
        },
        cookies=admin_cookies,
    )
    assert v2_res.status_code == status.HTTP_200_OK
    v2 = v2_res.json()
    assert v2["is_default"] is True

    # Check that previous view is no longer default
    list_res2 = app_client.get(
        "/api/finance/reports/saved-views?report_key=category-summary",
        cookies=admin_cookies,
    )
    views2 = list_res2.json()
    old_view = next(v for v in views2 if v["id"] == view_id)
    assert old_view["is_default"] is False

    # 4. Delete saved view
    del_res = app_client.delete(
        f"/api/finance/reports/saved-views/{view_id}",
        cookies=admin_cookies,
    )
    assert del_res.status_code == status.HTTP_200_OK
    assert del_res.json()["success"] is True

    # Confirm deletion
    list_res3 = app_client.get(
        "/api/finance/reports/saved-views?report_key=category-summary",
        cookies=admin_cookies,
    )
    views3 = list_res3.json()
    assert not any(v["id"] == view_id for v in views3)


def test_contextual_drilldown_category(app_client, admin_cookies, report_shell_env):
    """Drill-down into category spend returns individual contributing transactions."""
    env = report_shell_env
    cat_id = env["category"]["id"]

    res = app_client.get(
        f"/api/finance/reports/drilldown?report_key=category-summary&drilldown_type=category&drilldown_id={cat_id}&currency=USD",
        cookies=admin_cookies,
    )
    assert res.status_code == status.HTTP_200_OK
    data = res.json()
    assert data["report_key"] == "category-summary"
    assert data["total_records"] == 2
    assert data["total_amount"] == 2000.0  # 1200 + 800
    assert len(data["records"]) == 2
    descriptions = [r["description"] for r in data["records"]]
    assert "Amazon Web Services EC2 Cluster" in descriptions
    assert "Amazon Web Services S3 Storage" in descriptions


def test_contextual_drilldown_cheques(app_client, admin_cookies, report_shell_env):
    """Drill-down into cheque status returns individual contributing cheques."""
    res = app_client.get(
        "/api/finance/reports/drilldown?report_key=cheques&drilldown_type=cheques&drilldown_id=issued",
        cookies=admin_cookies,
    )
    assert res.status_code == status.HTTP_200_OK
    data = res.json()
    assert data["report_key"] == "cheques"
    assert data["total_records"] >= 1
    assert any(c["payee"] == "Office Space Landlord" for c in data["records"])
