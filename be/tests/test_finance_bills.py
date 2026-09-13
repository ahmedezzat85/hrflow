"""
be/tests/test_finance_bills.py
Tests for Phase 4.4: Vendor Bill CRUD + Payment recording (Accounts Payable).
Mirrors be/tests/test_finance_invoices.py structure.
"""
import pytest


def test_bill_crud_and_validation(app_client, admin_cookies):
    """Admin can perform full lifecycle: create, get, update, void. Validates duplicate number rejection."""

    # ── Pre-conditions: ensure a vendor exists ─────────────────────
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "BillTest Vendor", "category": "Infrastructure"},
        cookies=admin_cookies,
    )
    assert vend_resp.status_code == 201
    vendor_id = vend_resp.json()["id"]

    # 1. List initially
    list_resp = app_client.get("/api/finance/bills", cookies=admin_cookies)
    assert list_resp.status_code == 200
    initial_count = len(list_resp.json())

    # 2. Create bill with lines
    create_payload = {
        "vendor_id": vendor_id,
        "bill_number": "BILL-TEST-0001",
        "category": "Infrastructure",
        "issue_date": "2026-09-01",
        "due_date": "2026-09-30",
        "status": "unpaid",
        "currency": "USD",
        "notes": "Phase 4.4 test bill",
        "lines": [
            {"description": "Cloud Hosting", "quantity": 1.0, "unit_price": 3000.0, "line_total": 3000.0},
            {"description": "Support Plan", "quantity": 2.0, "unit_price": 500.0, "line_total": 1000.0},
        ],
    }
    create_resp = app_client.post("/api/finance/bills", json=create_payload, cookies=admin_cookies)
    assert create_resp.status_code == 201
    bill = create_resp.json()
    assert bill["bill_number"] == "BILL-TEST-0001"
    assert bill["subtotal"] == 4000.0
    assert bill["total"] == 4000.0
    assert len(bill["lines"]) == 2
    assert bill["vendor_name"] == "BillTest Vendor"
    bill_id = bill["id"]

    # 3. Duplicate bill number rejection
    dup_resp = app_client.post("/api/finance/bills", json=create_payload, cookies=admin_cookies)
    assert dup_resp.status_code == 400
    assert "already in use" in dup_resp.json()["detail"]

    # 4. Invalid status rejection
    bad_status_payload = {**create_payload, "bill_number": "BILL-TEST-BADSTATUS", "status": "invalid_status"}
    bad_resp = app_client.post("/api/finance/bills", json=bad_status_payload, cookies=admin_cookies)
    assert bad_resp.status_code == 400

    # 5. Get by ID
    get_resp = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies)
    assert get_resp.status_code == 200
    assert get_resp.json()["bill_number"] == "BILL-TEST-0001"

    # 6. Update — change status and replace lines
    update_payload = {
        "status": "overdue",
        "notes": "Updated notes",
        "lines": [
            {"description": "New Line Item", "quantity": 2.0, "unit_price": 1500.0, "line_total": 3000.0},
        ],
    }
    put_resp = app_client.put(f"/api/finance/bills/{bill_id}", json=update_payload, cookies=admin_cookies)
    assert put_resp.status_code == 200
    updated = put_resp.json()
    assert updated["status"] == "overdue"
    assert updated["subtotal"] == 3000.0
    assert len(updated["lines"]) == 1

    # 7. Filter by status
    status_resp = app_client.get("/api/finance/bills?status=overdue", cookies=admin_cookies)
    assert status_resp.status_code == 200
    overdue_ids = [b["id"] for b in status_resp.json()]
    assert bill_id in overdue_ids

    # 8. Filter by vendor
    vend_filter_resp = app_client.get(f"/api/finance/bills?vendor_id={vendor_id}", cookies=admin_cookies)
    assert vend_filter_resp.status_code == 200
    assert any(b["id"] == bill_id for b in vend_filter_resp.json())

    # 9. Search by bill number
    search_resp = app_client.get("/api/finance/bills?search=BILL-TEST-0001", cookies=admin_cookies)
    assert search_resp.status_code == 200
    assert any(b["id"] == bill_id for b in search_resp.json())

    # 10. Void bill
    void_resp = app_client.delete(f"/api/finance/bills/{bill_id}", cookies=admin_cookies)
    assert void_resp.status_code == 200
    assert void_resp.json()["status"] == "void"

    # 11. Cannot update a voided bill
    update_voided_resp = app_client.put(
        f"/api/finance/bills/{bill_id}", json={"notes": "should fail"}, cookies=admin_cookies
    )
    assert update_voided_resp.status_code == 400

    # 12. Cannot void again
    re_void_resp = app_client.delete(f"/api/finance/bills/{bill_id}", cookies=admin_cookies)
    assert re_void_resp.status_code == 400

    # 13. Total bill count increased by 1
    final_list_resp = app_client.get("/api/finance/bills", cookies=admin_cookies)
    assert len(final_list_resp.json()) == initial_count + 1


