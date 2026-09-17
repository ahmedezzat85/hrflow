"""
be/tests/test_finance_payee_type.py
Automated tests for FUX-405: Employee Payee Type, validation rules,
and include_internal reporting toggle.
"""
import pytest
from models_db import EmployeeDB


def test_payee_type_defaults_and_validation(app_client, admin_cookies):
    # 1. Create bank account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Payee Test Account",
            "bank_name": "HSBC",
            "account_number": "9998887771",
            "currency": "USD",
            "opening_balance": 50000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201, acc_res.text
    acc_id = acc_res.json()["id"]

    # 2. Record transaction with default payee_type (omitted) -> defaults to "none"
    tx1_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 100.0,
            "direction": "out",
            "currency": "USD",
            "description": "Ad-hoc postage",
        },
        cookies=admin_cookies,
    )
    assert tx1_res.status_code == 201, tx1_res.text
    tx1 = tx1_res.json()
    assert tx1["payee_type"] == "none"
    assert tx1["payee_id"] is None

    # 3. Explicit payee_type='none' with payee_id provided -> rejected HTTP 400
    tx_bad_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 100.0,
            "direction": "out",
            "currency": "USD",
            "payee_type": "none",
            "payee_id": 12,
        },
        cookies=admin_cookies,
    )
    assert tx_bad_res.status_code == 400
    assert "payee_id cannot be provided" in tx_bad_res.text

    # 4. Invalid payee_type -> rejected HTTP 400
    tx_invalid_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 100.0,
            "direction": "out",
            "currency": "USD",
            "payee_type": "third_party_invalid",
        },
        cookies=admin_cookies,
    )
    assert tx_invalid_res.status_code == 400
    assert "Invalid payee_type" in tx_invalid_res.text


from db import get_db_context


def test_payee_type_vendor_and_employee(app_client, admin_cookies):
    # 1. Create bank account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Payee Vendor/Emp Account",
            "bank_name": "CIB",
            "account_number": "5554443332",
            "currency": "USD",
            "opening_balance": 50000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    acc_id = acc_res.json()["id"]

    # 2. Create Vendor
    v_res = app_client.post(
        "/api/finance/vendors",
        json={
            "name": "Global Cloud Services Ltd",
            "country": "United States",
            "default_currency": "USD",
        },
        cookies=admin_cookies,
    )
    assert v_res.status_code == 201, v_res.text
    vendor_id = v_res.json()["id"]

    # 3. Create Employee in DB
    with get_db_context() as db:
        emp = EmployeeDB(
            name="Nour Al-Sayed",
            email="nour.sayed@voyancehealth.com",
            role="staff",
            dept="Engineering",
            status="active",
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)
        emp_id = emp.id

    # 4. Record Vendor transaction with payee_id
    tx_v_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 1500.0,
            "direction": "out",
            "currency": "USD",
            "entry_type": "money_out",
            "payee_type": "vendor",
            "payee_id": vendor_id,
            "description": "Monthly AWS compute",
        },
        cookies=admin_cookies,
    )
    assert tx_v_res.status_code == 201, tx_v_res.text
    tx_v = tx_v_res.json()
    assert tx_v["payee_type"] == "vendor"
    assert tx_v["payee_id"] == vendor_id
    assert tx_v["payee_name"] == "Global Cloud Services Ltd"
    assert tx_v["counterparty"] == "Global Cloud Services Ltd"

    # 5. Record Employee transaction with payee_id
    tx_e_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 250.0,
            "direction": "out",
            "currency": "USD",
            "entry_type": "money_out",
            "payee_type": "employee",
            "payee_id": emp_id,
            "description": "Travel reimbursement for client demo",
        },
        cookies=admin_cookies,
    )
    assert tx_e_res.status_code == 201, tx_e_res.text
    tx_e = tx_e_res.json()
    assert tx_e["payee_type"] == "employee"
    assert tx_e["payee_id"] == emp_id
    assert tx_e["payee_name"] == "Nour Al-Sayed"

    # 6. Record Employee transaction with free-text payee_name and no payee_id
    tx_e_free = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 120.0,
            "direction": "out",
            "currency": "USD",
            "entry_type": "money_out",
            "payee_type": "employee",
            "payee_name": "Contract Specialist (Temporary)",
            "description": "Onboarding stipend",
        },
        cookies=admin_cookies,
    )
    assert tx_e_free.status_code == 201, tx_e_free.text
    assert tx_e_free.json()["payee_type"] == "employee"
    assert tx_e_free.json()["payee_id"] is None
    assert tx_e_free.json()["payee_name"] == "Contract Specialist (Temporary)"

    # 7. Non-existent vendor_id / emp_id -> rejected HTTP 400
    tx_bad_vendor = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 100.0,
            "direction": "out",
            "currency": "USD",
            "payee_type": "vendor",
            "payee_id": 999999,
        },
        cookies=admin_cookies,
    )
    assert tx_bad_vendor.status_code == 400
    assert "Vendor with ID 999999 not found" in tx_bad_vendor.text

    tx_bad_emp = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 100.0,
            "direction": "out",
            "currency": "USD",
            "payee_type": "employee",
            "payee_id": 999999,
        },
        cookies=admin_cookies,
    )
    assert tx_bad_emp.status_code == 400
    assert "Employee with ID 999999 not found" in tx_bad_emp.text


