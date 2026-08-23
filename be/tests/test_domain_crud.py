"""
test_domain_crud.py
Comprehensive functional integration tests covering domain CRUD, action synchronization,
and edge cases across Bank Accounts, Insurance Categories & Claims, Vacations,
Employee Notes & Documents, and Document Hub (Company Documents).
"""
import base64
import pytest


def _valid_pdf_data_url():
    return "data:application/pdf;base64," + base64.b64encode(b"%PDF-1.4\ntest content").decode()


def _valid_png_data_url():
    # 1x1 PNG data URL
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode()


# ==============================================================================
# Bank Account Tests
# ==============================================================================

def test_bank_account_not_found_returns_has_details_false(app_client, admin_cookies):
    res = app_client.get("/api/employees/2/bank-account", cookies=admin_cookies)
    assert res.status_code == 200
    assert res.json() == {"has_details": False}


def test_bank_account_create_and_read_masked_and_revealed(app_client, admin_cookies, fake_sheets_client):
    payload = {"bank_name": "HSBC Egypt", "iban": "EG12345678901234567890", "swift_code": "HSBCEGCX"}
    create_res = app_client.put("/api/employees/2/bank-account", json=payload, cookies=admin_cookies)
    assert create_res.status_code == 200
    assert create_res.json()["message"] == "Bank account saved"

    # Read masked (default)
    get_res = app_client.get("/api/employees/2/bank-account", cookies=admin_cookies)
    assert get_res.status_code == 200
    data = get_res.json()
    assert data["has_details"] is True
    assert data["bank_name"] == "HSBC Egypt"
    assert data["iban"] == "*" * 18 + "7890"
    assert data["swift_code"] == "HSBCEGCX"

    # Read revealed
    get_rev = app_client.get("/api/employees/2/bank-account?reveal=true", cookies=admin_cookies)
    assert get_rev.status_code == 200
    assert get_rev.json()["iban"] == "EG12345678901234567890"


def test_bank_account_update_existing(app_client, admin_cookies):
    payload1 = {"bank_name": "HSBC Egypt", "iban": "EG11111111111111111111"}
    app_client.put("/api/employees/2/bank-account", json=payload1, cookies=admin_cookies)

    payload2 = {"bank_name": "CIB Egypt", "iban": "EG22222222222222222222", "swift_code": "CIBEEGCX"}
    update_res = app_client.put("/api/employees/2/bank-account", json=payload2, cookies=admin_cookies)
    assert update_res.status_code == 200

    get_rev = app_client.get("/api/employees/2/bank-account?reveal=true", cookies=admin_cookies)
    assert get_rev.json()["bank_name"] == "CIB Egypt"
    assert get_rev.json()["iban"] == "EG22222222222222222222"


def test_bank_account_upsert_unknown_employee_returns_404(app_client, admin_cookies):
    res = app_client.put("/api/employees/999/bank-account", json={"bank_name": "Bank", "iban": "123"}, cookies=admin_cookies)
    assert res.status_code == 404


# ==============================================================================
# Insurance Categories & Claims Tests
# ==============================================================================

def test_insurance_categories_crud(app_client, admin_cookies):
    # List initial
    res = app_client.get("/api/insurance/categories", cookies=admin_cookies)
    assert res.status_code == 200
    initial_count = len(res.json())

    # Create new
    cat_payload = {"name": "Physiotherapy", "annual_limit": 3000}
    create_res = app_client.post("/api/insurance/categories", json=cat_payload, cookies=admin_cookies)
    assert create_res.status_code == 201
    cat_id = create_res.json()["id"]

    # Duplicate create fails
    dup_res = app_client.post("/api/insurance/categories", json=cat_payload, cookies=admin_cookies)
    assert dup_res.status_code == 400

    # Update
    update_res = app_client.put(f"/api/insurance/categories/{cat_id}", json={"annual_limit": 4500}, cookies=admin_cookies)
    assert update_res.status_code == 200

    # Verify update
    list_res = app_client.get("/api/insurance/categories", cookies=admin_cookies)
    updated = next(c for c in list_res.json() if c["id"] == cat_id)
    assert updated["annual_limit"] == 4500.0

    # Delete
    del_res = app_client.delete(f"/api/insurance/categories/{cat_id}", cookies=admin_cookies)
    assert del_res.status_code == 200

    # Delete again 404
    del_res2 = app_client.delete(f"/api/insurance/categories/{cat_id}", cookies=admin_cookies)
    assert del_res2.status_code == 404


