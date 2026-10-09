"""
be/tests/test_finance_bills_approval.py
Tests for Story 4.2: Bill approval and payment.
Verifies:
 - AC 1: A bill cannot be scheduled or paid before it is approved (B1 status model).
 - AC 2: Unauthorized or over-limit approvals are rejected server-side (self-approval segregation & limits).
 - AC 3: Payment cannot exceed remaining balance.
 - AC 4: Payment and reversal update bill and ledger atomically.
"""
import pytest

from bill_test_helpers import create_approved


def test_bill_approval_required_before_payable(app_client, admin_cookies):
    vend = app_client.post(
        "/api/finance/vendors",
        json={"name": "Approval Vendor LLC", "category": "Legal"},
        cookies=admin_cookies,
    ).json()
    vendor_id = vend["id"]

    b_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "APP-2026-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "lines": [{"description": "Legal Retainer", "quantity": 1, "unit_price": 2500, "line_total": 2500}],
        },
        cookies=admin_cookies,
    )
    assert b_resp.status_code == 201
    bill_id = b_resp.json()["id"]
    assert b_resp.json()["status"] == "draft"

    # A status can never be forced through update
    up_resp = app_client.put(f"/api/finance/bills/{bill_id}", json={"status": "approved"}, cookies=admin_cookies)
    assert up_resp.status_code == 422

    # Scheduling a bill that is not approved fails with 409
    sch_resp = app_client.post(
        f"/api/finance/bills/{bill_id}/schedule",
        json={"scheduled_payment_date": "2026-09-25"},
        cookies=admin_cookies,
    )
    assert sch_resp.status_code == 409
    assert sch_resp.json()["detail"]["current_status"] == "draft"

    # Submitted but not yet approved is still not schedulable
    app_client.post(f"/api/finance/bills/{bill_id}/submit", cookies=admin_cookies)
    sch2 = app_client.post(
        f"/api/finance/bills/{bill_id}/schedule",
        json={"scheduled_payment_date": "2026-09-25"},
        cookies=admin_cookies,
    )
    assert sch2.status_code == 409
    assert sch2.json()["detail"]["current_status"] == "pending_approval"


def test_bill_approval_policies_and_segregation(app_client, admin_cookies):
    vend = app_client.post(
        "/api/finance/vendors",
        json={"name": "Cloud Matrix Solutions", "category": "Infrastructure"},
        cookies=admin_cookies,
    ).json()
    vendor_id = vend["id"]

    # Create a bill where created_by is set to "creator@hrflow.test"
    b_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "APP-2026-002",
            "issue_date": "2026-09-05",
            "due_date": "2026-10-05",
            "created_by": "admin@hrflow.test",  # same as admin_cookies user
            "lines": [{"description": "High Performance Compute", "quantity": 1, "unit_price": 6000, "line_total": 6000}],
        },
        cookies=admin_cookies,
    )
    assert b_resp.status_code == 201
    bill_id = b_resp.json()["id"]
    assert app_client.post(f"/api/finance/bills/{bill_id}/submit", cookies=admin_cookies).status_code == 200

    # AC 2: Self-approval is rejected server-side
    self_app = app_client.post(
        f"/api/finance/bills/{bill_id}/approve",
        json={"decision": "approve", "comment": "Self approving my bill"},
        cookies=admin_cookies,
    )
    assert self_app.status_code == 400
    assert "self-approval" in self_app.json()["detail"].lower()

    # Update bill creator to a different employee so approver can test limit
    app_client.put(
        f"/api/finance/bills/{bill_id}",
        json={"created_by": "developer@hrflow.test"},
        cookies=admin_cookies,
    )

    # AC 2: Over-limit approvals are rejected server-side (e.g. limit $5,000 for a $6,000 bill)
    over_limit = app_client.post(
        f"/api/finance/bills/{bill_id}/approve",
        json={"decision": "approve", "comment": "Approved by manager", "approver_limit": 5000.0},
        cookies=admin_cookies,
    )
    assert over_limit.status_code == 400
    assert "limit" in over_limit.json()["detail"].lower()

    # Valid approval with sufficient authority limit ($10,000 limit for a $6,000 bill)
    valid_app = app_client.post(
        f"/api/finance/bills/{bill_id}/approve",
        json={"decision": "approve", "comment": "Reviewed and approved by VP", "approver_limit": 10000.0},
        cookies=admin_cookies,
    )
    assert valid_app.status_code == 200
    approved_bill = valid_app.json()
    assert approved_bill["status"] == "approved"
    assert approved_bill["approval_status"] == "approved"
    assert approved_bill["approved_by"] == "admin@hrflow.test"
    assert approved_bill["approval_comment"] == "Reviewed and approved by VP"

    # Scheduling is now allowed for approved bill
    sch_ok = app_client.post(
        f"/api/finance/bills/{bill_id}/schedule",
        json={"scheduled_payment_date": "2026-09-28"},
        cookies=admin_cookies,
    )
    assert sch_ok.status_code == 200
    assert sch_ok.json()["status"] == "scheduled"
    assert sch_ok.json()["scheduled_payment_date"] == "2026-09-28"


