"""
be/tests/test_insurance_claim_payment_api.py
Slice 2 of the insurance claim payment link (D-053, proposed): POST /api/insurance/claims/{id}/pay and
/payment/reverse, their RBAC (hr.insurance.write AND finance.account.write), and the additive claim fields.
"""
import pytest

from bill_test_helpers import make_account
from conftest import create_test_user
from db import get_db_context
from finance.models import LedgerTransactionDB, PaymentTypeDB
from models_db import InsuranceClaimDB

OLD_CLAIM_FIELDS = {"id", "employee_id", "employee_name", "category", "provider", "amount", "date", "status", "document_url", "submitted_by"}
NEW_CLAIM_FIELDS = {"payment_status", "paid_at", "ledger_transaction_id"}


def _type_id(code="OUTBOUND_TRANS"):
    with get_db_context() as db:
        return db.query(PaymentTypeDB).filter(PaymentTypeDB.code == code).first().id


def _claim(amount=1500.0, date="2026-03-10", status="Approved"):
    with get_db_context() as db:
        c = InsuranceClaimDB(employee_id=2, employee_name="Employee 2", category="Dental", provider="Clinic", amount=amount, date=date, status=status)
        db.add(c)
        db.commit()
        return c.id


def _body(acc, **kw):
    return {"account_id": acc, "payment_type_id": _type_id(), "payment_date": "2026-05-01", **kw}


def _acc(client, cookies, n, currency="EGP"):
    return make_account(client, cookies, f"ClaimAPI {n}", number=f"CAPI-{n:04d}", balance=10000.0, currency=currency)


def _pay(client, cookies, cid, body):
    return client.post(f"/api/insurance/claims/{cid}/pay", json=body, cookies=cookies)


def _ledger_count():
    with get_db_context() as db:
        return db.query(LedgerTransactionDB).filter(LedgerTransactionDB.source.in_(("insurance_claim", "insurance_claim_reversal"))).count()


def test_pay_then_reverse_then_repay(app_client, admin_cookies):
    acc = _acc(app_client, admin_cookies, 1)
    cid = _claim()
    r = _pay(app_client, admin_cookies, cid, _body(acc, reference="REF-1"))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["payment_status"] == "paid" and out["ledger_transaction_id"] and out["paid_at"]

    row = next(c for c in app_client.get("/api/insurance/claims", cookies=admin_cookies).json() if c["id"] == cid)
    assert row["payment_status"] == "paid" and row["ledger_transaction_id"] == out["ledger_transaction_id"] and row["paid_at"]
    tx = app_client.get(f"/api/finance/accounts/{acc}/transactions", cookies=admin_cookies).json()
    assert any(t["id"] == out["ledger_transaction_id"] and t["source"] == "insurance_claim" and t["amount"] == 1500.0 for t in tx)

    rev = app_client.post(f"/api/insurance/claims/{cid}/payment/reverse", json={"reason": "Wrong account"}, cookies=admin_cookies)
    assert rev.status_code == 200, rev.text
    assert rev.json()["payment_status"] == "reversed" and rev.json()["payment_reversal_transaction_id"]

    again = _pay(app_client, admin_cookies, cid, _body(acc))
    assert again.status_code == 200 and again.json()["payment_status"] == "paid"
    assert again.json()["ledger_transaction_id"] != out["ledger_transaction_id"]
    assert _ledger_count() == 3


@pytest.mark.parametrize("make,expected_code,status", [
    (lambda: _claim(status="Pending"), "claim_not_approved", 409),
    (lambda: _claim(date="2025-12-31"), "claim_not_eligible", 409),
])
def test_refusals_are_409_with_a_code(app_client, admin_cookies, make, expected_code, status):
    acc = _acc(app_client, admin_cookies, 2)
    r = _pay(app_client, admin_cookies, make(), _body(acc))
    assert r.status_code == status and r.json()["detail"]["code"] == expected_code
    assert _ledger_count() == 0


def test_double_pay_is_409(app_client, admin_cookies):
    acc = _acc(app_client, admin_cookies, 3)
    cid = _claim()
    assert _pay(app_client, admin_cookies, cid, _body(acc)).status_code == 200
    again = _pay(app_client, admin_cookies, cid, _body(acc))
    assert again.status_code == 409 and again.json()["detail"]["code"] == "claim_already_paid" and _ledger_count() == 1


def test_404s_for_unknown_claim_and_account(app_client, admin_cookies):
    acc = _acc(app_client, admin_cookies, 4)
    r = _pay(app_client, admin_cookies, 999999, _body(acc))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "claim_not_found"
    r = _pay(app_client, admin_cookies, _claim(), _body(999999))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "account_not_found"
    r = app_client.post("/api/insurance/claims/999999/payment/reverse", json={"reason": "x"}, cookies=admin_cookies)
    assert r.status_code == 404


def test_400s_currency_payment_type_and_validation(app_client, admin_cookies):
    usd = _acc(app_client, admin_cookies, 5, currency="USD")
    egp = _acc(app_client, admin_cookies, 6)
    cid = _claim()
    r = _pay(app_client, admin_cookies, cid, _body(usd))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "currency_mismatch"
    r = _pay(app_client, admin_cookies, cid, _body(egp, payment_type_id=_type_id("CASH")))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "payment_type_not_allowed"
    assert _pay(app_client, admin_cookies, cid, {"account_id": egp}).status_code == 422             # payment type is required
    assert _pay(app_client, admin_cookies, cid, _body(egp, payment_date="05/01/2026")).status_code == 422
    assert _ledger_count() == 0


