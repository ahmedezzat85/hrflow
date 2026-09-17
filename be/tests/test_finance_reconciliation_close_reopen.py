"""
be/tests/test_finance_reconciliation_close_reopen.py
Tests for Story 6.4 - Reconcile, close, and reopen controls.
Verifies:
1. Zero-difference gate: Period close is blocked when closing balance != book balance unless authorized exception override is provided.
2. Documented exception override: Closing with variance succeeds when is_exception_override=True and reason is provided.
3. Closed period lock: Posting ledger transactions and cheques into closed periods is strictly blocked.
4. Audited reopen workflow: Reopening requires justification, updates status to reopened, and removes the posting lock.
5. Completion report: Generates accurate breakdown of balances, resolved lines, and uncleared items.
"""
import io
import pytest
from datetime import datetime
from fastapi import status


@pytest.fixture
def close_reopen_env(app_client, admin_cookies):
    # 1. Bank Account (opening_balance = 10000.0)
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Audit Bank Account",
            "bank_name": "HSBC Egypt",
            "account_number": f"HSBC-{datetime.utcnow().timestamp()}",
            "currency": "USD",
            "opening_balance": 10000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    account = acc_res.json()
    account_id = account["id"]

    # 2. Existing ledger transaction for 2026-08 (10000 - 500 = 9500 current balance)
    tx_res = app_client.post(
        f"/api/finance/accounts/{account_id}/transactions",
        json={
            "date": "2026-08-10",
            "amount": 500.0,
            "direction": "out",
            "currency": "USD",
            "reference": "TX-0801",
            "description": "August Cloud Hosting",
            "counterparty": "AWS",
        },
        cookies=admin_cookies,
    )
    assert tx_res.status_code == 201

    # 3. Upload statement for 2026-08 with closing balance = 9200.0 (Difference of -300 vs book balance 9500.0)
    csv_content = (
        "Date,Description,Debit,Credit,Ref\n"
        "2026-08-10,AWS Cloud Hosting,500.00,,TX-0801\n"
        "2026-08-25,Bank Service Fee,300.00,,FEE-0825\n"
    )
    files = {"file": ("august_stmt.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    data = {
        "period_month": "2026-08",
        "opening_balance": 10000.0,
        "closing_balance": 9200.0,
    }
    stmt_res = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data=data,
        files=files,
        cookies=admin_cookies,
    )
    assert stmt_res.status_code == 201
    stmt = stmt_res.json()

    # Get lines
    lines_res = app_client.get(
        f"/api/finance/statements/{stmt['id']}/lines",
        cookies=admin_cookies,
    )
    assert lines_res.status_code == 200
    lines = lines_res.json()

    return {
        "account_id": account_id,
        "statement": stmt,
        "lines": lines,
    }


def test_close_blocked_by_zero_difference_gate(app_client, admin_cookies, close_reopen_env):
    """Close is rejected if difference is non-zero and no override is provided."""
    data = close_reopen_env
    stmt_id = data["statement"]["id"]
    lines = data["lines"]

    # Match the first line (500)
    l1 = next(l for l in lines if "AWS" in l["raw_description"])
    app_client.post(
        f"/api/finance/statements/{stmt_id}/lines/{l1['id']}/resolve",
        json={"action": "ignore", "notes": "Matched externally"},
        cookies=admin_cookies,
    )

    # Resolve second line
    l2 = next(l for l in lines if "Bank Service Fee" in l["raw_description"])
    app_client.post(
        f"/api/finance/statements/{stmt_id}/lines/{l2['id']}/resolve",
        json={"action": "ignore", "notes": "Fee confirmed"},
        cookies=admin_cookies,
    )

    # Attempt to close without override: book balance is 9500, closing balance is 9200 (diff -300)
    res = app_client.post(
        f"/api/finance/statements/{stmt_id}/close",
        json={
            "closing_notes": "Attempt closing with variance",
            "is_exception_override": False,
        },
        cookies=admin_cookies,
    )
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert "Cannot close period: balance difference" in res.json()["detail"]


def test_close_with_exception_override_requires_reason(app_client, admin_cookies, close_reopen_env):
    """Override flag without a documented reason is rejected."""
    data = close_reopen_env
    stmt_id = data["statement"]["id"]
    lines = data["lines"]

    for l in lines:
        app_client.post(
            f"/api/finance/statements/{stmt_id}/lines/{l['id']}/resolve",
            json={"action": "ignore", "notes": "Handled"},
            cookies=admin_cookies,
        )

    res = app_client.post(
        f"/api/finance/statements/{stmt_id}/close",
        json={
            "closing_notes": "Override attempted without justification",
            "is_exception_override": True,
            "exception_override_reason": "",
        },
        cookies=admin_cookies,
    )
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert "A documented exception override reason is required" in res.json()["detail"]


def test_close_with_valid_exception_override_succeeds(app_client, admin_cookies, close_reopen_env):
    """Closing with variance succeeds when valid override and reason are provided."""
    data = close_reopen_env
    stmt_id = data["statement"]["id"]
    lines = data["lines"]

    for l in lines:
        app_client.post(
            f"/api/finance/statements/{stmt_id}/lines/{l['id']}/resolve",
            json={"action": "ignore", "notes": "Handled"},
            cookies=admin_cookies,
        )

    res = app_client.post(
        f"/api/finance/statements/{stmt_id}/close",
        json={
            "closing_notes": "Closing with variance approved by CFO",
            "is_exception_override": True,
            "exception_override_reason": "300 USD discrepancy under investigation with bank clearing operations",
        },
        cookies=admin_cookies,
    )
    assert res.status_code == status.HTTP_200_OK
    body = res.json()
    assert body["status"] == "closed"
    assert body["is_exception_override"] is True
    assert "300 USD discrepancy" in body["exception_override_reason"]
    assert body["closed_by"] is not None