def test_update_payee_type_and_switching(app_client, admin_cookies):
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Switch Payee Account",
            "bank_name": "Chase",
            "account_number": "1112223334",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    )
    acc_id = acc_res.json()["id"]

    with get_db_context() as db:
        emp = EmployeeDB(
            name="Tarek Mansour",
            email="tarek.mansour@voyancehealth.com",
            role="staff",
            dept="Operations",
            status="active",
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)
        emp_id = emp.id

    # Create transaction with employee payee
    create_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 400.0,
            "direction": "out",
            "currency": "USD",
            "payee_type": "employee",
            "payee_id": emp_id,
        },
        cookies=admin_cookies,
    )
    assert create_res.status_code == 201
    tx_id = create_res.json()["id"]

    # Switch to payee_type='none' and clear payee_id
    update_res = app_client.put(
        f"/api/finance/transactions/{tx_id}",
        json={
            "payee_type": "none",
            "payee_id": None,
            "counterparty": "Ad-hoc Miscellaneous",
        },
        cookies=admin_cookies,
    )
    assert update_res.status_code == 200, update_res.text
    updated = update_res.json()
    assert updated["payee_type"] == "none"
    assert updated["payee_id"] is None
    assert updated["counterparty"] == "Ad-hoc Miscellaneous"


def test_reports_include_internal_filtering(app_client, admin_cookies):
    # 1. Create account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Reports Payee Filtering Acc",
            "bank_name": "NBE",
            "account_number": "4447778889",
            "currency": "USD",
            "opening_balance": 100000.0,
        },
        cookies=admin_cookies,
    )
    acc_id = acc_res.json()["id"]

    # 2. Create Vendor
    v_res = app_client.post(
        "/api/finance/vendors",
        json={"name": "Office Supplies Corp", "country": "Egypt", "default_currency": "USD"},
        cookies=admin_cookies,
    )
    vendor_id = v_res.json()["id"]

    # 3. Create Employee
    with get_db_context() as db:
        emp = EmployeeDB(
            name="Farah Amin",
            email="farah.amin@voyancehealth.com",
            role="staff",
            dept="Design",
            status="active",
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)
        emp_id = emp.id

    # 4. Record Outflows:
    # Tx A: Vendor spend (1000)
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-02",
            "amount": 1000.0,
            "direction": "out",
            "currency": "USD",
            "payee_type": "vendor",
            "payee_id": vendor_id,
            "description": "Desk chairs",
        },
        cookies=admin_cookies,
    )

    # Tx B: Internal Employee payment (3000)
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-05",
            "amount": 3000.0,
            "direction": "out",
            "currency": "USD",
            "payee_type": "employee",
            "payee_id": emp_id,
            "description": "September Salary Advance",
        },
        cookies=admin_cookies,
    )

    # Tx C: General Ad-hoc (500)
    app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-09-10",
            "amount": 500.0,
            "direction": "out",
            "currency": "USD",
            "payee_type": "none",
            "description": "Courier charge",
        },
        cookies=admin_cookies,
    )

    # 5. Check Transaction Ledger Report:
    # A. With include_internal=true -> returns all 3 transactions
    rep_all = app_client.get(
        f"/api/finance/reports/transactions?account_id={acc_id}&include_internal=true",
        cookies=admin_cookies,
    )
    assert rep_all.status_code == 200
    data_all = rep_all.json()
    assert data_all["count"] == 3
    assert data_all["total_outflows"] == 4500.0

    # B. With include_internal=false -> excludes employee transaction (only 2 remain: 1000 + 500)
    rep_ext = app_client.get(
        f"/api/finance/reports/transactions?account_id={acc_id}&include_internal=false",
        cookies=admin_cookies,
    )
    assert rep_ext.status_code == 200
    data_ext = rep_ext.json()
    assert data_ext["count"] == 2
    assert data_ext["total_outflows"] == 1500.0
    for tx in data_ext["transactions"]:
        assert tx["payee_type"] != "employee"

    # C. Filter specifically by payee_type=employee
    rep_emp = app_client.get(
        f"/api/finance/reports/transactions?account_id={acc_id}&payee_type=employee",
        cookies=admin_cookies,
    )
    assert rep_emp.status_code == 200
    data_emp = rep_emp.json()
    assert data_emp["count"] == 1
    assert data_emp["transactions"][0]["payee_name"] == "Farah Amin"
    assert data_emp["transactions"][0]["amount"] == 3000.0