def test_reverse_needs_a_paid_claim_and_a_reason(app_client, admin_cookies):
    acc = _acc(app_client, admin_cookies, 7)
    cid = _claim()
    url = f"/api/insurance/claims/{cid}/payment/reverse"
    r = app_client.post(url, json={"reason": "x"}, cookies=admin_cookies)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "claim_not_paid"
    _pay(app_client, admin_cookies, cid, _body(acc))
    assert app_client.post(url, json={}, cookies=admin_cookies).status_code == 422
    r = app_client.post(url, json={"reason": "   "}, cookies=admin_cookies)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "reason_required"
    assert app_client.post(url, json={"reason": "ok"}, cookies=admin_cookies).status_code == 200
    assert app_client.post(url, json={"reason": "again"}, cookies=admin_cookies).status_code == 409


def test_403_unless_both_keys_are_held(app_client, admin_cookies, employee_cookies):
    acc = _acc(app_client, admin_cookies, 8)
    cid = _claim()
    hr_only = create_test_user("claim_hr_only@hrflow.test", role_key="hr_admin", employee_id=None)
    fin_only = create_test_user("claim_fin_only@hrflow.test", role_key="financial_admin", employee_id=None)
    for cookies in (hr_only, fin_only, employee_cookies):
        assert _pay(app_client, cookies, cid, _body(acc)).status_code == 403
        assert app_client.post(f"/api/insurance/claims/{cid}/payment/reverse", json={"reason": "x"}, cookies=cookies).status_code == 403
    assert _ledger_count() == 0
    assert app_client.post(f"/api/insurance/claims/{cid}/pay", json=_body(acc)).status_code in (401, 403)       # no session
    assert _pay(app_client, admin_cookies, cid, _body(acc)).status_code == 200                              # super admin holds both


def test_a_user_with_both_keys_can_pay(app_client, admin_cookies):
    from core.rbac_models import PermissionDB, RoleDB, RolePermissionDB, UserRoleDB
    from models_db import UserDB
    acc = _acc(app_client, admin_cookies, 9)
    cid = _claim()
    both = create_test_user("claim_both@hrflow.test", role_key=None, employee_id=None)
    with get_db_context() as db:
        role = RoleDB(name="Claim payer", system_key=None, description="test")
        db.add(role)
        db.flush()
        for key in ("hr.insurance.write", "finance.account.write"):
            db.add(RolePermissionDB(role_id=role.id, permission_id=db.query(PermissionDB).filter(PermissionDB.key == key).first().id))
        uid = db.query(UserDB).filter(UserDB.email == "claim_both@hrflow.test").first().id
        db.add(UserRoleDB(user_id=uid, role_id=role.id))
        db.commit()
    assert _pay(app_client, both, cid, _body(acc)).status_code == 200


def test_existing_claim_endpoints_keep_their_old_fields_and_add_only_the_payment_ones(app_client, admin_cookies, employee_cookies):
    created = app_client.post("/api/insurance/claims", json={"employee_name": "Employee Two", "category": "Dental", "provider": "Clinic",
                                                              "amount": 120, "record_date": "2026-02-02", "employee_id": 2, "status": "Approved"}, cookies=admin_cookies)
    assert created.status_code == 201 and set(created.json()) == {"message", "id"}
    cid = created.json()["id"]
    admin_row = next(c for c in app_client.get("/api/insurance/claims", cookies=admin_cookies).json() if c["id"] == cid)
    assert set(admin_row) == OLD_CLAIM_FIELDS | NEW_CLAIM_FIELDS
    assert {k: admin_row[k] for k in OLD_CLAIM_FIELDS} == {
        "id": cid, "employee_id": 2, "employee_name": "Employee Two", "category": "Dental", "provider": "Clinic", "amount": 120.0,
        "date": "2026-02-02", "status": "Approved", "document_url": "", "submitted_by": "admin@hrflow.test"}
    assert (admin_row["payment_status"], admin_row["paid_at"], admin_row["ledger_transaction_id"]) == ("unpaid", None, None)

    act = app_client.post(f"/api/insurance/claims/{cid}/action", json={"status": "Rejected"}, cookies=admin_cookies)
    assert act.status_code == 200 and act.json() == {"message": "Claim rejected"}


def test_an_employee_sees_the_payment_state_but_not_the_ledger_id(app_client, admin_cookies, employee_cookies):
    acc = _acc(app_client, admin_cookies, 10)
    cid = _claim()
    ledger_id = _pay(app_client, admin_cookies, cid, _body(acc)).json()["ledger_transaction_id"]
    mine = next(c for c in app_client.get("/api/insurance/claims", cookies=employee_cookies).json() if c["id"] == cid)
    assert mine["payment_status"] == "paid" and mine["paid_at"] and mine["ledger_transaction_id"] is None
    theirs = next(c for c in app_client.get("/api/insurance/claims", cookies=admin_cookies).json() if c["id"] == cid)
    assert theirs["ledger_transaction_id"] == ledger_id
