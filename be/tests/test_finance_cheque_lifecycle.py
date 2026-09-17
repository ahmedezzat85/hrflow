"""
be/tests/test_finance_cheque_lifecycle.py
Tests for Story 5.4 Cheque Lifecycle:
- State transitions matrix (Draft, Issued, Outstanding, Cleared, Bounced, Stopped, Voided, Replaced)
- Server-side rejection of invalid state transitions
- Duplicate cheque number blocking per account (case-insensitive)
- Posting policy: at_issue vs at_clearing
- Cheque replacement workflow and linked reversals
- Stale-date calculation and warnings
"""
import pytest
from datetime import datetime, timedelta


def _setup_test_bank(app_client, admin_cookies, name="Cheque Bank USD", balance=100000.0, currency="USD"):
    res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": name,
            "bank_name": "Test Bank",
            "account_number": f"ACC-{datetime.utcnow().timestamp()}",
            "currency": currency,
            "opening_balance": balance,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert res.status_code == 201
    return res.json()["id"]


def _setup_test_cash(app_client, admin_cookies, name="Drawer Cash USD", balance=5000.0, currency="USD"):
    res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": name,
            "account_number": f"CASH-{datetime.utcnow().timestamp()}",
            "currency": currency,
            "opening_balance": balance,
            "account_type": "cash",
        },
        cookies=admin_cookies,
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_cheque_transition_matrix_valid_and_invalid(app_client, admin_cookies):
    """Verifies valid state paths and ensures invalid transitions are strictly rejected (HTTP 400)."""
    bank_id = _setup_test_bank(app_client, admin_cookies, "Matrix Bank USD", 200000.0)

    # 1. Create a Draft Cheque
    draft_payload = {
        "account_id": bank_id,
        "cheque_number": "CHK-DRAFT-01",
        "issue_date": "2026-09-10",
        "amount": 2500.0,
        "currency": "USD",
        "payee": "Draft Supplier",
        "purpose_type": "other",
        "status": "draft",
        "signer_name": "Finance Director",
    }
    draft_res = app_client.post("/api/finance/cheques", json=draft_payload, cookies=admin_cookies)
    assert draft_res.status_code == 201
    chq_id = draft_res.json()["id"]
    assert draft_res.json()["status"] == "draft"
    assert draft_res.json()["linked_transaction_id"] is None

    # Invalid: draft -> cleared (cannot jump straight to cleared)
    inv_clear = app_client.patch(
        f"/api/finance/cheques/{chq_id}/status",
        json={"status": "cleared"},
        cookies=admin_cookies,
    )
    assert inv_clear.status_code == 400
    assert "Invalid status transition from 'draft' to 'cleared'" in inv_clear.json()["detail"]

    # Invalid: draft -> outstanding
    inv_out = app_client.patch(
        f"/api/finance/cheques/{chq_id}/status",
        json={"status": "outstanding"},
        cookies=admin_cookies,
    )
    assert inv_out.status_code == 400

    # Valid: draft -> issued
    v_issue = app_client.patch(
        f"/api/finance/cheques/{chq_id}/status",
        json={"status": "issued"},
        cookies=admin_cookies,
    )
    assert v_issue.status_code == 200
    assert v_issue.json()["status"] == "issued"
    assert v_issue.json()["linked_transaction_id"] is not None

    # Valid: issued -> outstanding
    v_out = app_client.patch(
        f"/api/finance/cheques/{chq_id}/status",
        json={"status": "outstanding"},
        cookies=admin_cookies,
    )
    assert v_out.status_code == 200
    assert v_out.json()["status"] == "outstanding"

    # Valid: outstanding -> cleared
    v_clear = app_client.patch(
        f"/api/finance/cheques/{chq_id}/status",
        json={"status": "cleared", "clear_date": "2026-09-12"},
        cookies=admin_cookies,
    )
    assert v_clear.status_code == 200
    assert v_clear.json()["status"] == "cleared"
    assert v_clear.json()["clear_date"] == "2026-09-12"

    # Invalid: cleared -> issued (cannot roll back cleared cheque to issued)
    inv_reissue = app_client.patch(
        f"/api/finance/cheques/{chq_id}/status",
        json={"status": "issued"},
        cookies=admin_cookies,
    )
    assert inv_reissue.status_code == 400

    # Valid: cleared -> voided (e.g. stop after provisional clear)
    v_void = app_client.patch(
        f"/api/finance/cheques/{chq_id}/status",
        json={"status": "voided", "reason": "Dishonored post clearance notification"},
        cookies=admin_cookies,
    )
    assert v_void.status_code == 200
    assert v_void.json()["status"] == "voided"

    # Invalid: voided -> anything (voided is terminal)
    inv_void_out = app_client.patch(
        f"/api/finance/cheques/{chq_id}/status",
        json={"status": "issued"},
        cookies=admin_cookies,
    )
    assert inv_void_out.status_code == 400


