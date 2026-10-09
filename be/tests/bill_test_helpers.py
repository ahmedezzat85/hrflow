"""
be/tests/bill_test_helpers.py
Shared helpers for vendor-bill tests under the v2 status and approval model (D-016, D-017).

Status and approval fields are server-owned. A bill saved by a user holding finance.bill.approve
(including a super admin) is Approved and auto-approved; a bill saved by anyone else is a Draft that
goes through submit -> approve. The creator is always the logged-in user, so tests that need a
Draft use `make_maker()` (a finance user with create/edit only) and approve with the admin.
"""

import itertools
from datetime import date, timedelta

MAKER_EMAIL = "maker@hrflow.test"
_seq = itertools.count()


def _unique_issue_date():
    """Distinct issue dates keep same-vendor / same-amount helper bills from tripping duplicate detection."""
    return (date(2024, 1, 1) + timedelta(days=next(_seq))).strftime("%Y-%m-%d")


def make_vendor(client, cookies, name="Helper Vendor Co"):
    resp = client.post("/api/finance/vendors", json={"name": name, "category": "Operations"}, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def make_account(client, cookies, name="Helper Account", number="99887766", balance=100000.0, currency="USD"):
    resp = client.post(
        "/api/finance/accounts",
        json={
            "account_name": name,
            "bank_name": "Test Bank",
            "account_number": number,
            "currency": currency,
            "opening_balance": balance,
        },
        cookies=cookies,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def create_draft(client, cookies, vendor_id, bill_number, amount=1000.0, **extra):
    payload = {
        "vendor_id": vendor_id,
        "bill_number": bill_number,
        "issue_date": _unique_issue_date(),
        "due_date": "2026-09-30",
        "currency": "USD",
        "lines": [{"description": "Item", "quantity": 1, "unit_price": amount, "line_total": amount}],
    }
    payload.update(extra)
    resp = client.post("/api/finance/bills", json=payload, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()


def make_user(email, perms):
    """A user whose single custom role holds exactly `perms`; returns a session cookie dict."""
    import auth as auth_module
    import config as config_module
    from core.rbac_models import PermissionDB, RoleDB, RolePermissionDB, UserRoleDB
    from core.role_seed import sync_catalog
    from db import get_db_context
    from models_db import UserDB

    with get_db_context() as db:
        sync_catalog(db)
        role_name = f"Role-{email}"
        role = db.query(RoleDB).filter(RoleDB.name == role_name).first()
        if not role:
            role = RoleDB(name=role_name, is_locked=False, description="test role")
            db.add(role)
            db.flush()
        db.query(RolePermissionDB).filter(RolePermissionDB.role_id == role.id).delete()
        for key in perms:
            perm = db.query(PermissionDB).filter(PermissionDB.key == key).one()
            db.add(RolePermissionDB(role_id=role.id, permission_id=perm.id))
        user = db.query(UserDB).filter(UserDB.email == email).first()
        if not user:
            user = UserDB(email=email, name=email.split("@")[0])
            db.add(user)
            db.flush()
        db.query(UserRoleDB).filter(UserRoleDB.user_id == user.id).delete()
        db.add(UserRoleDB(user_id=user.id, role_id=role.id))
        db.commit()
        uid = user.id
    token = auth_module.create_session_token(email, employee_id=None, name=email.split("@")[0], uid=uid)
    return {config_module.Config.SESSION_COOKIE_NAME: token}


def make_maker(email=MAKER_EMAIL):
    """Finance user who can create and edit bills but not approve or pay."""
    return make_user(email, ["finance.bill.read", "finance.bill.write", "finance.vendor.read", "finance.account.write"])


def make_approver(email="approver@hrflow.test"):
    """Non-super-admin who can approve and pay bills."""
    return make_user(
        email,
        ["finance.bill.read", "finance.bill.write", "finance.bill.approve", "finance.bill.pay", "finance.vendor.read", "finance.account.write"],
    )


def create_approved(client, cookies, vendor_id, bill_number, amount=1000.0, **extra):
    """An Approved bill. `cookies` must belong to an approver or super admin (auto-approved on save)."""
    bill = create_draft(client, cookies, vendor_id, bill_number, amount, **extra)
    assert bill["status"] == "approved", bill
    return bill


def approve_existing(client, cookies, bill_id):
    """Return the bill as Approved: already auto-approved, or submit + approve (approver must differ from creator)."""
    cur = client.get(f"/api/finance/bills/{bill_id}", cookies=cookies).json()
    if cur["status"] == "approved":
        return cur
    if cur["status"] in ("draft", "rejected"):
        assert client.post(f"/api/finance/bills/{bill_id}/submit", cookies=cookies).status_code == 200
    resp = client.post(f"/api/finance/bills/{bill_id}/approve", json={"decision": "approve"}, cookies=cookies)
    assert resp.status_code == 200, resp.text
    return resp.json()


def payment_type_id(code="OUTBOUND_TRANS"):
    """Id of a seeded payment type: CASH, OUTBOUND_TRANS (Outgoing transfer), CHK (Cheque), DEBIT_CARD ..."""
    from db import get_db_context
    from finance.models import PaymentTypeDB

    with get_db_context() as db:
        return db.query(PaymentTypeDB).filter(PaymentTypeDB.code == code).one().id


def pay(client, cookies, bill_id, account_id, amount, date="2026-09-15", reference="PAY-REF", type_code="OUTBOUND_TRANS", **extra):
    payload = {
        "amount": amount,
        "payment_date": date,
        "bank_account_id": account_id,
        "payment_type_id": payment_type_id(type_code),
        "reference": reference,
    }
    payload.update(extra)
    return client.post(f"/api/finance/bills/{bill_id}/payments", json=payload, cookies=cookies)
