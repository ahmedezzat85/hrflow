"""
be/tests/test_finance_reports.py
Unit and integration tests for Financial Reports & Excel Export.
Covers Category Spend Rollups, Annual Matrices, Point-in-Time Balances, Cheque Registers,
RBAC permissions, and openpyxl binary exports.
"""
import io
import pytest
import openpyxl


def test_finance_reports_rbac(app_client, admin_cookies, employee_cookies):
    # Employee should be forbidden
    emp_resp = app_client.get("/api/finance/reports/transactions", cookies=employee_cookies)
    assert emp_resp.status_code == 403

    emp_resp2 = app_client.get("/api/finance/reports/category-summary", cookies=employee_cookies)
    assert emp_resp2.status_code == 403

    # Admin should succeed
    admin_resp = app_client.get("/api/finance/reports/transactions", cookies=admin_cookies)
    assert admin_resp.status_code == 200


def test_transactions_ledger_report(app_client, admin_cookies):
    # 1. Create account
    acc = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Reports Test Account 1",
            "account_number": "123456789001",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    ).json()
    acc_id = acc["id"]

    # 2. Add manual ledger transactions
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-05-10",
            "amount": 2500.0,
            "direction": "in",
            "currency": "USD",
            "reference": "Client Retainer INV-9001",
            "description": "Consulting retainer",
        },
        cookies=admin_cookies,
    )

    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-05-15",
            "amount": 1000.0,
            "direction": "out",
            "currency": "USD",
            "reference": "Software License",
            "description": "AWS Hosting",
        },
        cookies=admin_cookies,
    )

    # 3. Query report
    resp = app_client.get(
        f"/api/finance/reports/transactions?account_id={acc_id}&date_from=2026-05-01&date_to=2026-05-31",
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 2
    assert data["total_inflows"] == 2500.0
    assert data["total_outflows"] == 1000.0
    assert data["net_change"] == 1500.0


def test_category_summary_and_spent_rollup(app_client, admin_cookies):
    # Create account
    acc = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Reports Spend Account",
            "account_number": "123456789002",
            "currency": "USD",
            "opening_balance": 50000.0,
        },
        cookies=admin_cookies,
    ).json()
    acc_id = acc["id"]

    # Create categories
    cat1 = app_client.post(
        "/api/finance/categories",
        json={"name": "Hosting Cloud Infrastructure", "kind": "cost"},
        cookies=admin_cookies,
    ).json()
    cat2 = app_client.post(
        "/api/finance/categories",
        json={"name": "Office Supplies & Facilities", "kind": "cost"},
        cookies=admin_cookies,
    ).json()

    # Outflows
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-06-05",
            "amount": 3000.0,
            "direction": "out",
            "currency": "USD",
            "category_id": cat1["id"],
            "reference": "AWS Cloud",
        },
        cookies=admin_cookies,
    )

    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-06-12",
            "amount": 1000.0,
            "direction": "out",
            "currency": "USD",
            "category_id": cat2["id"],
            "reference": "Paper and supplies",
        },
        cookies=admin_cookies,
    )

    # Query Category Summary
    resp = app_client.get(
        "/api/finance/reports/category-summary?date_from=2026-06-01&date_to=2026-06-30",
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_spent"] >= 4000.0

    # Verify percentages
    cat1_item = next(c for c in data["categories"] if c["category_id"] == cat1["id"])
    assert cat1_item["total_amount"] == 3000.0
    cat2_item = next(c for c in data["categories"] if c["category_id"] == cat2["id"])
    assert cat2_item["total_amount"] == 1000.0


def test_category_by_period_matrix(app_client, admin_cookies):
    # Create account
    acc = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Matrix Test Account",
            "account_number": "123456789003",
            "currency": "USD",
            "opening_balance": 20000.0,
        },
        cookies=admin_cookies,
    ).json()
    acc_id = acc["id"]

    cat = app_client.post(
        "/api/finance/categories",
        json={"name": "SaaS Tools Matrix", "kind": "cost"},
        cookies=admin_cookies,
    ).json()

    # Jan 2026 & Feb 2026 transactions
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-01-15",
            "amount": 500.0,
            "direction": "out",
            "currency": "USD",
            "category_id": cat["id"],
        },
        cookies=admin_cookies,
    )

    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-02-20",
            "amount": 750.0,
            "direction": "out",
            "currency": "USD",
            "category_id": cat["id"],
        },
        cookies=admin_cookies,
    )

    # Monthly matrix
    resp = app_client.get(
        "/api/finance/reports/category-by-period-matrix?year=2026&period_group=month",
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["year"] == 2026
    assert data["period_group"] == "month"
    assert "Jan" in data["period_labels"]

    matching_row = next(r for r in data["rows"] if r["category_id"] == cat["id"])
    assert matching_row["periods"]["Jan"] == 500.0
    assert matching_row["periods"]["Feb"] == 750.0
    assert matching_row["total"] == 1250.0

    # Quarterly matrix
    q_resp = app_client.get(
        "/api/finance/reports/category-by-period-matrix?year=2026&period_group=quarter",
        cookies=admin_cookies,
    )
    assert q_resp.status_code == 200
    q_data = q_resp.json()
    assert q_data["period_labels"] == ["Q1", "Q2", "Q3", "Q4"]
    q_row = next(r for r in q_data["rows"] if r["category_id"] == cat["id"])
    assert q_row["periods"]["Q1"] == 1250.0


def test_point_in_time_balances(app_client, admin_cookies):
    acc = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Point In Time Vault",
            "account_number": "123456789004",
            "currency": "USD",
            "opening_balance": 50000.0,
            "country": "Egypt",
        },
        cookies=admin_cookies,
    ).json()
    acc_id = acc["id"]

    # Transaction 1: 2026-03-05 Inflow +10,000
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-03-05",
            "amount": 10000.0,
            "direction": "in",
            "currency": "USD",
        },
        cookies=admin_cookies,
    )

    # Transaction 2: 2026-03-15 Outflow -4,000
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-03-15",
            "amount": 4000.0,
            "direction": "out",
            "currency": "USD",
        },
        cookies=admin_cookies,
    )

    # Transaction 3: Future 2026-04-10 Inflow +20,000
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-04-10",
            "amount": 20000.0,
            "direction": "in",
            "currency": "USD",
        },
        cookies=admin_cookies,
    )

    # As of 2026-03-01: before any transactions -> 50,000
    r1 = app_client.get("/api/finance/reports/balances?as_of_date=2026-03-01", cookies=admin_cookies)
    assert r1.status_code == 200
    vault1 = next(a for a in r1.json()["accounts"] if a["account_id"] == acc_id)
    assert vault1["balance_as_of_date"] == 50000.0

    # As of 2026-03-20: includes tx 1 and 2, excludes tx 3 -> 50,000 + 10,000 - 4,000 = 56,000
    r2 = app_client.get("/api/finance/reports/balances?as_of_date=2026-03-20", cookies=admin_cookies)
    assert r2.status_code == 200
    vault2 = next(a for a in r2.json()["accounts"] if a["account_id"] == acc_id)
    assert vault2["balance_as_of_date"] == 56000.0

    # As of 2026-04-20: includes all 3 -> 56,000 + 20,000 = 76,000
    r3 = app_client.get("/api/finance/reports/balances?as_of_date=2026-04-20", cookies=admin_cookies)
    assert r3.status_code == 200
    vault3 = next(a for a in r3.json()["accounts"] if a["account_id"] == acc_id)
    assert vault3["balance_as_of_date"] == 76000.0


