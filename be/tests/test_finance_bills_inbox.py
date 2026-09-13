"""
be/tests/test_finance_bills_inbox.py
Tests for Story 4.1: Bill capture and AP inbox.
Verifies:
 - AP Inbox queue counts (inbox, needs_coding, needs_approval, ready_to_pay, scheduled, paid, exceptions, all)
 - Duplicate detection on vendor + bill_number / total + date / file_fingerprint
 - Duplicate blocking and authorized override
 - Uploaded / unreviewed bills cannot move directly to payable/paid status without review
"""
import pytest


def test_bill_inbox_queue_and_counts(app_client, admin_cookies):
    # Ensure vendor exists
    vend = app_client.post(
        "/api/finance/vendors",
        json={"name": "Inbox Vendor Co", "category": "Operations"},
        cookies=admin_cookies,
    ).json()
    vendor_id = vend["id"]

    # 1. Create bills across different queues
    b_inbox = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "INB-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "status": "inbox",
            "capture_source": "upload",
            "is_reviewed": False,
            "lines": [{"description": "Raw upload scan", "quantity": 1, "unit_price": 500, "line_total": 500}],
        },
        cookies=admin_cookies,
    )
    assert b_inbox.status_code == 201
    inbox_data = b_inbox.json()
    assert inbox_data["status"] == "inbox"
    assert inbox_data["is_reviewed"] is False

    b_coding = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "INB-002",
            "issue_date": "2026-09-02",
            "due_date": "2026-09-30",
            "status": "needs_coding",
            "lines": [{"description": "Uncategorized Item", "quantity": 1, "unit_price": 750, "line_total": 750}],
        },
        cookies=admin_cookies,
    )
    assert b_coding.status_code == 201

    # 2. Check queue counts
    counts_resp = app_client.get(
        f"/api/finance/bills/queue-counts?vendor_id={vendor_id}",
        cookies=admin_cookies,
    )
    assert counts_resp.status_code == 200
    counts = counts_resp.json()
    assert counts["inbox"] >= 1
    assert counts["needs_coding"] >= 1
    assert counts["all"] >= 2

    # 3. Filter by queue
    inbox_list = app_client.get(
        "/api/finance/bills?queue=inbox",
        cookies=admin_cookies,
    ).json()
    assert any(b["bill_number"] == "INB-001" for b in inbox_list)
    assert not any(b["bill_number"] == "INB-002" for b in inbox_list)


def test_bill_duplicate_detection_and_override(app_client, admin_cookies):
    vend = app_client.post(
        "/api/finance/vendors",
        json={"name": "DupCheck Supplier", "category": "Tech"},
        cookies=admin_cookies,
    ).json()
    vendor_id = vend["id"]

    # Create original bill
    orig = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "DUP-ORIG-100",
            "issue_date": "2026-09-10",
            "due_date": "2026-10-10",
            "status": "ready_to_pay",
            "file_fingerprint": "sha256-abc123xyz789",
            "lines": [{"description": "Server Hardware", "quantity": 1, "unit_price": 3200, "line_total": 3200}],
        },
        cookies=admin_cookies,
    )
    assert orig.status_code == 201

    # Check duplicate candidates via endpoint
    dup_check = app_client.post(
        "/api/finance/bills/check-duplicate",
        json={
            "vendor_id": vendor_id,
            "bill_number": "dup orig 100",  # Normalized match
            "total": 3200,
            "issue_date": "2026-09-10",
        },
        cookies=admin_cookies,
    )
    assert dup_check.status_code == 200
    candidates = dup_check.json()["candidates"]
    assert len(candidates) >= 1
    assert candidates[0]["bill_number"] == "DUP-ORIG-100"

    # Attempt to create duplicate bill without override -> should be blocked
    blocked = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "DUP-NEW-200",
            "issue_date": "2026-09-10",
            "due_date": "2026-10-10",
            "status": "inbox",
            "file_fingerprint": "sha256-abc123xyz789",  # Matching fingerprint
            "lines": [{"description": "Server Hardware", "quantity": 1, "unit_price": 3200, "line_total": 3200}],
        },
        cookies=admin_cookies,
    )
    assert blocked.status_code == 409
    assert "duplicate" in blocked.json()["detail"].lower()

    # Attempt override without reason -> 400
    no_reason = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "DUP-NEW-200",
            "issue_date": "2026-09-10",
            "due_date": "2026-10-10",
            "status": "inbox",
            "file_fingerprint": "sha256-abc123xyz789",
            "is_duplicate_override": True,
            "duplicate_override_reason": "",
            "lines": [{"description": "Server Hardware", "quantity": 1, "unit_price": 3200, "line_total": 3200}],
        },
        cookies=admin_cookies,
    )
    assert no_reason.status_code == 400

    # Override with valid reason -> 201 Created
    ok_override = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "DUP-NEW-200",
            "issue_date": "2026-09-10",
            "due_date": "2026-10-10",
            "status": "inbox",
            "file_fingerprint": "sha256-abc123xyz789",
            "is_duplicate_override": True,
            "duplicate_override_reason": "Verified legitimate secondary charge from supplier",
            "lines": [{"description": "Server Hardware", "quantity": 1, "unit_price": 3200, "line_total": 3200}],
        },
        cookies=admin_cookies,
    )
    assert ok_override.status_code == 201
    assert ok_override.json()["is_duplicate_override"] is True


def test_bill_review_rule_prevents_unreviewed_payable(app_client, admin_cookies):
    vend = app_client.post(
        "/api/finance/vendors",
        json={"name": "Review Supplier", "category": "Legal"},
        cookies=admin_cookies,
    ).json()
    vendor_id = vend["id"]

    # 1. Create unreviewed upload bill
    bill = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "REV-001",
            "issue_date": "2026-09-05",
            "due_date": "2026-10-05",
            "status": "inbox",
            "capture_source": "upload",
            "is_reviewed": False,
            "missing_fields": "department,category",
            "lines": [{"description": "Retainer", "quantity": 1, "unit_price": 1000, "line_total": 1000}],
        },
        cookies=admin_cookies,
    ).json()
    bill_id = bill["id"]

    # 2. Try moving to ready_to_pay without reviewing -> blocked
    bad_transition = app_client.put(
        f"/api/finance/bills/{bill_id}",
        json={"status": "ready_to_pay"},
        cookies=admin_cookies,
    )
    assert bad_transition.status_code == 400
    assert "reviewed" in bad_transition.json()["detail"].lower()

    # 3. Review and code the bill -> allowed
    good_transition = app_client.put(
        f"/api/finance/bills/{bill_id}",
        json={
            "status": "ready_to_pay",
            "is_reviewed": True,
            "department": "Corporate Legal",
            "category": "Legal & Professional",
        },
        cookies=admin_cookies,
    )
    assert good_transition.status_code == 200
    assert good_transition.json()["status"] == "ready_to_pay"
    assert good_transition.json()["is_reviewed"] is True
    assert good_transition.json()["department"] == "Corporate Legal"
