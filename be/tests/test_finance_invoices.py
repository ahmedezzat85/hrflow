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


def test_invoice_bank_routing_and_discrepancy(app_client, admin_cookies):
    """Phase 4: Test expected_bank_account_id, revenue_channel, and non-blocking payment discrepancy detection."""
    # 1. Setup customer
    cust_resp = app_client.post(
        "/api/finance/customers",
        json={"name": "Routing Test Customer"},
        cookies=admin_cookies,
    )
    assert cust_resp.status_code == 201
    customer_id = cust_resp.json()["id"]

    # 2. Setup two bank accounts (expected account vs actual account)
    bank_a_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Primary Operating USD",
            "bank_name": "Chase Bank",
            "account_number": "CHASE-1111",
            "currency": "USD",
            "opening_balance": 50000.0,
        },
        cookies=admin_cookies,
    )
    assert bank_a_resp.status_code == 201
    bank_a_id = bank_a_resp.json()["id"]

    bank_b_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Secondary Reserve USD",
            "bank_name": "Citibank",
            "account_number": "CITI-2222",
            "currency": "USD",
            "opening_balance": 10000.0,
        },
        cookies=admin_cookies,
    )
    assert bank_b_resp.status_code == 201
    bank_b_id = bank_b_resp.json()["id"]

    # 3. Invalid channel validation
    bad_chan_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-ROUTING-BAD",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "draft",
            "revenue_channel": "invalid_channel_name",
        },
        cookies=admin_cookies,
    )
    assert bad_chan_resp.status_code == 400
    assert "Invalid revenue_channel" in bad_chan_resp.json()["detail"]

    # 4. Invalid bank account validation (404)
    bad_bank_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-ROUTING-NOBANK",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "draft",
            "expected_bank_account_id": 999999,
        },
        cookies=admin_cookies,
    )
    assert bad_bank_resp.status_code == 404

    # 5. Create invoice with expected bank account and intercompany_transfer_us channel
    inv_payload = {
        "customer_id": customer_id,
        "invoice_number": "INV-ROUTING-001",
        "issue_date": "2026-09-01",
        "due_date": "2026-09-30",
        "status": "sent",
        "currency": "USD",
        "expected_bank_account_id": bank_a_id,
        "revenue_channel": "intercompany_transfer_us",
        "lines": [
            {"description": "US Consulting Services", "quantity": 1.0, "unit_price": 4000.0, "line_total": 4000.0}
        ],
    }
    create_resp = app_client.post("/api/finance/invoices", json=inv_payload, cookies=admin_cookies)
    assert create_resp.status_code == 201
    inv_data = create_resp.json()
    invoice_id = inv_data["id"]
    assert inv_data["expected_bank_account_id"] == bank_a_id
    assert inv_data["expected_bank_account_name"] == "Primary Operating USD"
    assert inv_data["revenue_channel"] == "intercompany_transfer_us"
    assert inv_data["has_bank_discrepancy"] is False

    # 6. Record payment to the matching bank account (bank_a) -> no discrepancy
    pay_a = {
        "direction": "incoming",
        "amount": 2000.0,
        "currency": "USD",
        "payment_date": "2026-09-10",
        "bank_account_id": bank_a_id,
        "method": "bank_transfer",
    }
    pay_a_resp = app_client.post(f"/api/finance/invoices/{invoice_id}/payments", json=pay_a, cookies=admin_cookies)
    assert pay_a_resp.status_code == 201
    pay_a_data = pay_a_resp.json()
    assert pay_a_data["account_discrepancy"] is False
    assert pay_a_data["expected_bank_account_id"] == bank_a_id

    # Verify invoice has no discrepancy
    inv_check = app_client.get(f"/api/finance/invoices/{invoice_id}", cookies=admin_cookies).json()
    assert inv_check["has_bank_discrepancy"] is False

    # 7. Record payment to DIFFERENT bank account (bank_b) -> discrepancy flagged, but succeeds!
    pay_b = {
        "direction": "incoming",
        "amount": 2000.0,
        "currency": "USD",
        "payment_date": "2026-09-12",
        "bank_account_id": bank_b_id,
        "method": "bank_transfer",
    }
    pay_b_resp = app_client.post(f"/api/finance/invoices/{invoice_id}/payments", json=pay_b, cookies=admin_cookies)
    assert pay_b_resp.status_code == 201
    pay_b_data = pay_b_resp.json()
    assert pay_b_data["account_discrepancy"] is True
    assert pay_b_data["bank_account_id"] == bank_b_id
    assert pay_b_data["expected_bank_account_id"] == bank_a_id
    assert pay_b_data["expected_bank_account_name"] == "Primary Operating USD"

    # Verify invoice now flags has_bank_discrepancy == True
    inv_check_2 = app_client.get(f"/api/finance/invoices/{invoice_id}", cookies=admin_cookies).json()
    assert inv_check_2["has_bank_discrepancy"] is True
    assert inv_check_2["status"] == "paid"  # Fully paid 2000 + 2000 = 4000


