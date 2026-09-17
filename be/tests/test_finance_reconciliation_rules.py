"""
be/tests/test_finance_reconciliation_rules.py
Tests for Story 6.3: Reconciliation rules
Verifies:
1. Rule CRUD and priority ordering (1 = highest priority)
2. Dry-run preview matching against statement lines without mutating state
3. Deterministic conflict detection between overlapping rules
4. Suggestion mode vs Auto-apply mode (with approval requirement)
5. Reversible rollback of auto-applied rule resolutions
6. Deactivating a rule does not rewrite historical reconciliations
"""
import io
import pytest
from datetime import datetime
from fastapi import status


@pytest.fixture
def rules_env(app_client, admin_cookies):
    # 1. Create Bank Account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Rules Testing Bank",
            "bank_name": "Chase Bank",
            "account_number": f"CHASE-{datetime.utcnow().timestamp()}",
            "currency": "USD",
            "opening_balance": 10000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    account = acc_res.json()
    account_id = account["id"]

    # 2. Upload Bank Statement with 4 distinct lines
    csv_content = (
        "Date,Description,Debit,Credit,Ref\n"
        "2026-09-02,MONTHLY WIRE TRANSFER FEE,50.00,,WIRE-FEE-01\n"
        "2026-09-05,AWS CLOUD HOSTING WA,450.00,,AWS-0926\n"
        "2026-09-10,CUSTOMER PAYMENT ACME CORP,,1500.00,INV-7788\n"
        "2026-09-12,PAPER STATEMENT SERVICE CHARGE,12.00,,FEE-PAPER\n"
    )
    files = {"file": ("sept_statement.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    data = {
        "period_month": "2026-09",
        "opening_balance": 10000.0,
        "closing_balance": 11000.0,
    }
    stmt_res = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data=data,
        files=files,
        cookies=admin_cookies,
    )
    assert stmt_res.status_code == 201
    stmt_import = stmt_res.json()

    # Fetch imported lines
    lines_res = app_client.get(
        f"/api/finance/statements/{stmt_import['id']}/lines",
        cookies=admin_cookies,
    )
    assert lines_res.status_code == 200
    lines = lines_res.json()

    return {
        "account_id": account_id,
        "statement_id": stmt_import["id"],
        "lines": lines,
    }


def test_rule_crud_and_priority_ordering(app_client, admin_cookies, rules_env):
    # 1. Create Rule A with priority 20
    resp_a = app_client.post(
        "/api/finance/rules",
        json={
            "name": "General Bank Fees",
            "priority": 20,
            "is_active": True,
            "mode": "suggestion",
            "description_pattern": "FEE|CHARGE",
            "direction": "out",
            "action": "suggest_category",
            "target_category": "Bank Charges",
        },
        cookies=admin_cookies,
    )
    assert resp_a.status_code == 201
    rule_a = resp_a.json()
    assert rule_a["priority"] == 20

    # 2. Create Rule B with priority 5 (higher precedence)
    resp_b = app_client.post(
        "/api/finance/rules",
        json={
            "name": "Wire Transfer Fees",
            "priority": 5,
            "is_active": True,
            "mode": "suggestion",
            "description_pattern": "WIRE TRANSFER",
            "direction": "out",
            "action": "suggest_category",
            "target_category": "Wire Fees",
        },
        cookies=admin_cookies,
    )
    assert resp_b.status_code == 201
    rule_b = resp_b.json()
    assert rule_b["priority"] == 5

    # 3. List rules -> verify sorted by priority ascending (Rule B first, then Rule A)
    list_res = app_client.get("/api/finance/rules", cookies=admin_cookies)
    assert list_res.status_code == 200
    rules = list_res.json()
    assert len(rules) >= 2
    # Verify rule_b is evaluated before rule_a
    ids = [r["id"] for r in rules]
    assert ids.index(rule_b["id"]) < ids.index(rule_a["id"])


