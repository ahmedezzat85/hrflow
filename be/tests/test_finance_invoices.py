"""
be/tests/test_finance_invoices.py
Tests for Phase 4.3: Sales Invoice CRUD + Payment recording.
"""
import pytest


def test_invoice_crud_and_validation(app_client, admin_cookies):
    """Admin can perform full lifecycle: create, get, update, void. Validates duplicate number rejection."""

    # ── Pre-conditions: ensure a customer exists ──────────────────────
    cust_resp = app_client.post(
        "/api/finance/customers",
        json={"name": "InvoiceTest Customer"},
        cookies=admin_cookies,
    )
    assert cust_resp.status_code == 201
    customer_id = cust_resp.json()["id"]

    # 1. List initially
    list_resp = app_client.get("/api/finance/invoices", cookies=admin_cookies)
    assert list_resp.status_code == 200
    initial_count = len(list_resp.json())

    # 2. Create invoice with lines
    create_payload = {
        "customer_id": customer_id,
        "invoice_number": "INV-TEST-0001",
        "issue_date": "2026-09-01",
        "due_date": "2026-09-30",
        "status": "draft",
        "currency": "USD",
        "notes": "Phase 4.3 test invoice",
        "lines": [
            {"description": "PACS Integration", "quantity": 1.0, "unit_price": 5000.0, "line_total": 5000.0},
            {"description": "Support Retainer", "quantity": 3.0, "unit_price": 1000.0, "line_total": 3000.0},
        ],
    }
    create_resp = app_client.post("/api/finance/invoices", json=create_payload, cookies=admin_cookies)
    assert create_resp.status_code == 201
    invoice = create_resp.json()
    assert invoice["invoice_number"] == "INV-TEST-0001"
    assert invoice["subtotal"] == 8000.0
    assert invoice["total"] == 8000.0
    assert len(invoice["lines"]) == 2
    assert invoice["customer_name"] == "InvoiceTest Customer"
    invoice_id = invoice["id"]

    # 3. Duplicate invoice number rejection
    dup_resp = app_client.post("/api/finance/invoices", json=create_payload, cookies=admin_cookies)
    assert dup_resp.status_code == 400
    assert "already in use" in dup_resp.json()["detail"]

    # 4. Invalid status rejection
    bad_status_payload = {**create_payload, "invoice_number": "INV-TEST-BADSTATUS", "status": "invalid_status"}
    bad_resp = app_client.post("/api/finance/invoices", json=bad_status_payload, cookies=admin_cookies)
    assert bad_resp.status_code == 400

    # 5. Get by ID
    get_resp = app_client.get(f"/api/finance/invoices/{invoice_id}", cookies=admin_cookies)
    assert get_resp.status_code == 200
    assert get_resp.json()["invoice_number"] == "INV-TEST-0001"

    # 6. Update — change status to 'sent' and replace lines
    update_payload = {
        "status": "sent",
        "notes": "Updated notes",
        "lines": [
            {"description": "New Line Item", "quantity": 2.0, "unit_price": 2500.0, "line_total": 5000.0},
        ],
    }
    put_resp = app_client.put(f"/api/finance/invoices/{invoice_id}", json=update_payload, cookies=admin_cookies)
    assert put_resp.status_code == 200
    updated = put_resp.json()
    assert updated["status"] == "sent"
    assert updated["subtotal"] == 5000.0
    assert len(updated["lines"]) == 1

    # 7. Filter by status
    status_resp = app_client.get("/api/finance/invoices?status=sent", cookies=admin_cookies)
    assert status_resp.status_code == 200
    sent_ids = [inv["id"] for inv in status_resp.json()]
    assert invoice_id in sent_ids

    # 8. Filter by customer
    cust_filter_resp = app_client.get(f"/api/finance/invoices?customer_id={customer_id}", cookies=admin_cookies)
    assert cust_filter_resp.status_code == 200
    assert any(inv["id"] == invoice_id for inv in cust_filter_resp.json())

    # 9. Search by invoice number
    search_resp = app_client.get("/api/finance/invoices?search=INV-TEST-0001", cookies=admin_cookies)
    assert search_resp.status_code == 200
    assert any(inv["id"] == invoice_id for inv in search_resp.json())

    # 10. Void invoice
    void_resp = app_client.delete(f"/api/finance/invoices/{invoice_id}", cookies=admin_cookies)
    assert void_resp.status_code == 200
    assert void_resp.json()["status"] == "void"

    # 11. Cannot update a voided invoice
    update_voided_resp = app_client.put(
        f"/api/finance/invoices/{invoice_id}", json={"notes": "should fail"}, cookies=admin_cookies
    )
    assert update_voided_resp.status_code == 400

    # 12. Cannot void again
    re_void_resp = app_client.delete(f"/api/finance/invoices/{invoice_id}", cookies=admin_cookies)
    assert re_void_resp.status_code == 400

    # 13. Total invoice count increased by 1 (the one we created; bad-status attempt didn't persist)
    final_list_resp = app_client.get("/api/finance/invoices", cookies=admin_cookies)
    assert len(final_list_resp.json()) == initial_count + 1