def test_invoice_work_queue_and_derived_status(app_client, admin_cookies):
    """Phase 3 Story 3.1: Work queue filters, balance derivation, overdue calculation, and next action."""
    # 1. Setup customer and bank account
    cust_resp = app_client.post(
        "/api/finance/customers",
        json={"name": "Queue Test Customer"},
        cookies=admin_cookies,
    )
    customer_id = cust_resp.json()["id"]

    acc_resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Queue USD Bank",
            "bank_name": "Chase Bank",
            "account_number": "CHASE-9999",
            "currency": "USD",
            "opening_balance": 50000.0,
        },
        cookies=admin_cookies,
    )
    account_id = acc_resp.json()["id"]

    # 2. Create a Draft invoice
    draft_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-QUEUE-DRAFT",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "draft",
            "currency": "USD",
            "lines": [{"description": "Draft item", "quantity": 1.0, "unit_price": 1000.0, "line_total": 1000.0}],
        },
        cookies=admin_cookies,
    )
    draft_data = draft_resp.json()
    assert draft_data["status"] == "draft"
    assert draft_data["balance"] == 1000.0
    assert draft_data["amount_paid"] == 0.0
    assert draft_data["payment_status"] == "unpaid"
    assert "Send" in draft_data["next_action"]

    # 3. Create an Overdue invoice (due_date in past, status='sent')
    overdue_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-QUEUE-OVERDUE",
            "issue_date": "2026-08-01",
            "due_date": "2026-08-15",
            "status": "sent",
            "currency": "USD",
            "lines": [{"description": "Overdue item", "quantity": 1.0, "unit_price": 2500.0, "line_total": 2500.0}],
        },
        cookies=admin_cookies,
    )
    overdue_data = overdue_resp.json()
    assert overdue_data["is_overdue"] is True
    assert overdue_data["status"] == "overdue"
    assert overdue_data["days_overdue"] > 0
    assert overdue_data["balance"] == 2500.0
    assert "overdue" in overdue_data["next_action"].lower()

    # 4. Create a Paid invoice
    paid_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-QUEUE-PAID",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "sent",
            "currency": "USD",
            "lines": [{"description": "Paid item", "quantity": 1.0, "unit_price": 3000.0, "line_total": 3000.0}],
        },
        cookies=admin_cookies,
    )
    paid_id = paid_resp.json()["id"]
    # Pay in full
    app_client.post(
        f"/api/finance/invoices/{paid_id}/payments",
        json={
            "direction": "incoming",
            "amount": 3000.0,
            "currency": "USD",
            "payment_date": "2026-09-05",
            "bank_account_id": account_id,
        },
        cookies=admin_cookies,
    )
    paid_data = app_client.get(f"/api/finance/invoices/{paid_id}", cookies=admin_cookies).json()
    assert paid_data["status"] == "paid"
    assert paid_data["balance"] == 0.0
    assert paid_data["amount_paid"] == 3000.0
    assert paid_data["payment_status"] == "paid"

    # 5. Create a Void invoice
    void_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-QUEUE-VOID",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "draft",
            "lines": [],
        },
        cookies=admin_cookies,
    )
    void_id = void_resp.json()["id"]
    app_client.delete(f"/api/finance/invoices/{void_id}", cookies=admin_cookies)

    # 6. Test default 'open' filter: excludes Paid and Void
    open_list = app_client.get("/api/finance/invoices?status=open", cookies=admin_cookies).json()
    open_numbers = [inv["invoice_number"] for inv in open_list]
    assert "INV-QUEUE-DRAFT" in open_numbers
    assert "INV-QUEUE-OVERDUE" in open_numbers
    assert "INV-QUEUE-PAID" not in open_numbers
    assert "INV-QUEUE-VOID" not in open_numbers

    # 7. Test status=paid filter
    paid_list = app_client.get("/api/finance/invoices?status=paid", cookies=admin_cookies).json()
    paid_numbers = [inv["invoice_number"] for inv in paid_list]
    assert "INV-QUEUE-PAID" in paid_numbers
    assert "INV-QUEUE-DRAFT" not in paid_numbers

    # 8. Test status=overdue filter
    od_list = app_client.get("/api/finance/invoices?status=overdue", cookies=admin_cookies).json()
    od_numbers = [inv["invoice_number"] for inv in od_list]
    assert "INV-QUEUE-OVERDUE" in od_numbers
    assert "INV-QUEUE-DRAFT" not in od_numbers


