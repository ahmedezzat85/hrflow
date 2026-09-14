"""
be/tests/test_finance_reconciliation_workspace.py
Tests for Story 6.2 - Side-by-side reconciliation workspace.
Verifies:
1. Suggested match rationale and confidence explanation
2. Prevent double-matching candidate transactions or cheques
3. Split statement line validation (exact sum equality required)
4. Mandatory documented reason for ignored statement lines
5. Live reconciliation workspace summary (statement balance, book balance, difference, resolved amount/count)
"""
import pytest
from fastapi import status
from datetime import datetime

from finance.models import (
    FinanceBankAccountDB,
    LedgerTransactionDB,
    FinanceChequeDB,
    BankStatementImportDB,
    StatementLineDB,
)


import io
import pytest
from datetime import datetime
from fastapi import status


@pytest.fixture
def reconciliation_env(app_client, admin_cookies):
    # 1. Create Bank Account
    acc_res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Operating Checking",
            "bank_name": "National Bank of Egypt",
            "account_number": f"EG-{datetime.utcnow().timestamp()}",
            "currency": "USD",
            "opening_balance": 10000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert acc_res.status_code == 201
    account = acc_res.json()
    account_id = account["id"]

    # 2. Create Ledger Transactions
    tx1_res = app_client.post(
        f"/api/finance/accounts/{account_id}/transactions",
        json={
            "date": "2026-09-05",
            "amount": 150.0,
            "direction": "out",
            "currency": "USD",
            "reference": "INV-9901",
            "description": "Office Supplies Delivery",
            "counterparty": "Staples Corp",
        },
        cookies=admin_cookies,
    )
    assert tx1_res.status_code == 201
    tx1 = tx1_res.json()

    # 3. Create Issued Cheque
    chq_res = app_client.post(
        "/api/finance/cheques",
        json={
            "account_id": account_id,
            "cheque_number": f"CHQ-{int(datetime.utcnow().timestamp()) % 100000}",
            "payee": "Prime Landlord LLC",
            "amount": 2500.0,
            "currency": "USD",
            "issue_date": "2026-09-02",
            "status": "issued",
            "purpose": "rent",
        },
        cookies=admin_cookies,
    )
    assert chq_res.status_code == 201
    cheque = chq_res.json()

    # 4. Upload Statement
    csv_content = (
        "Date,Description,Debit,Credit,Ref\n"
        f"2026-09-05,STAPLES CORP INV-9901,150.00,,INV-9901\n"
        f"2026-09-03,CHEQUE CLEARING {cheque['cheque_number']},2500.00,,{cheque['cheque_number']}\n"
        "2026-09-12,MISC CHARGE TO SPLIT,300.00,,BANK-FEE-SPLIT\n"
    )
    files = {"file": ("statement.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    data = {
        "period_month": "2026-09",
        "opening_balance": 10000.0,
        "closing_balance": 10350.0,
    }
    stmt_res = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data=data,
        files=files,
        cookies=admin_cookies,
    )
    assert stmt_res.status_code == 201
    stmt_import = stmt_res.json()

    # Fetch lines
    lines_res = app_client.get(
        f"/api/finance/statements/{stmt_import['id']}/lines",
        cookies=admin_cookies,
    )
    assert lines_res.status_code == 200
    lines = lines_res.json()

    return {
        "account": account,
        "tx1": tx1,
        "cheque": cheque,
        "import": stmt_import,
        "lines": lines,
    }


def test_suggested_matches_explain_rationale(app_client, admin_cookies, reconciliation_env):
    """Every suggested match explains why it was suggested with confidence score."""
    data = reconciliation_env
    resp = app_client.get(
        f"/api/finance/statements/{data['import']['id']}/lines",
        cookies=admin_cookies,
    )
    assert resp.status_code == status.HTTP_200_OK
    lines = resp.json()
    assert len(lines) == 3

    # Check line with INV-9901 (matching tx1)
    l1 = next(l for l in lines if l["raw_reference"] == "INV-9901")
    assert len(l1["suggested_matches"]) > 0
    top_match = l1["suggested_matches"][0]
    assert top_match["transaction_id"] == data["tx1"]["id"]
    assert top_match["score"] >= 0.8
    assert "Exact amount match" in top_match["reason"]
    assert "Ref match" in top_match["reason"]

    # Check line with cheque number (matching cheque)
    l2 = next(l for l in lines if l["raw_reference"] == data["cheque"]["cheque_number"])
    assert len(l2["suggested_matches"]) > 0
    chq_match = next(m for m in l2["suggested_matches"] if m["match_type"] == "cheque")
    assert chq_match["cheque_id"] == data["cheque"]["id"]
    assert data["cheque"]["cheque_number"] in chq_match["reason"]


