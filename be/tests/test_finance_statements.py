"""
be/tests/test_finance_statements.py
Backend integration tests for Phase 7: Bank Statement Import & Reconciliation.
"""
import io
import pytest
from datetime import datetime


@pytest.fixture
def test_bank_account(app_client, admin_cookies):
    """Creates a fresh test bank account."""
    resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Statement Test Chase Account",
            "bank_name": "JPMorgan Chase",
            "account_number": "CHASE-STMT-9988",
            "currency": "USD",
            "opening_balance": 10000.0,
            "current_balance": 10000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    return resp.json()


def test_csv_statement_upload_and_parsing(app_client, admin_cookies, test_bank_account):
    """Test CSV statement upload, automatic column detection, and parsed lines retrieval."""
    account_id = test_bank_account["id"]

    csv_data = (
        "Date,Description,Debit,Credit,Reference\n"
        "2026-09-01,Cloud Hosting Fee,120.50,,AWS-REF-01\n"
        "2026-09-05,Client Inward Wire,,4500.00,WIRE-IN-02\n"
        "2026-09-10,Office Supplies,85.20,,AMZ-REF-03\n"
    )

    files = {
        "file": ("september_statement.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")
    }
    data = {
        "period_month": "2026-09",
    }

    upload_resp = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data=data,
        files=files,
        cookies=admin_cookies,
    )
    assert upload_resp.status_code == 201
    stmt_import = upload_resp.json()
    import_id = stmt_import["id"]
    assert stmt_import["account_id"] == account_id
    assert stmt_import["period_month"] == "2026-09"
    assert stmt_import["file_type"] == "csv"
    assert stmt_import["status"] == "needs_review"
    assert stmt_import["total_lines_count"] == 3
    assert stmt_import["matched_lines_count"] == 0
    assert len(stmt_import["attachments"]) == 1

    # Fetch parsed lines
    lines_resp = app_client.get(
        f"/api/finance/statements/{import_id}/lines",
        cookies=admin_cookies,
    )
    assert lines_resp.status_code == 200
    lines = lines_resp.json()
    assert len(lines) == 3

    line1 = lines[0]
    assert line1["raw_date"] == "2026-09-01"
    assert line1["raw_amount"] == 120.50
    assert line1["direction"] == "out"
    assert "Cloud Hosting" in line1["raw_description"]

    line2 = lines[1]
    assert line2["raw_date"] == "2026-09-05"
    assert line2["raw_amount"] == 4500.00
    assert line2["direction"] == "in"


def test_statement_line_match_suggestion_and_resolution(app_client, admin_cookies, test_bank_account):
    """Test reconciliation matching engine finds existing ledger transactions and links them."""
    account_id = test_bank_account["id"]

    # 1. Post an existing ledger transaction on the account
    tx_resp = app_client.post(
        f"/api/finance/accounts/{account_id}/transactions",
        json={
            "date": "2026-09-14",
            "amount": 350.00,
            "direction": "out",
            "currency": "USD",
            "reference": "VENDOR-PAY-77",
            "description": "Consulting Services Payment",
        },
        cookies=admin_cookies,
    )
    assert tx_resp.status_code == 201
    tx_id = tx_resp.json()["id"]

    # 2. Upload statement with a line within date proximity (2026-09-15) and identical amount
    csv_data = (
        "Date,Description,Debit,Credit,Reference\n"
        "2026-09-15,Consulting Direct Outflow,350.00,,VENDOR-PAY-77\n"
    )
    files = {
        "file": ("stmt_sept.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")
    }
    upload_resp = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data={"period_month": "2026-09"},
        files=files,
        cookies=admin_cookies,
    )
    assert upload_resp.status_code == 201
    import_id = upload_resp.json()["id"]

    # 3. Retrieve lines and verify suggested match
    lines_resp = app_client.get(
        f"/api/finance/statements/{import_id}/lines",
        cookies=admin_cookies,
    )
    assert lines_resp.status_code == 200
    lines = lines_resp.json()
    assert len(lines) == 1
    assert len(lines[0]["suggested_matches"]) >= 1

    top_match = lines[0]["suggested_matches"][0]
    assert top_match["transaction_id"] == tx_id
    assert top_match["score"] >= 0.8
    assert top_match["amount"] == 350.00

    # 4. Resolve line by confirming match
    line_id = lines[0]["id"]
    resolve_resp = app_client.post(
        f"/api/finance/statements/{import_id}/lines/{line_id}/resolve",
        json={
            "action": "match",
            "matched_transaction_id": tx_id,
            "notes": "Confirmed against ledger outflow",
        },
        cookies=admin_cookies,
    )
    assert resolve_resp.status_code == 200
    resolved_line = resolve_resp.json()
    assert resolved_line["status"] == "matched"
    assert resolved_line["matched_transaction_id"] == tx_id