def test_dry_run_preview_and_conflict_detection(app_client, admin_cookies, rules_env):
    statement_id = rules_env["statement_id"]

    # Seed existing rule: Priority 20, matches all "FEE|CHARGE"
    app_client.post(
        "/api/finance/rules",
        json={
            "name": "General Bank Fees",
            "priority": 20,
            "is_active": True,
            "mode": "suggestion",
            "description_pattern": "FEE|CHARGE",
            "direction": "out",
            "action": "suggest_category",
            "target_category": "Bank Charges",
        },
        cookies=admin_cookies,
    )

    # Dry-run preview candidate rule: Priority 10 (higher precedence), matches "WIRE TRANSFER"
    preview_res = app_client.post(
        "/api/finance/rules/preview",
        json={
            "rule": {
                "name": "Specific Wire Fees",
                "priority": 10,
                "is_active": True,
                "mode": "suggestion",
                "description_pattern": "WIRE TRANSFER",
                "direction": "out",
                "action": "suggest_category",
                "target_category": "Wire Fees",
            },
            "statement_id": statement_id,
        },
        cookies=admin_cookies,
    )
    assert preview_res.status_code == 200
    preview = preview_res.json()

    # 1 line matches (MONTHLY WIRE TRANSFER FEE)
    assert preview["matched_lines_count"] == 1
    assert len(preview["sample_matched_lines"]) == 1
    matched_line = preview["sample_matched_lines"][0]
    assert "WIRE TRANSFER" in matched_line["raw_description"]

    # Conflict detection: this line also matches General Bank Fees
    assert len(preview["conflicts"]) == 1
    conflict = preview["conflicts"][0]
    assert conflict["line_id"] == matched_line["id"]
    assert conflict["winning_rule_name"] == "Specific Wire Fees"
    assert conflict["conflicting_rule_name"] == "General Bank Fees"
    assert "priority 10" in conflict["conflict_reason"]

    # Verify statement line status was NOT mutated during preview (dry-run safety)
    lines_res = app_client.get(f"/api/finance/statements/{statement_id}/lines", cookies=admin_cookies)
    line_after_preview = next(l for l in lines_res.json() if l["id"] == matched_line["id"])
    assert line_after_preview["status"] == "unmatched"


def test_suggestion_rule_execution(app_client, admin_cookies, rules_env):
    statement_id = rules_env["statement_id"]

    # Create suggestion rule
    app_client.post(
        "/api/finance/rules",
        json={
            "name": "Customer Receipts Suggestion",
            "priority": 10,
            "is_active": True,
            "mode": "suggestion",
            "direction": "in",
            "description_pattern": "CUSTOMER PAYMENT",
            "action": "suggest_category",
            "target_category": "Accounts Receivable",
        },
        cookies=admin_cookies,
    )

    # Apply rules
    apply_res = app_client.post(
        f"/api/finance/statements/{statement_id}/apply-rules",
        cookies=admin_cookies,
    )
    assert apply_res.status_code == 200
    data = apply_res.json()
    assert data["suggestions_count"] >= 1

    # Check that customer line has suggestion attached in notes, but remains unmatched
    lines_res = app_client.get(f"/api/finance/statements/{statement_id}/lines", cookies=admin_cookies)
    customer_line = next(l for l in lines_res.json() if "ACME CORP" in l["raw_description"])
    assert customer_line["status"] == "unmatched"
    assert "Customer Receipts Suggestion" in customer_line["notes"]
    assert customer_line["is_auto_applied"] is False