def test_cheque_duplicate_blocking_per_account(app_client, admin_cookies):
    """Duplicate cheque numbers on the same account are strictly blocked (case-insensitive), but allowed across accounts."""
    bank1 = _setup_test_bank(app_client, admin_cookies, "Bank Alpha USD", 50000.0)
    bank2 = _setup_test_bank(app_client, admin_cookies, "Bank Beta USD", 50000.0)

    p1 = {
        "account_id": bank1,
        "cheque_number": "004050",
        "issue_date": "2026-09-01",
        "amount": 1000.0,
        "currency": "USD",
        "payee": "Alpha Vendor",
        "purpose_type": "other",
    }
    r1 = app_client.post("/api/finance/cheques", json=p1, cookies=admin_cookies)
    assert r1.status_code == 201

    # Exact duplicate on bank1 -> 400
    r_dup = app_client.post("/api/finance/cheques", json=p1, cookies=admin_cookies)
    assert r_dup.status_code == 400
    assert "already been issued" in r_dup.json()["detail"]

    # Duplicate with different whitespace / casing
    p1_variant = dict(p1)
    p1_variant["cheque_number"] = " 004050 "
    r_var = app_client.post("/api/finance/cheques", json=p1_variant, cookies=admin_cookies)
    assert r_var.status_code == 400

    # Same cheque number on bank2 -> Allowed!
    p2 = dict(p1)
    p2["account_id"] = bank2
    p2["payee"] = "Beta Vendor"
    r2 = app_client.post("/api/finance/cheques", json=p2, cookies=admin_cookies)
    assert r2.status_code == 201


def test_cheque_posting_policy_issue_vs_clearing(app_client, admin_cookies):
    """
    posting_policy='at_issue': Outflow posted upon issuance, reversed upon void/bounce.
    posting_policy='at_clearing': Outflow deferred until cleared, posted with clear date.
    """
    bank_id = _setup_test_bank(app_client, admin_cookies, "Policy Bank USD", 100000.0)

    # 1. Cheque with posting_policy = "at_clearing"
    chq_deferred = {
        "account_id": bank_id,
        "cheque_number": "CHK-DEF-01",
        "issue_date": "2026-09-01",
        "amount": 12000.0,
        "currency": "USD",
        "payee": "Deferred Payee",
        "purpose_type": "other",
        "posting_policy": "at_clearing",
    }
    res_def = app_client.post("/api/finance/cheques", json=chq_deferred, cookies=admin_cookies)
    assert res_def.status_code == 201
    c_def = res_def.json()
    assert c_def["posting_policy"] == "at_clearing"
    assert c_def["linked_transaction_id"] is None

    # Balance on bank account should NOT have changed yet
    bank_bal = app_client.get(f"/api/finance/accounts/{bank_id}", cookies=admin_cookies).json()["current_balance"]
    assert abs(bank_bal - 100000.0) < 0.01

    # Transition to outstanding -> Still no ledger outflow
    app_client.patch(
        f"/api/finance/cheques/{c_def['id']}/status",
        json={"status": "outstanding"},
        cookies=admin_cookies,
    )
    bank_bal2 = app_client.get(f"/api/finance/accounts/{bank_id}", cookies=admin_cookies).json()["current_balance"]
    assert abs(bank_bal2 - 100000.0) < 0.01

    # Transition to cleared -> Outflow posted now!
    clear_res = app_client.patch(
        f"/api/finance/cheques/{c_def['id']}/status",
        json={"status": "cleared", "clear_date": "2026-09-14"},
        cookies=admin_cookies,
    )
    assert clear_res.status_code == 200
    assert clear_res.json()["linked_transaction_id"] is not None

    bank_bal3 = app_client.get(f"/api/finance/accounts/{bank_id}", cookies=admin_cookies).json()["current_balance"]
    assert abs(bank_bal3 - 88000.0) < 0.01