def test_submit_claim_and_action_sync_with_requests(app_client, employee_cookies, admin_cookies, fake_sheets_client):
    # Employee submits claim
    claim_payload = {
        "employee_name": "Employee Two",
        "category": "Dental",
        "provider": "Cairo Dental Clinic",
        "amount": 1500,
        "document_url": _valid_pdf_data_url(),
    }
    res = app_client.post("/api/insurance/claims", json=claim_payload, cookies=employee_cookies)
    assert res.status_code == 201
    claim_id = res.json()["id"]

    # Check both InsuranceClaims and Requests have entries
    claims = fake_sheets_client.get_all_records("InsuranceClaims")
    claim_row = next(c for c in claims if c["id"] == claim_id)
    assert claim_row["status"] == "Pending"
    assert claim_row["amount"] == 1500

    requests = fake_sheets_client.get_all_records("Requests")
    req_row = next(r for r in requests if r["employee_id"] == 2 and r["type"] == "Medical Insurance")
    assert req_row["status"] == "Pending"

    # Admin actions claim -> Approved
    action_res = app_client.post(f"/api/insurance/claims/{claim_id}/action", json={"status": "Approved"}, cookies=admin_cookies)
    assert action_res.status_code == 200

    # Verify claim is Approved
    claims_after = fake_sheets_client.get_all_records("InsuranceClaims")
    assert next(c for c in claims_after if c["id"] == claim_id)["status"] == "Approved"

    # Verify linked Request is also Approved
    requests_after = fake_sheets_client.get_all_records("Requests")
    assert next(r for r in requests_after if r["id"] == req_row["id"])["status"] == "Approved"


def test_submit_claim_unknown_category_rejected(app_client, employee_cookies):
    res = app_client.post("/api/insurance/claims", json={
        "employee_name": "Employee Two", "category": "NonExistentCategory", "amount": 500
    }, cookies=employee_cookies)
    assert res.status_code == 400


# ==============================================================================
# Vacation Tests
# ==============================================================================

def test_submit_vacation_request_and_action_sync(app_client, employee_cookies, admin_cookies, fake_sheets_client):
    vac_payload = {
        "employee_name": "Employee Two",
        "leave_type": "Annual Leave",
        "start_date": "2026-09-01",
        "end_date": "2026-09-05",
        "days": 5,
    }
    res = app_client.post("/api/vacations/request", json=vac_payload, cookies=employee_cookies)
    assert res.status_code == 201
    vac_id = res.json()["id"]

    # Verify VacationHistory and Requests
    vacs = fake_sheets_client.get_all_records("VacationHistory")
    vac_row = next(v for v in vacs if v["id"] == vac_id)
    assert vac_row["status"] == "Pending"

    requests = fake_sheets_client.get_all_records("Requests")
    req_row = next(r for r in requests if r["employee_id"] == 2 and r["type"] == "Vacation")
    assert req_row["status"] == "Pending"

    # Admin actions request -> Approved
    act_res = app_client.post(f"/api/requests/{req_row['id']}/action", json={"status": "Approved"}, cookies=admin_cookies)
    assert act_res.status_code == 200

    # Verify VacationHistory synced
    vacs_after = fake_sheets_client.get_all_records("VacationHistory")
    assert next(v for v in vacs_after if v["id"] == vac_id)["status"] == "Approved"


# ==============================================================================
# Employee Notes Tests
# ==============================================================================

def test_employee_notes_crud(app_client, admin_cookies):
    # Add note
    create_res = app_client.post("/api/employees/2/notes", json={
        "category": "Performance", "note": "Great quarterly review"
    }, cookies=admin_cookies)
    assert create_res.status_code == 201
    note_id = create_res.json()["id"]

    # List notes
    list_res = app_client.get("/api/employees/2/notes", cookies=admin_cookies)
    assert list_res.status_code == 200
    assert any(n["id"] == note_id and n["note"] == "Great quarterly review" for n in list_res.json())

    # Delete note
    del_res = app_client.delete(f"/api/employees/notes/{note_id}", cookies=admin_cookies)
    assert del_res.status_code == 200

    # Delete again 404
    del_res2 = app_client.delete(f"/api/employees/notes/{note_id}", cookies=admin_cookies)
    assert del_res2.status_code == 404


# ==============================================================================
# Document Hub (Company Documents) Tests
# ==============================================================================

def test_company_documents_lifecycle(app_client, admin_cookies, employee_cookies):
    # Admin uploads document
    upload_payload = {
        "name": "Employee Handbook 2026",
        "file_type": "pdf",
        "category": "Handbook",
        "data_url": _valid_pdf_data_url(),
    }
    upload_res = app_client.post("/api/company-documents", json=upload_payload, cookies=admin_cookies)
    assert upload_res.status_code == 201
    doc_id = upload_res.json()["id"]

    # Employee lists documents
    list_res = app_client.get("/api/company-documents", cookies=employee_cookies)
    assert list_res.status_code == 200
    docs = list_res.json()
    assert any(d["id"] == str(doc_id) and d["name"] == "Employee Handbook 2026" for d in docs)

    # Stream document
    stream_res = app_client.get(f"/api/company-documents/{doc_id}/stream", cookies=employee_cookies)
    assert stream_res.status_code == 200
    assert stream_res.content == b"fake file bytes"

    # Non-admin delete is 403
    emp_del = app_client.delete(f"/api/company-documents/{doc_id}", cookies=employee_cookies)
    assert emp_del.status_code == 403

    # Admin delete
    admin_del = app_client.delete(f"/api/company-documents/{doc_id}", cookies=admin_cookies)
    assert admin_del.status_code == 200

    # Stream after delete is 404
    stream_404 = app_client.get(f"/api/company-documents/{doc_id}/stream", cookies=employee_cookies)
    assert stream_404.status_code == 404