def test_auto_apply_execution_and_reversible_rollback(app_client, admin_cookies, rules_env):
    statement_id = rules_env["statement_id"]

    # 1. Create approved auto_apply rule to auto-ignore paper fee
    rule_res = app_client.post(
        "/api/finance/rules",
        json={
            "name": "Auto-Ignore Paper Fee",
            "priority": 1,
            "is_active": True,
            "mode": "auto_apply",
            "is_approved": True,
            "approved_by": "auditor@voyancehealth.com",
            "description_pattern": "PAPER STATEMENT",
            "direction": "out",
            "action": "auto_ignore",
            "audit_reason": "Waived paper delivery fee per commercial agreement",
        },
        cookies=admin_cookies,
    )
    assert rule_res.status_code == 201
    rule = rule_res.json()
    rule_id = rule["id"]

    # 2. Apply rules
    apply_res = app_client.post(
        f"/api/finance/statements/{statement_id}/apply-rules",
        cookies=admin_cookies,
    )
    assert apply_res.status_code == 200
    res_data = apply_res.json()
    assert res_data["auto_applied_count"] >= 1

    # Verify paper statement line is now ignored and marked auto-applied
    lines_res = app_client.get(f"/api/finance/statements/{statement_id}/lines", cookies=admin_cookies)
    paper_line = next(l for l in lines_res.json() if "PAPER STATEMENT" in l["raw_description"])
    assert paper_line["status"] == "ignored"
    assert paper_line["applied_rule_id"] == rule_id
    assert paper_line["is_auto_applied"] is True
    assert "Waived paper delivery fee" in paper_line["notes"]

    # 3. Revert rule resolutions
    revert_res = app_client.post(
        f"/api/finance/rules/{rule_id}/revert",
        cookies=admin_cookies,
    )
    assert revert_res.status_code == 200
    assert revert_res.json()["reverted_lines_count"] >= 1

    # Verify paper statement line is restored to unmatched
    lines_after_revert = app_client.get(f"/api/finance/statements/{statement_id}/lines", cookies=admin_cookies).json()
    paper_line_reverted = next(l for l in lines_after_revert if "PAPER STATEMENT" in l["raw_description"])
    assert paper_line_reverted["status"] == "unmatched"
    assert paper_line_reverted["applied_rule_id"] is None
    assert paper_line_reverted["is_auto_applied"] is False


def test_deactivating_rule_preserves_historical_reconciliations(app_client, admin_cookies, rules_env):
    statement_id = rules_env["statement_id"]

    # 1. Create approved auto_apply rule to auto-create AWS ledger expense
    rule_res = app_client.post(
        "/api/finance/rules",
        json={
            "name": "Auto-Create AWS Entry",
            "priority": 2,
            "is_active": True,
            "mode": "auto_apply",
            "is_approved": True,
            "approved_by": "controller@voyancehealth.com",
            "description_pattern": "AWS CLOUD",
            "direction": "out",
            "action": "auto_create",
            "payment_method": "card",
        },
        cookies=admin_cookies,
    )
    assert rule_res.status_code == 201
    rule_id = rule_res.json()["id"]

    # 2. Apply rules
    apply_res = app_client.post(
        f"/api/finance/statements/{statement_id}/apply-rules",
        cookies=admin_cookies,
    )
    assert apply_res.status_code == 200

    lines_res = app_client.get(f"/api/finance/statements/{statement_id}/lines", cookies=admin_cookies).json()
    aws_line = next(l for l in lines_res if "AWS CLOUD" in l["raw_description"])
    assert aws_line["status"] == "created"
    assert aws_line["matched_transaction_id"] is not None
    matched_tx_id = aws_line["matched_transaction_id"]

    # 3. Deactivate rule
    update_res = app_client.put(
        f"/api/finance/rules/{rule_id}",
        json={"is_active": False},
        cookies=admin_cookies,
    )
    assert update_res.status_code == 200
    assert update_res.json()["is_active"] is False

    # 4. Verify historical resolution remains intact
    lines_after_deactivate = app_client.get(f"/api/finance/statements/{statement_id}/lines", cookies=admin_cookies).json()
    aws_line_after = next(l for l in lines_after_deactivate if "AWS CLOUD" in l["raw_description"])
    assert aws_line_after["status"] == "created"
    assert aws_line_after["matched_transaction_id"] == matched_tx_id