def test_cheque_replacement_workflow_and_reversals(app_client, admin_cookies):
    """
    When an issued/bounced/stopped cheque is replaced:
    - Old cheque transitions to 'replaced', ledger reversed, replacement_cheque_id linked.
    - New cheque is created with 'issued', replaced_cheque_id linked, new ledger posted.
    """
    bank_id = _setup_test_bank(app_client, admin_cookies, "Replace Bank USD", 100000.0)

    # 1. Issue Cheque
    issue_payload = {
        "account_id": bank_id,
        "cheque_number": "CHK-OLD-999",
        "issue_date": "2026-09-01",
        "amount": 7500.0,
        "currency": "USD",
        "payee": "Equipment Supplier",
        "purpose_type": "other",
        "posting_policy": "at_issue",
        "signer_name": "Treasurer",
    }
    orig_res = app_client.post("/api/finance/cheques", json=issue_payload, cookies=admin_cookies)
    assert orig_res.status_code == 201
    old_id = orig_res.json()["id"]

    # Balance debited by 7500 -> 92500
    assert abs(app_client.get(f"/api/finance/accounts/{bank_id}", cookies=admin_cookies).json()["current_balance"] - 92500.0) < 0.01

    # Mark as stopped
    stop_res = app_client.patch(
        f"/api/finance/cheques/{old_id}/status",
        json={"status": "stopped", "reason": "Lost in courier mail", "evidence": "Stop-notice #ST-881"},
        cookies=admin_cookies,
    )
    assert stop_res.status_code == 200
    assert stop_res.json()["status"] == "stopped"
    assert stop_res.json()["exception_reason"] == "Lost in courier mail"
    assert stop_res.json()["exception_evidence"] == "Stop-notice #ST-881"

    # Stopped cheque reverses ledger -> Balance restored to 100000
    assert abs(app_client.get(f"/api/finance/accounts/{bank_id}", cookies=admin_cookies).json()["current_balance"] - 100000.0) < 0.01

    # 2. Replace the stopped cheque
    replace_payload = {
        "new_cheque_number": "CHK-NEW-1000",
        "new_issue_date": "2026-09-10",
        "reason": "Re-issuing replacement after courier loss",
        "evidence": "Slip #ST-881",
        "signer_name": "Managing Director",
        "notes": "Fast-track courier dispatch",
    }
    rep_res = app_client.post(
        f"/api/finance/cheques/{old_id}/replace",
        json=replace_payload,
        cookies=admin_cookies,
    )
    assert rep_res.status_code == 201
    new_chq = rep_res.json()
    assert new_chq["cheque_number"] == "CHK-NEW-1000"
    assert new_chq["status"] == "issued"
    assert new_chq["replaced_cheque_id"] == old_id
    assert new_chq["linked_transaction_id"] is not None

    # Check old cheque was updated to replaced with replacement_cheque_id pointing to new cheque
    old_chq_check = app_client.get(f"/api/finance/cheques/{old_id}", cookies=admin_cookies).json()
    assert old_chq_check["status"] == "replaced"
    assert old_chq_check["replacement_cheque_id"] == new_chq["id"]
    assert old_chq_check["linked_transaction_id"] is None

    # Bank balance debited again for new cheque -> 92500
    assert abs(app_client.get(f"/api/finance/accounts/{bank_id}", cookies=admin_cookies).json()["current_balance"] - 92500.0) < 0.01


def test_cheque_stale_date_detection(app_client, admin_cookies):
    """Cheques with issue dates > 180 days ago are flagged with is_stale=True and a descriptive warning."""
    bank_id = _setup_test_bank(app_client, admin_cookies, "Stale Bank USD", 50000.0)

    # 200 days in past
    stale_date = (datetime.utcnow() - timedelta(days=200)).strftime("%Y-%m-%d")
    recent_date = (datetime.utcnow() - timedelta(days=10)).strftime("%Y-%m-%d")

    # Stale Cheque
    r_stale = app_client.post(
        "/api/finance/cheques",
        json={
            "account_id": bank_id,
            "cheque_number": "CHK-STALE-01",
            "issue_date": stale_date,
            "amount": 500.0,
            "currency": "USD",
            "payee": "Old Vendor",
            "purpose_type": "other",
        },
        cookies=admin_cookies,
    )
    assert r_stale.status_code == 201
    assert r_stale.json()["is_stale"] is True
    assert "exceeding standard 180-day" in r_stale.json()["stale_warning"]

    # Fresh Cheque
    r_fresh = app_client.post(
        "/api/finance/cheques",
        json={
            "account_id": bank_id,
            "cheque_number": "CHK-FRESH-01",
            "issue_date": recent_date,
            "amount": 500.0,
            "currency": "USD",
            "payee": "New Vendor",
            "purpose_type": "other",
        },
        cookies=admin_cookies,
    )
    assert r_fresh.status_code == 201
    assert r_fresh.json()["is_stale"] is False
    assert r_fresh.json()["stale_warning"] is None
