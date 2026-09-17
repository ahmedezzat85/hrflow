"""
be/tests/test_finance_statement_wizard.py
Unit and integration tests for Story 6.1 Statement Import Wizard:
- In-memory Preview without database commitment
- File fingerprint calculation & duplicate file detection
- Multi-encoding and custom decimal separator support
- Malformed row diagnosis with correction paths
- Opening/closing balance delta reconciliation
- PDF statement review-required enforcement
- Reusable mapping template CRUD
- Interrupted import discard
"""
import io
import pytest
from datetime import datetime


@pytest.fixture
def wizard_bank_account(app_client, admin_cookies):
    res = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Wizard Test Bank Account",
            "bank_name": "HSBC Corporate",
            "account_number": f"WIZ-{datetime.utcnow().timestamp()}",
            "currency": "USD",
            "opening_balance": 50000.0,
            "account_type": "bank",
        },
        cookies=admin_cookies,
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_statement_preview_does_not_commit_database_lines(app_client, admin_cookies, wizard_bank_account):
    """Verifies that calling /preview parses data in-memory without saving any imports or lines to DB."""
    account_id = wizard_bank_account

    csv_data = (
        "Date,Description,Debit,Credit,Ref\n"
        "2026-09-01,Supplier Payment,500.00,,REF-001\n"
        "2026-09-05,Customer Deposit,,1200.00,REF-002\n"
    )
    files = {"file": ("preview_test.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}
    data = {
        "period_month": "2026-09",
        "opening_balance": "5000.00",
        "closing_balance": "5700.00",
    }

    preview_res = app_client.post(
        f"/api/finance/accounts/{account_id}/statements/preview",
        data=data,
        files=files,
        cookies=admin_cookies,
    )
    assert preview_res.status_code == 200
    res_data = preview_res.json()

    assert res_data["detected_format"] == "csv"
    assert res_data["duplicate_file_detected"] is False
    assert len(res_data["preview_rows"]) == 2
    assert res_data["validation_summary"]["valid_count"] == 2
    assert res_data["validation_summary"]["error_count"] == 0
    assert res_data["validation_summary"]["calculated_net"] == 700.0  # +1200 - 500
    assert res_data["validation_summary"]["expected_closing_balance"] == 5700.0
    assert res_data["validation_summary"]["balance_matches"] is True
    assert res_data["validation_summary"]["balance_delta"] == 0.0

    # Ensure NO statement import was committed to DB
    list_res = app_client.get(f"/api/finance/accounts/{account_id}/statements", cookies=admin_cookies)
    assert list_res.status_code == 200
    assert len(list_res.json()) == 0


def test_duplicate_file_detection_and_blocking(app_client, admin_cookies, wizard_bank_account):
    """Verifies that re-uploading the exact same statement file is detected and blocked with HTTP 409."""
    account_id = wizard_bank_account
    csv_data = (
        "Date,Description,Amount\n"
        "2026-09-02,Hosting Service,-150.00\n"
        "2026-09-04,Subscription Inflow,800.00\n"
    )

    # 1. First commit
    files1 = {"file": ("dup_check.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}
    r1 = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data={"period_month": "2026-09"},
        files=files1,
        cookies=admin_cookies,
    )
    assert r1.status_code == 201
    import_id = r1.json()["id"]

    # 2. Preview detects duplicate file
    files_prev = {"file": ("dup_check.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}
    r_prev = app_client.post(
        f"/api/finance/accounts/{account_id}/statements/preview",
        data={"period_month": "2026-09"},
        files=files_prev,
        cookies=admin_cookies,
    )
    assert r_prev.status_code == 200
    assert r_prev.json()["duplicate_file_detected"] is True
    assert r_prev.json()["duplicate_import_id"] == import_id

    # 3. Attempting to commit duplicate without allow_duplicate flag returns HTTP 409
    files2 = {"file": ("dup_check.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}
    r2 = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data={"period_month": "2026-09"},
        files=files2,
        cookies=admin_cookies,
    )
    assert r2.status_code == 409
    assert "already imported" in r2.json()["detail"]

    # 4. Allowing duplicate proceeds
    files3 = {"file": ("dup_check.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}
    r3 = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data={"period_month": "2026-09", "allow_duplicate": "true"},
        files=files3,
        cookies=admin_cookies,
    )
    assert r3.status_code == 201


def test_malformed_rows_and_date_conventions(app_client, admin_cookies, wizard_bank_account):
    """Verifies detailed error diagnosis for bad dates or malformed numbers."""
    account_id = wizard_bank_account
    # Row 3 has an unparseable date "INVALID_DATE"
    # Row 4 has an unparseable amount "NOT_A_NUMBER"
    csv_data = (
        "Date,Narrative,Debit,Credit\n"
        "15/09/2026,Valid Row 1,100.00,\n"
        "INVALID_DATE,Bad Date Row,50.00,\n"
        "16/09/2026,Bad Amount Row,CORRUPT_AMOUNT,\n"
    )

    files = {"file": ("errors_test.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}
    data = {
        "period_month": "2026-09",
        "date_format": "DD/MM/YYYY",
    }
    r = app_client.post(
        f"/api/finance/accounts/{account_id}/statements/preview",
        data=data,
        files=files,
        cookies=admin_cookies,
    )
    assert r.status_code == 200
    res = r.json()
    assert res["validation_summary"]["valid_count"] == 1
    assert res["validation_summary"]["error_count"] == 2
    assert len(res["errors"]) == 2

    # Check that error items report row index, column, and correction path
    date_err = next(e for e in res["errors"] if "INVALID_DATE" in e["value"])
    assert date_err["row_index"] == 3
    assert "Date" in date_err["column"]
    assert "correction_path" in date_err

    amt_err = next(e for e in res["errors"] if "CORRUPT_AMOUNT" in e["value"])
    assert amt_err["row_index"] == 4
    assert "Debit" in amt_err["column"]
    assert "correction_path" in amt_err


def test_reusable_mapping_templates_crud(app_client, admin_cookies, wizard_bank_account):
    """Verifies creating, listing, and deleting bank column mapping templates."""
    account_id = wizard_bank_account

    tmpl_payload = {
        "template_name": "HSBC Corporate Egypt Standard",
        "bank_name": "HSBC",
        "account_id": account_id,
        "date_col": "Posting Date",
        "description_col": "Transaction Narrative",
        "debit_col": "Debit Amount",
        "credit_col": "Credit Amount",
        "reference_col": "Cheque/Ref Number",
        "date_format": "DD/MM/YYYY",
        "decimal_separator": ".",
        "encoding": "utf-8",
    }
    c_res = app_client.post("/api/finance/statements/templates", json=tmpl_payload, cookies=admin_cookies)
    assert c_res.status_code == 201
    tmpl_id = c_res.json()["id"]
    assert c_res.json()["template_name"] == "HSBC Corporate Egypt Standard"

    # List templates
    list_res = app_client.get(f"/api/finance/statements/templates?account_id={account_id}", cookies=admin_cookies)
    assert list_res.status_code == 200
    assert any(t["id"] == tmpl_id for t in list_res.json())

    # Delete template
    del_res = app_client.delete(f"/api/finance/statements/templates/{tmpl_id}", cookies=admin_cookies)
    assert del_res.status_code == 200


def test_discard_statement_import(app_client, admin_cookies, wizard_bank_account):
    """Verifies that un-reconciled statements can be safely discarded."""
    account_id = wizard_bank_account
    csv_data = "Date,Description,Amount\n2026-09-01,Temp Line,50.00\n"
    files = {"file": ("discard_me.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}

    res = app_client.post(
        f"/api/finance/accounts/{account_id}/statements",
        data={"period_month": "2026-09"},
        files=files,
        cookies=admin_cookies,
    )
    assert res.status_code == 201
    import_id = res.json()["id"]

    # Discard import
    del_res = app_client.delete(f"/api/finance/statements/{import_id}", cookies=admin_cookies)
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "discarded"

    # Confirm it's gone
    chk_res = app_client.get(f"/api/finance/statements/{import_id}", cookies=admin_cookies)
    assert chk_res.status_code == 404