def test_cheques_report(app_client, admin_cookies):
    acc = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Cheque Book Account",
            "account_number": "123456789005",
            "currency": "EGP",
            "opening_balance": 200000.0,
        },
        cookies=admin_cookies,
    ).json()
    acc_id = acc["id"]

    # Issue cheque 1
    chk1 = app_client.post(
        "/api/finance/cheques",
        json={
            "cheque_number": "CHQ-REP-101",
            "account_id": acc_id,
            "issue_date": "2026-07-01",
            "amount": 15000.0,
            "currency": "EGP",
            "payee": "City Real Estate",
            "purpose_type": "vendor_payment",
            "notes": "Office rent",
        },
        cookies=admin_cookies,
    ).json()

    # Issue cheque 2
    app_client.post(
        "/api/finance/cheques",
        json={
            "cheque_number": "CHQ-REP-102",
            "account_id": acc_id,
            "issue_date": "2026-07-05",
            "amount": 25000.0,
            "currency": "EGP",
            "payee": "Equipment Vendor",
            "purpose_type": "vendor_payment",
        },
        cookies=admin_cookies,
    )

    # Clear cheque 1
    app_client.patch(
        f"/api/finance/cheques/{chk1['id']}/status",
        json={"status": "cleared", "clear_date": "2026-07-08"},
        cookies=admin_cookies,
    )

    # Query cheque report
    resp = app_client.get("/api/finance/reports/cheques?fiscal_year=2026", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["fiscal_year"] == 2026
    assert data["summary"]["total_count"] >= 2
    assert data["summary"]["by_status"]["cleared"]["count"] >= 1
    assert data["summary"]["by_status"]["issued"]["count"] >= 1


def test_reports_excel_exports(app_client, admin_cookies):
    # 1. Transactions Excel export
    r_tx = app_client.get("/api/finance/reports/transactions?format=xlsx", cookies=admin_cookies)
    assert r_tx.status_code == 200
    assert "openxmlformats" in r_tx.headers["content-type"]
    wb_tx = openpyxl.load_workbook(io.BytesIO(r_tx.content))
    assert "Transactions Ledger" in wb_tx.sheetnames

    # 2. Category Summary Excel export
    r_cat = app_client.get("/api/finance/reports/category-summary?format=xlsx", cookies=admin_cookies)
    assert r_cat.status_code == 200
    assert "openxmlformats" in r_cat.headers["content-type"]
    wb_cat = openpyxl.load_workbook(io.BytesIO(r_cat.content))
    assert "Category Spend Rollup" in wb_cat.sheetnames

    # 3. Spend Matrix Excel export
    r_mat = app_client.get("/api/finance/reports/category-by-period-matrix?year=2026&format=xlsx", cookies=admin_cookies)
    assert r_mat.status_code == 200
    wb_mat = openpyxl.load_workbook(io.BytesIO(r_mat.content))
    assert "Spend Matrix" in wb_mat.sheetnames

    # 4. Balances Excel export
    r_bal = app_client.get("/api/finance/reports/balances?as_of_date=2026-03-31&format=xlsx", cookies=admin_cookies)
    assert r_bal.status_code == 200
    wb_bal = openpyxl.load_workbook(io.BytesIO(r_bal.content))
    assert "Account Balances" in wb_bal.sheetnames

    # 5. Cheques Excel export
    r_chq = app_client.get("/api/finance/reports/cheques?fiscal_year=2026&format=xlsx", cookies=admin_cookies)
    assert r_chq.status_code == 200
    wb_chq = openpyxl.load_workbook(io.BytesIO(r_chq.content))
    assert "Cheque Register" in wb_chq.sheetnames
