"""
be/tests/test_employee_personal.py

Slice S2 of plan 29 (decision D-036): legal name, phone, address and optional ID behind the
hr.employee_personal.* permissions, never returned by the list/detail endpoints, and used by the
salary payment documents.

Run:  cd be && python -m pytest tests/test_employee_personal.py -q
"""
from datetime import datetime

import pytest

from conftest import create_test_user
from core.rbac_models import PermissionDB, RoleDB, RolePermissionDB, UserRoleDB
from db import get_db_context
from employee_test_helpers import PERSONAL, set_pay
from models_db import AuditLogDB, EmployeeDB, UserDB
from services.employee_personal import mask_id, normalize_id, normalize_phone
from services.salary_payment_docs import (
    SalaryPaymentDocEligibilityError,
    build_template_context,
    check_eligibility,
)

_counter = [0]


def _payload(**overrides):
    _counter[0] += 1
    base = {
        **PERSONAL,
        "name": "Personal Test",
        "email": f"personal_{_counter[0]}_{int(datetime.utcnow().timestamp() * 1000)}@hrflow.test",
        "dept": "Engineering",
        "job_role": "Engineer",
        "internal_salary_usd": 0,
        "external_salary_usd": 0,
    }
    base.update(overrides)
    return base


def _create(app_client, admin_cookies, **overrides):
    resp = app_client.post("/api/employees", json=_payload(**overrides), cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------- pure validators

@pytest.mark.parametrize("raw,expected", [
    ("+20 100 123 4567", "+201001234567"),
    ("(010) 0123-4567", "01001234567"),
    ("  +1.555.010.2030 ", "+15550102030"),
    ("", None),
    (None, None),
])
def test_normalize_phone_accepts_and_cleans(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize("raw", ["abc", "12345", "+20 100 abc", "1" * 16])
def test_normalize_phone_rejects_non_numbers(raw):
    with pytest.raises(ValueError):
        normalize_phone(raw)


def test_normalize_id_national_id_needs_exactly_14_digits():
    assert normalize_id("national_id", "29001011234567") == ("national_id", "29001011234567")
    assert normalize_id("national_id", "2900 1011 2345 67") == ("national_id", "29001011234567")
    for bad in ("2900101123456", "290010112345678", "2900101123456A"):
        with pytest.raises(ValueError):
            normalize_id("national_id", bad)


def test_normalize_id_passport_allows_letters_and_is_uppercased():
    assert normalize_id("passport", "ab 123456") == ("passport", "AB123456")
    for bad in ("A1234", "A" * 13, "AB-12345"):
        with pytest.raises(ValueError):
            normalize_id("passport", bad)


def test_normalize_id_pair_rules():
    assert normalize_id(None, None) == (None, None)
    assert normalize_id("", "") == (None, None)
    with pytest.raises(ValueError):
        normalize_id(None, "29001011234567")          # a number needs a type
    with pytest.raises(ValueError):
        normalize_id("passport", None)                # a type needs a number
    with pytest.raises(ValueError):
        normalize_id("visa", "AB123456")              # unknown type


def test_mask_id_keeps_only_the_last_four():
    assert mask_id("29001011234567") == "**********4567"
    assert mask_id("ABC") == "***"
    assert mask_id(None) == ""


# ---------------------------------------------------------------- create

@pytest.mark.parametrize("missing", ["legal_name", "phone", "address_line_1"])
def test_create_requires_legal_name_phone_and_address_line_1(app_client, admin_cookies, missing):
    payload = _payload()
    payload.pop(missing)
    resp = app_client.post("/api/employees", json=payload, cookies=admin_cookies)
    assert resp.status_code == 422, resp.text


def test_create_rejects_blank_legal_name_and_bad_phone(app_client, admin_cookies):
    assert app_client.post("/api/employees", json=_payload(legal_name="   "), cookies=admin_cookies).status_code == 422
    assert app_client.post("/api/employees", json=_payload(phone="not-a-phone"), cookies=admin_cookies).status_code == 422


def test_create_stores_personal_details_and_normalises_them(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, phone="+20 100 123 4567", address_line_2="New Cairo",
                     id_type="passport", id_number="ab 123456")
    resp = app_client.get(f"/api/employees/{emp_id}/personal?reveal_id=true", cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    p = resp.json()
    assert p["legal_name"] == PERSONAL["legal_name"]
    assert p["phone"] == "+201001234567"
    assert (p["address_line_1"], p["address_line_2"]) == ("1 Test Street", "New Cairo")
    assert (p["id_type"], p["id_number"]) == ("passport", "AB123456")


def test_create_without_id_is_allowed_and_has_no_id(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies)
    p = app_client.get(f"/api/employees/{emp_id}/personal", cookies=admin_cookies).json()
    assert p["has_id"] is False and p["id_type"] == "" and p["id_number_masked"] == ""


def test_create_rejects_an_id_number_without_its_type(app_client, admin_cookies):
    resp = app_client.post("/api/employees", json=_payload(id_number="29001011234567"), cookies=admin_cookies)
    assert resp.status_code == 422


# ---------------------------------------------------------------- never in lists / detail

PERSONAL_KEYS = {"legal_name", "phone", "address_line_1", "address_line_2", "id_type", "id_number"}


def test_list_and_detail_never_return_personal_fields(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, id_type="national_id", id_number="29001011234567")
    listing = app_client.get("/api/employees", cookies=admin_cookies).json()
    assert all(not (PERSONAL_KEYS & set(row)) for row in listing)
    detail = app_client.get(f"/api/employees/{emp_id}", cookies=admin_cookies).json()
    assert not (PERSONAL_KEYS & set(detail))
    assert "29001011234567" not in str(listing) + str(detail)


def test_employee_self_service_cannot_read_personal_details(app_client, employee_cookies):
    assert app_client.get("/api/employees/2/personal", cookies=employee_cookies).status_code == 403
    assert app_client.put("/api/employees/2/personal", json={"phone": "+201001234567"},
                          cookies=employee_cookies).status_code == 403


def test_profile_update_no_longer_accepts_address_changes(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies)
    resp = app_client.put(f"/api/employees/{emp_id}", json={"address_line_1": "Changed St", "dept": "Design"},
                          cookies=admin_cookies)
    assert resp.status_code == 200
    p = app_client.get(f"/api/employees/{emp_id}/personal", cookies=admin_cookies).json()
    assert p["address_line_1"] == "1 Test Street"


# ---------------------------------------------------------------- personal endpoint

def test_get_personal_masks_the_id_by_default(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, id_type="national_id", id_number="29001011234567")
    p = app_client.get(f"/api/employees/{emp_id}/personal", cookies=admin_cookies).json()
    assert p["has_id"] is True
    assert p["id_number_masked"] == "**********4567"
    assert "id_number" not in p


def test_reveal_returns_the_number_and_is_audited(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, id_type="national_id", id_number="29001011234567")
    p = app_client.get(f"/api/employees/{emp_id}/personal?reveal_id=true", cookies=admin_cookies).json()
    assert p["id_number"] == "29001011234567"
    with get_db_context() as db:
        entries = db.query(AuditLogDB).filter(
            AuditLogDB.action == "employee.personal.reveal_id", AuditLogDB.target_id == str(emp_id)).count()
    assert entries == 1


def test_reveal_needs_the_reveal_permission(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, id_type="national_id", id_number="29001011234567")
    with get_db_context() as db:
        role = RoleDB(name="Personal-Reader-Test", is_locked=False, description="read only")
        db.add(role)
        db.flush()
        perm = db.query(PermissionDB).filter(PermissionDB.key == "hr.employee_personal.read").one()
        db.add(RolePermissionDB(role_id=role.id, permission_id=perm.id))
        db.commit()
        role_id = role.id
    cookies = create_test_user("personal_reader@hrflow.test", employee_id=None, name="Reader")
    with get_db_context() as db:
        user = db.query(UserDB).filter(UserDB.email == "personal_reader@hrflow.test").one()
        db.add(UserRoleDB(user_id=user.id, role_id=role_id))
        db.commit()

    masked = app_client.get(f"/api/employees/{emp_id}/personal", cookies=cookies)
    assert masked.status_code == 200 and "id_number" not in masked.json()
    denied = app_client.get(f"/api/employees/{emp_id}/personal?reveal_id=true", cookies=cookies)
    assert denied.status_code == 403
    # Read-only: it cannot change details either.
    assert app_client.put(f"/api/employees/{emp_id}/personal", json={"phone": "+201001234568"},
                          cookies=cookies).status_code == 403


def test_get_personal_for_unknown_employee_is_404(app_client, admin_cookies):
    assert app_client.get("/api/employees/999999/personal", cookies=admin_cookies).status_code == 404


def test_update_personal_changes_only_what_is_sent(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies, address_line_2="Old line 2")
    resp = app_client.put(f"/api/employees/{emp_id}/personal", json={"phone": "010 0123 4568"}, cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    p = resp.json()
    assert p["phone"] == "01001234568"
    assert p["legal_name"] == PERSONAL["legal_name"] and p["address_line_2"] == "Old line 2"


def test_update_personal_cannot_blank_required_fields(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies)
    for body in ({"legal_name": " "}, {"address_line_1": ""}, {"phone": "abc"}):
        assert app_client.put(f"/api/employees/{emp_id}/personal", json=body, cookies=admin_cookies).status_code == 422


def test_update_personal_sets_replaces_and_clears_the_id(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies)
    url = f"/api/employees/{emp_id}/personal"

    set_resp = app_client.put(url, json={"id_type": "passport", "id_number": "x1234567"}, cookies=admin_cookies)
    assert set_resp.status_code == 200 and set_resp.json()["has_id"] is True

    # A phone-only update leaves the ID alone.
    app_client.put(url, json={"phone": "+201001234569"}, cookies=admin_cookies)
    kept = app_client.get(url + "?reveal_id=true", cookies=admin_cookies).json()
    assert (kept["id_type"], kept["id_number"]) == ("passport", "X1234567")

    bad = app_client.put(url, json={"id_type": "national_id", "id_number": "123"}, cookies=admin_cookies)
    assert bad.status_code == 422

    cleared = app_client.put(url, json={"id_type": None, "id_number": None}, cookies=admin_cookies)
    assert cleared.status_code == 200 and cleared.json()["has_id"] is False


def test_audit_entries_for_personal_changes_hold_field_names_not_values(app_client, admin_cookies):
    emp_id = _create(app_client, admin_cookies)
    app_client.put(f"/api/employees/{emp_id}/personal", json={"phone": "+201001234570"}, cookies=admin_cookies)
    with get_db_context() as db:
        rows = db.query(AuditLogDB).filter(
            AuditLogDB.action == "employee.personal.update", AuditLogDB.target_id == str(emp_id)).all()
        details = " ".join(r.details or "" for r in rows)
    assert "phone" in details and "201001234570" not in details
    with get_db_context() as db:
        created = db.query(AuditLogDB).filter(
            AuditLogDB.action == "employee.create", AuditLogDB.target_id == str(emp_id)).one()
        assert PERSONAL["legal_name"] not in (created.details or "")


# ---------------------------------------------------------------- salary payment documents

def _doc_employee(**overrides):
    emp = {
        "id": 1, "name": "Laila Hassan", "external_salary_usd": 2000.0, "invoice_id": "02",
        "legal_name": "Laila Ahmed Hassan Ali", "address_line_1": "15 Example Street",
        "address_line_2": "New Cairo",
    }
    emp.update(overrides)
    return emp


def test_payment_doc_is_blocked_without_a_legal_name_and_never_falls_back_to_the_display_name():
    for missing in (None, "", "   "):
        with pytest.raises(SalaryPaymentDocEligibilityError, match="legal_name"):
            check_eligibility(_doc_employee(legal_name=missing))
    assert check_eligibility(_doc_employee()) == "02"


def test_payment_doc_template_prints_the_legal_name_and_both_address_lines():
    ctx = build_template_context(_doc_employee(), 2026, 8)
    assert ctx["employee_name"] == "Laila Ahmed Hassan Ali"
    assert ctx["employee_full_name"] == "Laila Ahmed Hassan Ali"
    assert ctx["address_line_1"] == "15 Example Street" and ctx["address_line_2"] == "New Cairo"
    assert "Laila Hassan" not in str(ctx)


def test_payment_doc_preview_reads_personal_details_and_flags_a_missing_legal_name(app_client, admin_cookies):
    ready = _create(app_client, admin_cookies, name="Doc Ready", invoice_id="07")
    legacy = _create(app_client, admin_cookies, name="Doc Legacy", invoice_id="08")
    for emp_id in (ready, legacy):
        set_pay(app_client, admin_cookies, emp_id, 0.0, 2000.0)
    with get_db_context() as db:   # a pre-D-036 row has no legal name
        db.query(EmployeeDB).filter(EmployeeDB.id == legacy).update({"legal_name": None})
        db.commit()

    resp = app_client.get("/api/invoices/eligible?payment_year=2026&payment_month=8", cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    rows = {r["employee_id"]: r for r in resp.json()["results"]}
    assert rows[ready]["status"] == "eligible"
    assert rows[legacy]["status"] == "skipped" and "legal_name" in rows[legacy]["reason"]