def test_invoice_payment_recording(app_client, admin_cookies):
    """Record an incoming payment against an invoice; verify balance update and auto-mark-as-paid."""

    # ── Setup: customer ────────────────────────────────────────────────
    cust_resp = app_client.post(
        "/api/finance/customers",
        json={"name": "Payment Test Customer"},
        cookies=admin_cookies,
    )
    assert cust_resp.status_code == 201
    customer_id = cust_resp.json()["id"]

    # ── Setup: bank account ────────────────────────────────────────────
    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Invoice Payment Account",
            "bank_name": "Test Bank",
            "account_number": "123456789",
            "currency": "USD",
            "opening_balance": 100000.0,
        },
        cookies=admin_cookies,
    )
    assert acc_resp.status_code == 201
    account_id = acc_resp.json()["id"]
    initial_balance = acc_resp.json()["current_balance"]

    # ── Setup: invoice ─────────────────────────────────────────────────
    inv_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-PAY-TEST-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "sent",
            "currency": "USD",
            "lines": [
                {"description": "Service fee", "quantity": 1.0, "unit_price": 2000.0, "line_total": 2000.0}
            ],
        },
        cookies=admin_cookies,
    )
    assert inv_resp.status_code == 201
    invoice = inv_resp.json()
    invoice_id = invoice["id"]
    assert invoice["total"] == 2000.0
    assert invoice["status"] == "sent"

    # 1. List payments (none yet)
    payments_resp = app_client.get(f"/api/finance/invoices/{invoice_id}/payments", cookies=admin_cookies)
    assert payments_resp.status_code == 200
    assert payments_resp.json() == []

    # 2. Partial payment
    partial_payment = {
        "direction": "incoming",
        "amount": 1000.0,
        "currency": "USD",
        "payment_date": "2026-09-15",
        "bank_account_id": account_id,
        "method": "bank_transfer",
        "reference": "WIRE-2026-0915-A",
    }
    pay_resp = app_client.post(f"/api/finance/invoices/{invoice_id}/payments", json=partial_payment, cookies=admin_cookies)
    assert pay_resp.status_code == 201
    payment = pay_resp.json()
    assert payment["amount"] == 1000.0
    assert payment["direction"] == "incoming"
    assert payment["related_invoice_id"] == invoice_id

    # 3. Invoice still 'sent' (not fully paid)
    inv_check = app_client.get(f"/api/finance/invoices/{invoice_id}", cookies=admin_cookies)
    assert inv_check.json()["status"] == "sent"

    # 4. Bank balance increased by 1000
    acc_check = app_client.get(f"/api/finance/accounts/{account_id}", cookies=admin_cookies)
    assert acc_check.status_code == 200
    assert abs(acc_check.json()["current_balance"] - (initial_balance + 1000.0)) < 0.01

    # 5. Final full payment → auto-marks invoice as paid
    final_payment = {**partial_payment, "amount": 1000.0, "reference": "WIRE-2026-0930-B"}
    final_pay_resp = app_client.post(f"/api/finance/invoices/{invoice_id}/payments", json=final_payment, cookies=admin_cookies)
    assert final_pay_resp.status_code == 201

    # 6. Invoice is now 'paid'
    inv_paid = app_client.get(f"/api/finance/invoices/{invoice_id}", cookies=admin_cookies)
    assert inv_paid.json()["status"] == "paid"

    # 7. Both payments listed
    all_payments = app_client.get(f"/api/finance/invoices/{invoice_id}/payments", cookies=admin_cookies)
    assert len(all_payments.json()) == 2

    # 8. Outgoing direction rejected for invoice payments
    bad_direction_payload = {**partial_payment, "direction": "outgoing"}
    bad_dir_resp = app_client.post(f"/api/finance/invoices/{invoice_id}/payments", json=bad_direction_payload, cookies=admin_cookies)
    assert bad_dir_resp.status_code == 400

    # 9. Cannot pay against a voided invoice
    void_inv_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-VOID-TEST-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "draft",
            "lines": [],
        },
        cookies=admin_cookies,
    )
    void_inv_id = void_inv_resp.json()["id"]
    app_client.delete(f"/api/finance/invoices/{void_inv_id}", cookies=admin_cookies)
    voided_pay = app_client.post(
        f"/api/finance/invoices/{void_inv_id}/payments",
        json=partial_payment,
        cookies=admin_cookies,
    )
    assert voided_pay.status_code == 400


def test_invoice_rbac_employee_cannot_access(app_client, employee_cookies):
    """Employee role cannot access any invoice endpoint (finance.invoice.read is not in employee permissions)."""
    resp = app_client.get("/api/finance/invoices", cookies=employee_cookies)
    assert resp.status_code == 403