def test_invoice_editor_lifecycle_and_validation(app_client, admin_cookies):
    """
    Story 3.2 validations:
    - Creator cannot manually set status to 'paid' or 'overdue' on create/update.
    - Due date cannot precede issue date.
    - Invoice number is immutable once issued (sent/paid).
    - Line items cannot be modified on paid or void invoices.
    - POST /{invoice_id}/send transitions a draft invoice to 'sent'.
    """
    # 1. Customer setup
    cust_resp = app_client.post(
        "/api/finance/customers",
        json={"name": "Lifecycle Customer"},
        cookies=admin_cookies,
    )
    customer_id = cust_resp.json()["id"]

    # 2. Rejection of manual status='paid' or 'overdue' on create
    bad_paid = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-LIFE-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "paid",
            "lines": [],
        },
        cookies=admin_cookies,
    )
    assert bad_paid.status_code == 400
    assert "Cannot manually set status to 'paid'" in bad_paid.json()["detail"]

    bad_overdue = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-LIFE-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "overdue",
            "lines": [],
        },
        cookies=admin_cookies,
    )
    assert bad_overdue.status_code == 400
    assert "Cannot manually set status to 'overdue'" in bad_overdue.json()["detail"]

    # 3. Due date precedes issue date rejection on create
    bad_date = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-LIFE-001",
            "issue_date": "2026-09-30",
            "due_date": "2026-09-01",
            "status": "draft",
            "lines": [],
        },
        cookies=admin_cookies,
    )
    assert bad_date.status_code == 400
    assert "Due date cannot precede issue date" in bad_date.json()["detail"]

    # 4. Create valid draft invoice
    draft_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": "INV-LIFE-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "draft",
            "lines": [{"description": "Initial service", "quantity": 1.0, "unit_price": 1000.0, "line_total": 1000.0}],
        },
        cookies=admin_cookies,
    )
    assert draft_resp.status_code == 201
    inv_id = draft_resp.json()["id"]

    # 5. Reject manual status='paid' on update
    up_bad_paid = app_client.put(
        f"/api/finance/invoices/{inv_id}",
        json={"status": "paid"},
        cookies=admin_cookies,
    )
    assert up_bad_paid.status_code == 400

    # 6. Reject invalid due date on update
    up_bad_date = app_client.put(
        f"/api/finance/invoices/{inv_id}",
        json={"due_date": "2026-08-01"},
        cookies=admin_cookies,
    )
    assert up_bad_date.status_code == 400

    # 7. Draft invoice number CAN be edited before issue
    up_num = app_client.put(
        f"/api/finance/invoices/{inv_id}",
        json={"invoice_number": "INV-LIFE-001-REV"},
        cookies=admin_cookies,
    )
    assert up_num.status_code == 200
    assert up_num.json()["invoice_number"] == "INV-LIFE-001-REV"

    # 8. Send invoice via POST /{invoice_id}/send
    send_resp = app_client.post(
        f"/api/finance/invoices/{inv_id}/send",
        cookies=admin_cookies,
    )
    assert send_resp.status_code == 200
    assert send_resp.json()["status"] == "sent"

    # 9. Invoice number is now IMMUTABLE
    imm_resp = app_client.put(
        f"/api/finance/invoices/{inv_id}",
        json={"invoice_number": "INV-LIFE-002"},
        cookies=admin_cookies,
    )
    assert imm_resp.status_code == 400
    assert "immutable once issued" in imm_resp.json()["detail"]

    # 10. Void invoice and verify line modification rejection
    app_client.delete(f"/api/finance/invoices/{inv_id}", cookies=admin_cookies)
    void_line_resp = app_client.put(
        f"/api/finance/invoices/{inv_id}",
        json={"lines": [{"description": "New", "quantity": 1.0, "unit_price": 500.0, "line_total": 500.0}]},
        cookies=admin_cookies,
    )
    assert void_line_resp.status_code == 400


