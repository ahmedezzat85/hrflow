"""
be/tests/test_finance_core_reports.py
Unit and integration tests for Story 7.2 Core accounting and aging reports:
- Profit & Loss Statement (Cash and Accrual basis + Comparison)
- Balance Sheet (Assets = Liabilities + Equity)
- Trial Balance (Debits == Credits, net zero variance)
- Statement of Cash Flows (Reconciled with Beginning + Ending Cash)
- AR Aging (Customer 30-day aging buckets)
- AP Aging (Vendor 30-day aging buckets)
"""
import pytest
from datetime import datetime, timedelta
from fastapi import status


@pytest.fixture
def core_reports_env(app_client, admin_cookies):
    # 1. Bank Account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": f"Operating Core {datetime.utcnow().timestamp()}",
            "bank_name": "Test Global Bank",
            "account_number": f"GB-{int(datetime.utcnow().timestamp())}",
            "currency": "USD",
            "opening_balance": 50000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == status.HTTP_201_CREATED
    account_id = acc_res.json()["id"]

    # 2. Customer
    cust_res = app_client.post(
        "/api/finance/customers",
        json={
            "name": f"Acme Health Systems {datetime.utcnow().timestamp()}",
            "code": f"CUST-{int(datetime.utcnow().timestamp())}",
            "currency": "USD",
        },
        cookies=admin_cookies,
    )
    assert cust_res.status_code == status.HTTP_201_CREATED
    customer_id = cust_res.json()["id"]

    # 3. Vendor
    vend_res = app_client.post(
        "/api/finance/vendors",
        json={
            "name": f"Cloud Hosting Co {datetime.utcnow().timestamp()}",
            "currency": "USD",
        },
        cookies=admin_cookies,
    )
    assert vend_res.status_code == status.HTTP_201_CREATED
    vendor_id = vend_res.json()["id"]

    # 4. Invoices (AR)
    today = datetime.utcnow().date()
    inv1_res = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": f"INV-TEST-1-{int(datetime.utcnow().timestamp())}",
            "issue_date": (today - timedelta(days=45)).strftime("%Y-%m-%d"),
            "due_date": (today - timedelta(days=15)).strftime("%Y-%m-%d"),
            "status": "sent",
            "currency": "USD",
            "lines": [
                {"description": "Diagnostic Scanning Services", "quantity": 1.0, "unit_price": 12000.0, "line_total": 12000.0}
            ],
        },
        cookies=admin_cookies,
    )
    assert inv1_res.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)

    inv2_res = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": f"INV-TEST-2-{int(datetime.utcnow().timestamp())}",
            "issue_date": (today - timedelta(days=10)).strftime("%Y-%m-%d"),
            "due_date": (today + timedelta(days=20)).strftime("%Y-%m-%d"),
            "status": "sent",
            "currency": "USD",
            "lines": [
                {"description": "Maintenance Support", "quantity": 1.0, "unit_price": 8000.0, "line_total": 8000.0}
            ],
        },
        cookies=admin_cookies,
    )
    assert inv2_res.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)

    # 5. Bill (AP)
    bill_res = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": f"BILL-TEST-{int(datetime.utcnow().timestamp())}",
            "issue_date": (today - timedelta(days=40)).strftime("%Y-%m-%d"),
            "due_date": (today - timedelta(days=10)).strftime("%Y-%m-%d"),
            "status": "unpaid",
            "currency": "USD",
            "lines": [
                {"description": "Server Hosting", "quantity": 1.0, "unit_price": 5000.0, "line_total": 5000.0}
            ],
        },
        cookies=admin_cookies,
    )
    assert bill_res.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)

    # 6. Ledger Transactions
    tx_in = app_client.post(
        f"/api/finance/accounts/{account_id}/transactions",
        json={
            "date": today.strftime("%Y-%m-%d"),
            "amount": 15000.0,
            "direction": "in",
            "currency": "USD",
            "reference": "TX-IN-01",
            "description": "Customer Payment Inflow",
        },
        cookies=admin_cookies,
    )
    assert tx_in.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)

    tx_out = app_client.post(
        f"/api/finance/accounts/{account_id}/transactions",
        json={
            "date": today.strftime("%Y-%m-%d"),
            "amount": 4000.0,
            "direction": "out",
            "currency": "USD",
            "reference": "TX-OUT-01",
            "description": "Operating Expense Outflow",
        },
        cookies=admin_cookies,
    )
    assert tx_out.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)

    return {
        "account_id": account_id,
        "customer_id": customer_id,
        "vendor_id": vendor_id,
    }