def test_statement_line_matches_issued_cheque_and_auto_clears(app_client, admin_cookies, test_bank_account):
    """Test statement matching against an issued cheque auto-clears the cheque."""
    account_id = test_bank_account["id"]

    # 1. Issue a cheque
    chq_resp = app_client.post(
        "/api/finance/cheques",
        json={
            "account_id": account_id,
            "cheque_number": "CHK-STMT-7788",
            "issue_date": "2026-09-08",
            "amount": 1250.00,
            "currency": "USD",
            "payee": "Cairo Facilities Management",
            "purpose_type": "other",
        },
        cookies=admin_cookies,
    )
    assert chq_resp.status_code == 201
    cheque = chq_resp.json()
    cheque_id = cheque["id"]
    assert cheque["status"] == "issued"

    # 2. Upload statement where cheque cleared on 2026-09-12
    csv_data = (
        "Date,Description,Amount\n"
        "2026-09-12,Paid Cheque #CHK-STMT-7788,-1250.00\n"
    )
    files = {
        "file": ("chase_cleared_cheques.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")
    }
    upload_resp = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data={"period_month": "2026-09"},
        files=files,
        cookies=admin_cookies,
    )
    assert upload_resp.status_code == 201
    import_id = upload_resp.json()["id"]

    # 3. Retrieve lines and verify cheque suggestion
    lines_resp = app_client.get(
        f"/api/finance/statements/{import_id}/lines",
        cookies=admin_cookies,
    )
    assert lines_resp.status_code == 200
    lines = lines_resp.json()
    assert len(lines) == 1
    cheque_matches = [m for m in lines[0]["suggested_matches"] if m["cheque_id"] == cheque_id]
    assert len(cheque_matches) == 1
    assert cheque_matches[0]["match_type"] == "cheque"

    # 4. Resolve line with action match & matched_cheque_id
    line_id = lines[0]["id"]
    res_resp = app_client.post(
        f"/api/finance/statements/{import_id}/lines/{line_id}/resolve",
        json={
            "action": "match",
            "matched_cheque_id": cheque_id,
        },
        cookies=admin_cookies,
    )
    assert res_resp.status_code == 200
    assert res_resp.json()["status"] == "matched"
    assert res_resp.json()["matched_cheque_id"] == cheque_id

    # 5. Verify the cheque is now CLEARED with clear date set to statement line date
    get_chq = app_client.get("/api/finance/cheques", cookies=admin_cookies)
    all_cheques = get_chq.json()
    updated_chq = next(c for c in all_cheques if c["id"] == cheque_id)
    assert updated_chq["status"] == "cleared"
    assert updated_chq["clear_date"] == "2026-09-12"


def test_statement_auto_create_entry_and_reconciliation(app_client, admin_cookies, test_bank_account):
    """Test auto-creating transaction from unmatched line and finalizing reconciliation."""
    account_id = test_bank_account["id"]

    csv_data = (
        "Date,Description,Debit,Credit\n"
        "2026-09-30,Monthly Maintenance Bank Fee,15.00,\n"
    )
    files = {
        "file": ("fee_stmt.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")
    }
    upload_resp = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data={"period_month": "2026-09"},
        files=files,
        cookies=admin_cookies,
    )
    assert upload_resp.status_code == 201
    import_id = upload_resp.json()["id"]

    # Cannot reconcile while lines are unmatched
    premature_reconcile = app_client.post(
        f"/api/finance/statements/{import_id}/reconcile",
        cookies=admin_cookies,
    )
    assert premature_reconcile.status_code == 400
    assert "remain unmatched" in premature_reconcile.json()["detail"]

    # Retrieve line
    lines_resp = app_client.get(
        f"/api/finance/statements/{import_id}/lines",
        cookies=admin_cookies,
    )
    line_id = lines_resp.json()[0]["id"]

    # Resolve by creating transaction
    create_resp = app_client.post(
        f"/api/finance/statements/{import_id}/lines/{line_id}/resolve",
        json={
            "action": "create",
            "description": "Monthly Bank Service Fee",
            "reference": "CHASE-FEE-09",
        },
        cookies=admin_cookies,
    )
    assert create_resp.status_code == 200
    created_line = create_resp.json()
    assert created_line["status"] == "created"
    assert created_line["matched_transaction_id"] is not None

    # Now reconcile closes the statement period
    reconcile_resp = app_client.post(
        f"/api/finance/statements/{import_id}/reconcile",
        cookies=admin_cookies,
    )
    assert reconcile_resp.status_code == 200
    final_stmt = reconcile_resp.json()
    assert final_stmt["status"] == "reconciled"
    assert final_stmt["reconciled_at"] is not None
    assert final_stmt["matched_lines_count"] == 1


def test_statement_routes_unauthorized_and_forbidden(app_client, employee_cookies):
    """Verify unauthorized and non-admin forbidden access."""
    resp = app_client.get("/api/finance/statements/1/lines")
    assert resp.status_code == 401

    resp = app_client.get("/api/finance/statements/1/lines", cookies=employee_cookies)
    assert resp.status_code == 403