def test_bill_payment_recording(app_client, admin_cookies):
    """Record an outgoing payment against a bill; verify balance update and auto-mark-as-paid."""

    # ── Setup: vendor ──────────────────────────────────────────
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Bill Payment Test Vendor"},
        cookies=admin_cookies,
    )
    assert vend_resp.status_code == 201
    vendor_id = vend_resp.json()["id"]

    # ── Setup: bank account ────────────────────────────────────────
    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Bill Payment Account",
            "bank_name": "Test Bank",
            "account_number": "987654321",
            "currency": "USD",
            "opening_balance": 100000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_resp.status_code == 201
    account_id = acc_resp.json()["id"]
    initial_balance = acc_resp.json()["current_balance"]

    # ── Setup: bill ──────────────────────────────────────────────
    bill_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "BILL-PAY-TEST-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "unpaid",
            "currency": "USD",
            "lines": [
                {"description": "Hosting fee", "quantity": 1.0, "unit_price": 1500.0, "line_total": 1500.0}
            ],
        },
        cookies=admin_cookies,
    )
    assert bill_resp.status_code == 201
    bill = bill_resp.json()
    bill_id = bill["id"]
    assert bill["total"] == 1500.0
    assert bill["status"] == "unpaid"

    # 1. List payments (none yet)
    payments_resp = app_client.get(f"/api/finance/bills/{bill_id}/payments", cookies=admin_cookies)
    assert payments_resp.status_code == 200
    assert payments_resp.json() == []

    # 2. Partial payment
    partial_payment = {
        "direction": "outgoing",
        "amount": 500.0,
        "currency": "USD",
        "payment_date": "2026-09-15",
        "bank_account_id": account_id,
        "method": "bank_transfer",
        "reference": "WIRE-2026-0915-B",
    }
    pay_resp = app_client.post(f"/api/finance/bills/{bill_id}/payments", json=partial_payment, cookies=admin_cookies)
    assert pay_resp.status_code == 201
    payment = pay_resp.json()
    assert payment["amount"] == 500.0
    assert payment["direction"] == "outgoing"
    assert payment["related_bill_id"] == bill_id

    # 3. Bill still 'unpaid' (not fully paid)
    bill_check = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies)
    assert bill_check.json()["status"] == "unpaid"

    # 4. Bank balance decreased by 500
    acc_check = app_client.get(f"/api/finance/accounts/{account_id}", cookies=admin_cookies)
    assert acc_check.status_code == 200
    assert abs(acc_check.json()["current_balance"] - (initial_balance - 500.0)) < 0.01

    # 5. Final full payment → auto-marks bill as paid
    final_payment = {**partial_payment, "amount": 1000.0, "reference": "WIRE-2026-0930-C"}
    final_pay_resp = app_client.post(f"/api/finance/bills/{bill_id}/payments", json=final_payment, cookies=admin_cookies)
    assert final_pay_resp.status_code == 201

    # 6. Bill is now 'paid'
    bill_paid = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies)
    assert bill_paid.json()["status"] == "paid"

    # 7. Both payments listed
    all_payments = app_client.get(f"/api/finance/bills/{bill_id}/payments", cookies=admin_cookies)
    assert len(all_payments.json()) == 2

    # 8. Incoming direction rejected for bill payments
    bad_direction_payload = {**partial_payment, "direction": "incoming"}
    bad_dir_resp = app_client.post(f"/api/finance/bills/{bill_id}/payments", json=bad_direction_payload, cookies=admin_cookies)
    assert bad_dir_resp.status_code == 400

    # 9. Cannot void a paid bill
    void_paid_resp = app_client.delete(f"/api/finance/bills/{bill_id}", cookies=admin_cookies)
    assert void_paid_resp.status_code == 400

    # 10. Cannot pay against a voided bill
    void_bill_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "BILL-VOID-TEST-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "unpaid",
            "lines": [],
        },
        cookies=admin_cookies,
    )
    void_bill_id = void_bill_resp.json()["id"]
    app_client.delete(f"/api/finance/bills/{void_bill_id}", cookies=admin_cookies)
    voided_pay = app_client.post(
        f"/api/finance/bills/{void_bill_id}/payments",
        json=partial_payment,
        cookies=admin_cookies,
    )
    assert voided_pay.status_code == 400


def test_bill_rbac_employee_cannot_access(app_client, employee_cookies):
    """Employee role cannot access any bill endpoint (finance.bill.read is not in employee permissions)."""
    resp = app_client.get("/api/finance/bills", cookies=employee_cookies)
    assert resp.status_code == 403