def test_collections_and_payment_recording(app_client, admin_cookies):
    """
    Story 3.3 validations:
    - Partial payment updates balance and payment state atomically.
    - Overpayment is prevented by default.
    - Duplicate payment references trigger rejection.
    - Reversing a payment restores the correct outstanding balance and status.
    - Reminder actions explain missing/invalid email address blocking issue.
    """
    # 1. Customer with NO email
    no_email_cust = app_client.post(
        "/api/finance/customers",
        json={"name": "No Email Customer", "contact_email": ""},
        cookies=admin_cookies,
    ).json()

    # 2. Customer with valid email
    email_cust = app_client.post(
        "/api/finance/customers",
        json={"name": "Remind Customer", "contact_email": "billing@remindcorp.test"},
        cookies=admin_cookies,
    ).json()

    # 3. Bank Account
    bank = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Collections Checking",
            "bank_name": "Test Bank",
            "account_number": "COL-987654321",
            "currency": "USD",
            "opening_balance": 50000.0,
        },
        cookies=admin_cookies,
    ).json()
    bank_id = bank["id"]

    # 4. Create an invoice for $1,000 for no-email customer
    inv_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": no_email_cust["id"],
            "invoice_number": "INV-COL-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-10",
            "status": "sent",
            "currency": "USD",
            "lines": [{"description": "Service A", "quantity": 1.0, "unit_price": 1000.0, "line_total": 1000.0}],
        },
        cookies=admin_cookies,
    )
    assert inv_resp.status_code == 201
    inv_id = inv_resp.json()["id"]

    # 5. Reminder fails with blocking explanation if customer has no email
    remind_fail = app_client.post(f"/api/finance/invoices/{inv_id}/remind", cookies=admin_cookies)
    assert remind_fail.status_code == 400
    assert "no contact email address on file" in remind_fail.json()["detail"]

    # 6. Record partial payment of $400
    pay1 = app_client.post(
        f"/api/finance/invoices/{inv_id}/payments",
        json={
            "direction": "incoming",
            "amount": 400.0,
            "currency": "USD",
            "payment_date": "2026-09-05",
            "bank_account_id": bank_id,
            "reference": "CHK-COL-001",
        },
        cookies=admin_cookies,
    )
    assert pay1.status_code == 201
    pay1_id = pay1.json()["id"]

    # Verify atomic update of balance and status
    inv_after_pay1 = app_client.get(f"/api/finance/invoices/{inv_id}", cookies=admin_cookies).json()
    assert inv_after_pay1["amount_paid"] == 400.0
    assert inv_after_pay1["balance"] == 600.0
    assert inv_after_pay1["payment_status"] == "partially_paid"
    assert inv_after_pay1["status"] in ("sent", "overdue")

    # 7. Overpayment prevention: trying to pay $700 when balance is $600
    overpay = app_client.post(
        f"/api/finance/invoices/{inv_id}/payments",
        json={
            "direction": "incoming",
            "amount": 700.0,
            "currency": "USD",
            "payment_date": "2026-09-06",
            "bank_account_id": bank_id,
            "reference": "CHK-OVERPAY",
        },
        cookies=admin_cookies,
    )
    assert overpay.status_code == 400
    assert "exceeds remaining balance" in overpay.json()["detail"]

    # 8. Duplicate reference check: trying to reuse "CHK-COL-001"
    dup_ref = app_client.post(
        f"/api/finance/invoices/{inv_id}/payments",
        json={
            "direction": "incoming",
            "amount": 200.0,
            "currency": "USD",
            "payment_date": "2026-09-06",
            "bank_account_id": bank_id,
            "reference": "CHK-COL-001",
        },
        cookies=admin_cookies,
    )
    assert dup_ref.status_code == 400
    assert "Duplicate payment reference" in dup_ref.json()["detail"]

    # 9. Complete payment: pay remaining $600 with new reference
    pay2 = app_client.post(
        f"/api/finance/invoices/{inv_id}/payments",
        json={
            "direction": "incoming",
            "amount": 600.0,
            "currency": "USD",
            "payment_date": "2026-09-07",
            "bank_account_id": bank_id,
            "reference": "CHK-COL-002",
        },
        cookies=admin_cookies,
    )
    assert pay2.status_code == 201
    pay2_id = pay2.json()["id"]

    inv_paid = app_client.get(f"/api/finance/invoices/{inv_id}", cookies=admin_cookies).json()
    assert inv_paid["balance"] == 0.0
    assert inv_paid["amount_paid"] == 1000.0
    assert inv_paid["payment_status"] == "paid"

    # 10. Reverse the $600 payment: verify balance and status restored
    rev_resp = app_client.post(
        f"/api/finance/invoices/{inv_id}/payments/{pay2_id}/reverse?reason=Bounced%20cheque",
        cookies=admin_cookies,
    )
    assert rev_resp.status_code == 200
    assert rev_resp.json()["is_reversed"] is True

    inv_after_rev = app_client.get(f"/api/finance/invoices/{inv_id}", cookies=admin_cookies).json()
    assert inv_after_rev["amount_paid"] == 400.0
    assert inv_after_rev["balance"] == 600.0
    assert inv_after_rev["payment_status"] == "partially_paid"

    # Cannot reverse the same payment twice
    rev_again = app_client.post(
        f"/api/finance/invoices/{inv_id}/payments/{pay2_id}/reverse",
        cookies=admin_cookies,
    )
    assert rev_again.status_code == 400

    # 11. Create invoice with customer who HAS an email and verify reminder dispatch
    email_inv = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": email_cust["id"],
            "invoice_number": "INV-COL-REMIND",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-05",
            "status": "sent",
            "currency": "USD",
            "lines": [{"description": "Service B", "quantity": 1.0, "unit_price": 500.0, "line_total": 500.0}],
        },
        cookies=admin_cookies,
    ).json()

    remind_ok = app_client.post(f"/api/finance/invoices/{email_inv['id']}/remind", cookies=admin_cookies)
    assert remind_ok.status_code == 200
    assert remind_ok.json()["success"] is True
    assert remind_ok.json()["recipient"] == "billing@remindcorp.test"