def test_bill_rejection_policy(app_client, admin_cookies):
    vend = app_client.post(
        "/api/finance/vendors",
        json={"name": "Office Supplies Ltd", "category": "Supplies"},
        cookies=admin_cookies,
    ).json()

    b_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vend["id"],
            "bill_number": "APP-2026-003",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-15",
            "created_by": "staff@hrflow.test",
            "lines": [{"description": "Ergonomic Chairs", "quantity": 5, "unit_price": 400, "line_total": 2000}],
        },
        cookies=admin_cookies,
    )
    bill_id = b_resp.json()["id"]
    app_client.post(f"/api/finance/bills/{bill_id}/submit", cookies=admin_cookies)

    # Rejection without reason fails
    no_reason = app_client.post(
        f"/api/finance/bills/{bill_id}/approve",
        json={"decision": "reject", "comment": ""},
        cookies=admin_cookies,
    )
    assert no_reason.status_code == 400

    # Rejection with reason succeeds and sets status to rejected
    rej_ok = app_client.post(
        f"/api/finance/bills/{bill_id}/approve",
        json={"decision": "reject", "comment": "Chair purchase exceeded departmental Q3 budget allotment."},
        cookies=admin_cookies,
    )
    assert rej_ok.status_code == 200
    rejected_bill = rej_ok.json()
    assert rejected_bill["status"] == "rejected"
    assert rejected_bill["approval_status"] == "rejected"
    assert "budget allotment" in rejected_bill["approval_comment"]


def test_bill_partial_payment_overpayment_and_atomic_reversal(app_client, admin_cookies):
    # Setup bank account
    acc = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Test AP Disbursement Account",
            "bank_name": "Chase Bank",
            "account_number": "12345678904491",
            "currency": "USD",
            "opening_balance": 50000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    ).json()
    account_id = acc["id"]

    vend = app_client.post(
        "/api/finance/vendors",
        json={"name": "Datacenter Hosting Inc", "category": "Hosting"},
        cookies=admin_cookies,
    ).json()

    # Create approved bill for $4,000 total
    b_resp = create_approved(
        app_client, admin_cookies, vend["id"], "PAY-2026-001", 4000.0
    )
    bill_id = b_resp["id"]

    # AC 3: Overpayment cannot exceed remaining balance
    over_pay = app_client.post(
        f"/api/finance/bills/{bill_id}/payments",
        json={
            "direction": "outgoing",
            "amount": 4500.0,
            "currency": "USD",
            "payment_date": "2026-09-10",
            "bank_account_id": account_id,
            "method": "bank_transfer",
        },
        cookies=admin_cookies,
    )
    assert over_pay.status_code == 400
    assert "exceeds remaining" in over_pay.json()["detail"].lower()

    # Record valid partial payment of $1,500
    pay1 = app_client.post(
        f"/api/finance/bills/{bill_id}/payments",
        json={
            "direction": "outgoing",
            "amount": 1500.0,
            "currency": "USD",
            "payment_date": "2026-09-10",
            "bank_account_id": account_id,
            "method": "bank_transfer",
            "reference": "WIRE-001",
        },
        cookies=admin_cookies,
    )
    assert pay1.status_code == 201
    pay1_data = pay1.json()
    pay1_id = pay1_data["id"]

    # Check updated bill: status partially_paid, amount_paid = 1500, remaining_balance = 2500
    bill_after_p1 = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies).json()
    assert bill_after_p1["status"] == "partially_paid"
    assert bill_after_p1["amount_paid"] == 1500.0
    assert bill_after_p1["remaining_balance"] == 2500.0

    # Check bank account balance debited atomically (50000 - 1500 = 48500)
    acc_check1 = app_client.get(f"/api/finance/accounts/{account_id}", cookies=admin_cookies).json()
    assert acc_check1["current_balance"] == 48500.0

    # AC 3: Now try to pay more than the remaining 2500 (e.g. 2600)
    over_pay2 = app_client.post(
        f"/api/finance/bills/{bill_id}/payments",
        json={
            "direction": "outgoing",
            "amount": 2600.0,
            "currency": "USD",
            "payment_date": "2026-09-12",
            "bank_account_id": account_id,
            "method": "bank_transfer",
        },
        cookies=admin_cookies,
    )
    assert over_pay2.status_code == 400
    assert "exceeds remaining" in over_pay2.json()["detail"].lower()

    # AC 4: Atomic payment reversal
    rev_resp = app_client.post(
        f"/api/finance/bills/{bill_id}/payments/{pay1_id}/reverse",
        json={"reason": "Incorrect bank account selected for wire transfer"},
        cookies=admin_cookies,
    )
    assert rev_resp.status_code == 200
    rev_data = rev_resp.json()
    assert rev_data["is_reversed"] is True
    assert rev_data["reversal_reason"] == "Incorrect bank account selected for wire transfer"

    # Verify bank account balance is restored to 50000.0
    acc_check2 = app_client.get(f"/api/finance/accounts/{account_id}", cookies=admin_cookies).json()
    assert acc_check2["current_balance"] == 50000.0

    # Verify bill status is restored to approved, amount_paid = 0, remaining = 4000
    bill_after_rev = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies).json()
    assert bill_after_rev["status"] == "approved"
    assert bill_after_rev["amount_paid"] == 0.0
    assert bill_after_rev["remaining_balance"] == 4000.0

    # Now settle in full ($4,000)
    pay_full = app_client.post(
        f"/api/finance/bills/{bill_id}/payments",
        json={
            "direction": "outgoing",
            "amount": 4000.0,
            "currency": "USD",
            "payment_date": "2026-09-15",
            "bank_account_id": account_id,
            "method": "bank_transfer",
            "reference": "WIRE-FULL",
        },
        cookies=admin_cookies,
    )
    assert pay_full.status_code == 201
    bill_settled = app_client.get(f"/api/finance/bills/{bill_id}", cookies=admin_cookies).json()
    assert bill_settled["status"] == "paid"
    assert bill_settled["amount_paid"] == 4000.0
    assert bill_settled["remaining_balance"] == 0.0