def test_profit_and_loss_report(app_client, admin_cookies, core_reports_env):
    # Cash basis
    resp_cash = app_client.get("/api/finance/reports/profit-and-loss?basis=cash&currency=USD", cookies=admin_cookies)
    assert resp_cash.status_code == status.HTTP_200_OK
    pnl_cash = resp_cash.json()
    assert pnl_cash["report_title"] == "Profit & Loss Statement"
    assert pnl_cash["basis"] == "cash"
    assert pnl_cash["total_revenue"] >= 15000.0
    assert pnl_cash["total_expenses"] >= 4000.0
    assert pnl_cash["net_income"] == round(pnl_cash["total_revenue"] - pnl_cash["total_expenses"], 2)

    # Accrual basis with explicit date_from covering both test invoices
    today = datetime.utcnow().date()
    d_from = (today - timedelta(days=60)).strftime("%Y-%m-%d")
    resp_accrual = app_client.get(f"/api/finance/reports/profit-and-loss?basis=accrual&currency=USD&date_from={d_from}", cookies=admin_cookies)
    assert resp_accrual.status_code == status.HTTP_200_OK
    pnl_accrual = resp_accrual.json()
    assert pnl_accrual["basis"] == "accrual"
    assert pnl_accrual["total_revenue"] >= 20000.0  # 12000 + 8000
    assert pnl_accrual["total_expenses"] >= 5000.0   # 5000 bill
    assert pnl_accrual["net_income"] == round(pnl_accrual["total_revenue"] - pnl_accrual["total_expenses"], 2)


def test_balance_sheet_balanced(app_client, admin_cookies, core_reports_env):
    today = datetime.utcnow().date().strftime("%Y-%m-%d")
    resp = app_client.get(f"/api/finance/reports/balance-sheet?as_of_date={today}&currency=USD", cookies=admin_cookies)
    assert resp.status_code == status.HTTP_200_OK
    bs = resp.json()

    assert bs["report_title"] == "Balance Sheet"
    assert "assets" in bs and "liabilities" in bs and "equity" in bs
    assert bs["is_balanced"] is True
    assert bs["variance"] == 0.0
    assert bs["total_assets"] == bs["total_liabilities_and_equity"]


def test_trial_balance_debits_equal_credits(app_client, admin_cookies, core_reports_env):
    today = datetime.utcnow().date().strftime("%Y-%m-%d")
    resp = app_client.get(f"/api/finance/reports/trial-balance?as_of_date={today}&currency=USD", cookies=admin_cookies)
    assert resp.status_code == status.HTTP_200_OK
    tb = resp.json()

    assert tb["report_title"] == "Trial Balance"
    assert tb["total_debits"] > 0.0
    assert tb["total_credits"] > 0.0
    assert tb["is_balanced"] is True
    assert abs(tb["total_debits"] - tb["total_credits"]) < 0.01
    assert tb["variance"] == 0.0


def test_cash_flow_statement_reconciled(app_client, admin_cookies, core_reports_env):
    resp = app_client.get("/api/finance/reports/cash-flow?currency=USD", cookies=admin_cookies)
    assert resp.status_code == status.HTTP_200_OK
    cf = resp.json()

    assert cf["report_title"] == "Statement of Cash Flows"
    assert cf["is_reconciled"] is True
    assert "operating_activities" in cf
    assert cf["net_cash_operating"] != 0.0


def test_ar_aging_and_ap_aging_reports(app_client, admin_cookies, core_reports_env):
    today = datetime.utcnow().date().strftime("%Y-%m-%d")

    # AR Aging
    resp_ar = app_client.get(f"/api/finance/reports/ar-aging?as_of_date={today}&currency=USD", cookies=admin_cookies)
    assert resp_ar.status_code == status.HTTP_200_OK
    ar = resp_ar.json()
    assert ar["aging_type"] == "ar"
    assert len(ar["rows"]) >= 1
    assert ar["totals"]["total"] >= 20000.0  # 12000 + 8000
    # Inv1 was due 15 days ago -> in days_1_30
    assert ar["totals"]["days_1_30"] >= 12000.0
    # Inv2 is due in 20 days -> in current
    assert ar["totals"]["current"] >= 8000.0

    # AP Aging
    resp_ap = app_client.get(f"/api/finance/reports/ap-aging?as_of_date={today}&currency=USD", cookies=admin_cookies)
    assert resp_ap.status_code == status.HTTP_200_OK
    ap = resp_ap.json()
    assert ap["aging_type"] == "ap"
    assert len(ap["rows"]) >= 1
    assert ap["totals"]["total"] >= 5000.0
    # Bill1 was due 10 days ago -> in days_1_30
    assert ap["totals"]["days_1_30"] >= 5000.0