def test_closed_period_locks_new_ledger_and_cheque_postings(app_client, admin_cookies, close_reopen_env):
    """Closed period lock blocks creating new ledger transactions or issuing cheques for that period."""
    data = close_reopen_env
    stmt_id = data["statement"]["id"]
    acc_id = data["account_id"]
    lines = data["lines"]

    for l in lines:
        app_client.post(
            f"/api/finance/statements/{stmt_id}/lines/{l['id']}/resolve",
            json={"action": "ignore", "notes": "Handled"},
            cookies=admin_cookies,
        )

    # Close period
    close_res = app_client.post(
        f"/api/finance/statements/{stmt_id}/close",
        json={
            "is_exception_override": True,
            "exception_override_reason": "Approved exception",
        },
        cookies=admin_cookies,
    )
    assert close_res.status_code == status.HTTP_200_OK

    # 1. Attempt posting ledger transaction with date in closed period (2026-08-15)
    tx_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-08-15",
            "amount": 100.0,
            "direction": "out",
            "currency": "USD",
            "reference": "LATE-TX",
            "description": "Late entry",
        },
        cookies=admin_cookies,
    )
    assert tx_res.status_code == status.HTTP_400_BAD_REQUEST
    assert "closed reconciliation period" in tx_res.json()["detail"]

    # 2. Attempt issuing cheque with issue_date in closed period (2026-08-20)
    chq_res = app_client.post(
        "/api/finance/cheques",
        json={
            "account_id": acc_id,
            "cheque_number": "CHQ-CLOSED-01",
            "payee": "Late Vendor",
            "amount": 400.0,
            "currency": "USD",
            "issue_date": "2026-08-20",
            "status": "issued",
            "purpose": "vendor_payment",
        },
        cookies=admin_cookies,
    )
    assert chq_res.status_code == status.HTTP_400_BAD_REQUEST
    assert "closed reconciliation period" in chq_res.json()["detail"]


def test_reopen_period_requires_reason_and_unlocks_postings(app_client, admin_cookies, close_reopen_env):
    """Reopening requires documented justification and removes posting lock."""
    data = close_reopen_env
    stmt_id = data["statement"]["id"]
    acc_id = data["account_id"]
    lines = data["lines"]

    for l in lines:
        app_client.post(
            f"/api/finance/statements/{stmt_id}/lines/{l['id']}/resolve",
            json={"action": "ignore", "notes": "Handled"},
            cookies=admin_cookies,
        )

    # Close period
    app_client.post(
        f"/api/finance/statements/{stmt_id}/close",
        json={
            "is_exception_override": True,
            "exception_override_reason": "Approved exception",
        },
        cookies=admin_cookies,
    )

    # Reopen without reason -> fails validation (422 min_length)
    bad_reopen = app_client.post(
        f"/api/finance/statements/{stmt_id}/reopen",
        json={"reopen_reason": ""},
        cookies=admin_cookies,
    )
    assert bad_reopen.status_code in (status.HTTP_422_UNPROCESSABLE_ENTITY, status.HTTP_400_BAD_REQUEST)

    # Reopen with audited reason
    reopen_res = app_client.post(
        f"/api/finance/statements/{stmt_id}/reopen",
        json={"reopen_reason": "Discovered late bank fee reversal from branch manager"},
        cookies=admin_cookies,
    )
    assert reopen_res.status_code == status.HTTP_200_OK
    stmt_reopened = reopen_res.json()
    assert stmt_reopened["status"] == "reopened"
    assert stmt_reopened["reopen_reason"] == "Discovered late bank fee reversal from branch manager"
    assert stmt_reopened["reopened_by"] is not None

    # Now posting in 2026-08 should be allowed again!
    tx_res = app_client.post(
        f"/api/finance/accounts/{acc_id}/transactions",
        json={
            "date": "2026-08-15",
            "amount": 100.0,
            "direction": "out",
            "currency": "USD",
            "reference": "POST-REOPEN-TX",
            "description": "Adjusting entry after reopen",
        },
        cookies=admin_cookies,
    )
    assert tx_res.status_code == status.HTTP_201_CREATED


def test_completion_report_generation(app_client, admin_cookies, close_reopen_env):
    """Completion report generates full metrics and audit history."""
    data = close_reopen_env
    stmt_id = data["statement"]["id"]
    lines = data["lines"]

    # 1. Create a transaction from line 1
    l1 = lines[0]
    app_client.post(
        f"/api/finance/statements/{stmt_id}/lines/{l1['id']}/resolve",
        json={
            "action": "create_transaction",
            "category_id": 1,
            "description": "Auto-created entry",
        },
        cookies=admin_cookies,
    )

    # 2. Ignore line 2 with reason
    l2 = lines[1]
    app_client.post(
        f"/api/finance/statements/{stmt_id}/lines/{l2['id']}/resolve",
        json={"action": "ignore", "notes": "Audited duplicate line"},
        cookies=admin_cookies,
    )

    # Fetch completion report
    rep_res = app_client.get(
        f"/api/finance/statements/{stmt_id}/completion-report",
        cookies=admin_cookies,
    )
    assert rep_res.status_code == status.HTTP_200_OK
    report = rep_res.json()

    assert report["statement_id"] == stmt_id
    assert report["period_month"] == "2026-08"
    assert report["total_lines_count"] == 2
    assert report["created_entries_count"] == 1
    assert report["created_entries_amount"] == 500.0
    assert report["ignored_lines_count"] == 1
    assert report["ignored_lines_amount"] == 300.0
    assert len(report["ignored_lines_details"]) == 1
    assert report["ignored_lines_details"][0]["audit_reason"] == "Audited duplicate line"
    assert "generated_at" in report