def test_confirm_match_prevents_duplicate_matching(app_client, admin_cookies, reconciliation_env):
    """Prevent double-matching a transaction or cheque across statement lines."""
    data = reconciliation_env
    line1 = next(l for l in data["lines"] if l["raw_reference"] == "INV-9901")
    line3 = next(l for l in data["lines"] if l["raw_reference"] == "BANK-FEE-SPLIT")

    # 1. Match line 1 to tx1
    match_payload = {
        "action": "match",
        "matched_transaction_id": data["tx1"]["id"],
    }
    r1 = app_client.post(
        f"/api/finance/statements/{data['import']['id']}/lines/{line1['id']}/resolve",
        json=match_payload,
        cookies=admin_cookies,
    )
    assert r1.status_code == status.HTTP_200_OK
    assert r1.json()["status"] == "matched"
    assert r1.json()["matched_transaction_id"] == data["tx1"]["id"]

    # 2. Attempting to match line 3 to tx1 must be blocked server-side
    r2 = app_client.post(
        f"/api/finance/statements/{data['import']['id']}/lines/{line3['id']}/resolve",
        json=match_payload,
        cookies=admin_cookies,
    )
    assert r2.status_code == status.HTTP_400_BAD_REQUEST
    assert "already matched" in r2.json()["detail"]


def test_ignore_line_requires_mandatory_reason(app_client, admin_cookies, reconciliation_env):
    """Ignored lines require a mandatory reason note and remain in the audit report."""
    data = reconciliation_env
    line1 = next(l for l in data["lines"] if l["raw_reference"] == "INV-9901")

    # Attempt ignore without notes
    r1 = app_client.post(
        f"/api/finance/statements/{data['import']['id']}/lines/{line1['id']}/resolve",
        json={"action": "ignore", "notes": ""},
        cookies=admin_cookies,
    )
    assert r1.status_code == status.HTTP_400_BAD_REQUEST
    assert "reason is mandatory" in r1.json()["detail"].lower()

    # Successful ignore with reason
    r2 = app_client.post(
        f"/api/finance/statements/{data['import']['id']}/lines/{line1['id']}/resolve",
        json={"action": "ignore", "notes": "Duplicate debit posted in error by bank"},
        cookies=admin_cookies,
    )
    assert r2.status_code == status.HTTP_200_OK
    assert r2.json()["status"] == "ignored"
    assert "Duplicate debit" in r2.json()["notes"]


def test_split_statement_line_requires_exact_amount_sum(app_client, admin_cookies, reconciliation_env):
    """Split portions must equal the source amount within currency precision."""
    data = reconciliation_env
    line3 = next(l for l in data["lines"] if l["raw_reference"] == "BANK-FEE-SPLIT")
    # line3 amount is 300.0

    # 1. Invalid split totaling 290.0 (mismatch)
    bad_split = {
        "action": "split",
        "splits": [
            {"amount": 150.0, "description": "Legal fee"},
            {"amount": 140.0, "description": "Consulting fee"},
        ],
    }
    r1 = app_client.post(
        f"/api/finance/statements/{data['import']['id']}/lines/{line3['id']}/resolve",
        json=bad_split,
        cookies=admin_cookies,
    )
    assert r1.status_code == status.HTTP_400_BAD_REQUEST
    assert "must equal line amount" in r1.json()["detail"]

    # 2. Valid split totaling 300.0 (100.0 + 200.0)
    good_split = {
        "action": "split",
        "notes": "Divided between software and maintenance",
        "splits": [
            {"amount": 100.0, "description": "Software Subscription"},
            {"amount": 200.0, "description": "Maintenance Support"},
        ],
    }
    r2 = app_client.post(
        f"/api/finance/statements/{data['import']['id']}/lines/{line3['id']}/resolve",
        json=good_split,
        cookies=admin_cookies,
    )
    assert r2.status_code == status.HTTP_200_OK
    res = r2.json()
    assert res["status"] == "split"
    assert len(res["child_lines"]) == 2
    assert res["child_lines"][0]["raw_amount"] == 100.0
    assert res["child_lines"][1]["raw_amount"] == 200.0


def test_reconciliation_workspace_live_summary(app_client, admin_cookies, reconciliation_env):
    """Shows statement balance, book balance, difference, resolved amount/count without reload."""
    data = reconciliation_env
    line1 = next(l for l in data["lines"] if l["raw_reference"] == "INV-9901")

    # Check initial summary
    r = app_client.get(
        f"/api/finance/statements/{data['import']['id']}/summary",
        cookies=admin_cookies,
    )
    assert r.status_code == status.HTTP_200_OK
    summary = r.json()
    assert summary["statement_opening_balance"] == 10000.0
    assert summary["statement_closing_balance"] == 10350.0
    assert summary["total_lines_count"] == 3
    assert summary["resolved_lines_count"] == 0
    assert summary["unmatched_lines_count"] == 3
    assert summary["resolved_amount"] == 0.0

    # Resolve line 1 by create
    r_res = app_client.post(
        f"/api/finance/statements/{data['import']['id']}/lines/{line1['id']}/resolve",
        json={"action": "create", "description": "Resolved line 1"},
        cookies=admin_cookies,
    )
    assert r_res.status_code == status.HTTP_200_OK

    # Check updated summary
    r_after = app_client.get(
        f"/api/finance/statements/{data['import']['id']}/summary",
        cookies=admin_cookies,
    )
    assert r_after.status_code == status.HTTP_200_OK
    summary_after = r_after.json()
    assert summary_after["resolved_lines_count"] == 1
    assert summary_after["unmatched_lines_count"] == 2
    assert summary_after["resolved_amount"] == 150.0
