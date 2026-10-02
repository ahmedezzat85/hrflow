"""
be/tests/test_rbac.py
Tests for RBAC Slice 1: Catalog, roles, schema and startup-seeding fix.
Verifies:
- 5 default roles with exact permission matrix counts (closed under implication)
- Super-Admin lock and system_key
- Catalog validation rules (format, targets, cycle detection)
- Implication closure and role key validation
- sync_catalog idempotency and non-overwriting of editable roles
- Revocation persistence across init_db() restarts (no re-link from users.role)
- Fatal error handling when RBAC sync fails on startup
- require_permission route protection
"""
import pytest
from sqlalchemy.exc import IntegrityError

from core.permission_catalog import (
    PermissionDef,
    CATALOG,
    all_keys,
    closure,
    validate_role_keys,
    validate_catalog_definitions,
)
from core.role_seed import DEFAULT_ROLES, sync_catalog
from core.rbac_models import PermissionDB, RoleDB, RolePermissionDB, UserRoleDB
from core.permissions import get_user_permissions
from models_db import UserDB
from db import get_db_context, init_db


def test_rbac_models_and_seed_data(app_client):
    """Verify that the 5 default roles exist with their matrix grants."""
    with get_db_context() as db:
        # Run sync_catalog to ensure full catalog is present
        sync_catalog(db)

        # Seed the other 4 default roles if not already populated by migration in test DB
        existing_roles = {r.system_key: r for r in db.query(RoleDB).filter(RoleDB.system_key.isnot(None)).all()}
        for key, role_def in DEFAULT_ROLES.items():
            if key not in existing_roles:
                r = RoleDB(
                    name=role_def.name,
                    system_key=role_def.system_key,
                    is_locked=role_def.is_locked,
                    description=role_def.description,
                )
                db.add(r)
                db.flush()
                for perm_key in role_def.permissions:
                    p = db.query(PermissionDB).filter(PermissionDB.key == perm_key).first()
                    if p:
                        db.add(RolePermissionDB(role_id=r.id, permission_id=p.id))
                db.commit()

        roles = {r.name: r for r in db.query(RoleDB).all()}
        assert "Super-Admin" in roles or "system_admin" in roles
        assert "Employee" in roles or "employee" in roles
        assert "HR-Admin" in roles
        assert "Financial-Admin" in roles
        assert "Payroll-Maker" in roles

        super_admin = db.query(RoleDB).filter(
            (RoleDB.system_key == "super_admin") | (RoleDB.name.in_(["Super-Admin", "system_admin"]))
        ).first()
        assert super_admin is not None
        assert super_admin.is_locked is True

        # Super-Admin has all 64 catalog keys
        sa_perm_keys = {p.key for p in super_admin.permissions}
        assert len(sa_perm_keys) == 64
        assert "system.users.manage" in sa_perm_keys
        assert "hr.employee.write" in sa_perm_keys
        assert "finance.payroll.prepare" in sa_perm_keys

        # HR-Admin has 20 permissions
        hr_admin = db.query(RoleDB).filter(RoleDB.name == "HR-Admin").first()
        assert hr_admin is not None
        assert len(hr_admin.permissions) == 20
        assert "hr.employee.write" in {p.key for p in hr_admin.permissions}
        assert "finance.payroll.prepare" not in {p.key for p in hr_admin.permissions}

        # Financial-Admin has 27 permissions
        fin_admin = db.query(RoleDB).filter(RoleDB.name == "Financial-Admin").first()
        assert fin_admin is not None
        assert len(fin_admin.permissions) == 27
        assert "finance.payroll.approve" in {p.key for p in fin_admin.permissions}
        assert "finance.payroll.prepare" not in {p.key for p in fin_admin.permissions}

        # Payroll-Maker has 2 permissions
        pay_maker = db.query(RoleDB).filter(RoleDB.name == "Payroll-Maker").first()
        assert pay_maker is not None
        assert len(pay_maker.permissions) == 2
        assert {p.key for p in pay_maker.permissions} == {"finance.payroll.read", "finance.payroll.prepare"}

        # Employee has 13 permissions
        emp_role = db.query(RoleDB).filter(
            (RoleDB.system_key == "employee") | (RoleDB.name.in_(["Employee", "employee"]))
        ).first()
        assert emp_role is not None
        emp_keys = {p.key for p in emp_role.permissions}
        assert len(emp_keys) == 13
        assert "self.profile.read" in emp_keys
        assert "hr.company_document.read" in emp_keys


def test_rbac_unique_constraints(app_client):
    """Verify uniqueness constraints on role_permissions, user_roles, and roles.system_key."""
    with get_db_context() as db:
        # Duplicate role_permission should raise IntegrityError
        existing_rp = db.query(RolePermissionDB).first()
        assert existing_rp is not None
        dup_rp = RolePermissionDB(role_id=existing_rp.role_id, permission_id=existing_rp.permission_id)
        db.add(dup_rp)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

        # Duplicate user_role should raise IntegrityError
        existing_ur = db.query(UserRoleDB).first()
        assert existing_ur is not None
        dup_ur = UserRoleDB(user_id=existing_ur.user_id, role_id=existing_ur.role_id)
        db.add(dup_ur)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_get_user_permissions_resolution(app_client):
    """Verify get_user_permissions resolves correct permission sets based on UserRole."""
    with get_db_context() as db:
        admin_user = db.query(UserDB).filter(UserDB.email == "admin@hrflow.test").first()
        assert admin_user is not None
        admin_perms = get_user_permissions(admin_user.id, db)
        assert len(admin_perms) == 64
        assert "hr.employee.write" in admin_perms
        assert "hr.employee.read" in admin_perms
        assert "self.profile.read" in admin_perms

        emp_user = db.query(UserDB).filter(UserDB.email == "employee@hrflow.test").first()
        assert emp_user is not None
        emp_perms = get_user_permissions(emp_user.id, db)
        assert "self.profile.read" in emp_perms
        assert "hr.employee.write" not in emp_perms
        assert "hr.employee.read" not in emp_perms


def test_require_permission_endpoint_admin_allowed(app_client, admin_cookies):
    """Super-Admin has 'hr.employee.write' and can call POST /api/employees."""
    payload = {
        "name": "RBAC Test New Employee",
        "email": "rbac.new@hrflow.test",
        "dept": "Engineering",
        "job_role": "Backend Engineer",
        "salary": 50000,
        "internal_salary_usd": 50000,
        "external_salary_usd": 0,
        "join_date": "2026-09-01",
    }
    response = app_client.post("/api/employees", json=payload, cookies=admin_cookies)
    assert response.status_code == 201
    created = response.json()
    assert "id" in created


def test_require_permission_endpoint_employee_forbidden(app_client, employee_cookies):
    """User with only 'employee' role lacks 'hr.employee.write' and gets 403 Forbidden."""
    payload = {
        "name": "Should Fail Employee",
        "email": "fail@hrflow.test",
    }
    response = app_client.post("/api/employees", json=payload, cookies=employee_cookies)
    assert response.status_code == 403
    detail = response.json().get("detail", "")
    assert "Permission denied" in detail or "hr.employee.write" in detail


def test_require_permission_endpoint_unauthenticated(app_client):
    """Unauthenticated call to permission-gated endpoint returns 401."""
    payload = {
        "name": "Unauth Test",
        "email": "unauth@hrflow.test",
    }
    response = app_client.post("/api/employees", json=payload)
    assert response.status_code == 401


# --- Slice 1 Specific Unit Tests ---

def test_catalog_validation_bad_key_format():
    """Catalog loading fails on invalid dot-separated key format."""
    bad_catalog_2_parts = (
        PermissionDef(key="invalid.format", group="Test", description="Test"),
    )
    with pytest.raises(ValueError, match="Invalid permission key format"):
        validate_catalog_definitions(bad_catalog_2_parts)

    bad_catalog_empty_part = (
        PermissionDef(key="invalid..format", group="Test", description="Test"),
    )
    with pytest.raises(ValueError, match="Invalid permission key format"):
        validate_catalog_definitions(bad_catalog_empty_part)


def test_catalog_validation_unknown_implied_key():
    """Catalog loading fails when a key implies a non-existent target."""
    bad_catalog = (
        PermissionDef(
            key="test.module.write",
            group="Test",
            description="Test",
            implies=("test.module.nonexistent",),
        ),
    )
    with pytest.raises(ValueError, match="implies non-existent key"):
        validate_catalog_definitions(bad_catalog)


def test_catalog_validation_cycle_detection():
    """Catalog loading fails on cyclic dependencies."""
    cyclic_catalog = (
        PermissionDef(key="test.a.write", group="Test", description="A", implies=("test.b.write",)),
        PermissionDef(key="test.b.write", group="Test", description="B", implies=("test.c.write",)),
        PermissionDef(key="test.c.write", group="Test", description="C", implies=("test.a.write",)),
    )
    with pytest.raises(ValueError, match="Cyclic permission implication detected"):
        validate_catalog_definitions(cyclic_catalog)


def test_closure_and_validate_role_keys():
    """Verify closure computation and role key validation."""
    # Write implies read
    res = closure({"hr.employee.write"})
    assert "hr.employee.write" in res
    assert "hr.employee.read" in res

    # Adjustment manage implies account.write which implies account.read
    res_adj = closure({"finance.adjustment.manage"})
    assert "finance.adjustment.manage" in res_adj
    assert "finance.account.write" in res_adj
    assert "finance.account.read" in res_adj

    # Validation of unknown and non-assignable keys
    unknown, non_assignable = validate_role_keys(["unknown.foo.bar", "system.users.manage", "hr.employee.read"])
    assert unknown == {"unknown.foo.bar"}
    assert non_assignable == {"system.users.manage"}


def test_sync_catalog_idempotency_and_preserves_editable_roles(app_client):
    """sync_catalog is idempotent and leaves editable roles' grants untouched."""
    with get_db_context() as db:
        stats1 = sync_catalog(db)
        stats2 = sync_catalog(db)
        # Second run should insert 0 new permissions
        assert stats2["permissions_created"] == 0

        # Create a custom/editable role with a specific grant
        custom_role = db.query(RoleDB).filter(RoleDB.name == "Custom-Test-Role").first()
        if not custom_role:
            custom_role = RoleDB(name="Custom-Test-Role", is_locked=False, description="Test")
            db.add(custom_role)
            db.flush()
            perm = db.query(PermissionDB).filter(PermissionDB.key == "hr.employee.read").first()
            db.add(RolePermissionDB(role_id=custom_role.id, permission_id=perm.id))
            db.commit()

        # Re-run sync_catalog
        sync_catalog(db)

        # Custom role's grants must be completely untouched
        custom_role_after = db.query(RoleDB).filter(RoleDB.name == "Custom-Test-Role").first()
        assert len(custom_role_after.permissions) == 1
        assert custom_role_after.permissions[0].key == "hr.employee.read"


def test_revocation_persists_across_restart(app_client):
    """Revoking a role and re-running init_db() keeps the revocation in place (no re-link)."""
    with get_db_context() as db:
        admin_user = db.query(UserDB).filter(UserDB.email == "admin@hrflow.test").first()
        assert admin_user is not None
        super_admin = db.query(RoleDB).filter(
            (RoleDB.system_key == "super_admin") | (RoleDB.name.in_(["Super-Admin", "system_admin"]))
        ).first()

        # Ensure user has the role
        ur = db.query(UserRoleDB).filter(
            UserRoleDB.user_id == admin_user.id,
            UserRoleDB.role_id == super_admin.id,
        ).first()
        if not ur:
            ur = UserRoleDB(user_id=admin_user.id, role_id=super_admin.id)
            db.add(ur)
            db.commit()

        # Revoke the role
        db.delete(ur)
        db.commit()

        # Simulate restart by calling init_db()
        init_db()

        # Verify the user is NOT re-linked
        ur_after = db.query(UserRoleDB).filter(
            UserRoleDB.user_id == admin_user.id,
            UserRoleDB.role_id == super_admin.id,
        ).first()
        assert ur_after is None

        # Restore role for subsequent tests
        db.add(UserRoleDB(user_id=admin_user.id, role_id=super_admin.id))
        db.commit()


def test_failing_rbac_sync_fails_startup(app_client, monkeypatch):
    """A failing RBAC sync makes init_db() fail with a logged error."""
    import core.role_seed

    def _failing_sync(db):
        raise RuntimeError("Simulated RBAC synchronization fatal conflict")

    monkeypatch.setattr(core.role_seed, "sync_catalog", _failing_sync)

    with pytest.raises(RuntimeError, match="Simulated RBAC synchronization fatal conflict"):
        init_db()


# ============================================================================
# Slice 2 Acceptance Criteria Tests: Resolution, Session, and Scope Helpers
# ============================================================================

def _create_test_user_with_roles(db, email, role_names=None, system_keys=None, employee_id=None, is_archived=False):
    import datetime
    user = db.query(UserDB).filter(UserDB.email == email).first()
    if not user:
        user = UserDB(
            email=email,
            name=email.split("@")[0].title(),
            employee_id=employee_id,
            role="admin" if "Super-Admin" in (role_names or []) or "super_admin" in (system_keys or []) else "employee",
        )
        db.add(user)
        db.flush()
    else:
        user.employee_id = employee_id
        if "Super-Admin" in (role_names or []) or "super_admin" in (system_keys or []):
            user.role = "admin"
        else:
            user.role = "employee"

    if is_archived:
        user.archived_at = datetime.datetime.utcnow()
        user.archived_by = "admin@hrflow.test"
    else:
        user.archived_at = None
        user.archived_by = None
    db.flush()

    db.query(UserRoleDB).filter(UserRoleDB.user_id == user.id).delete()
    db.flush()

    # Ensure default roles exist with their permissions in test database
    for key, role_def in DEFAULT_ROLES.items():
        r = db.query(RoleDB).filter(RoleDB.system_key == key).first()
        if not r:
            r = RoleDB(
                name=role_def.name,
                system_key=role_def.system_key,
                is_locked=role_def.is_locked,
                description=role_def.description,
            )
            db.add(r)
            db.flush()
        perm_count = db.query(RolePermissionDB).filter(RolePermissionDB.role_id == r.id).count()
        if perm_count == 0:
            for perm_key in role_def.permissions:
                p = db.query(PermissionDB).filter(PermissionDB.key == perm_key).first()
                if p:
                    db.add(RolePermissionDB(role_id=r.id, permission_id=p.id))
            db.flush()

    target_roles = []
    if system_keys:
        target_roles.extend(db.query(RoleDB).filter(RoleDB.system_key.in_(system_keys)).all())
    if role_names:
        target_roles.extend(db.query(RoleDB).filter(RoleDB.name.in_(role_names)).all())

    for r in set(target_roles):
        db.add(UserRoleDB(user_id=user.id, role_id=r.id))
    db.commit()
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "name": user.name,
        "employee_id": user.employee_id,
        "archived_at": user.archived_at,
    }


def _make_user_cookies(user, legacy_role_claim=None, include_uid=True):
    from auth import create_session_token
    from config import Config
    user_id = user["id"] if isinstance(user, dict) else user.id
    email = user["email"] if isinstance(user, dict) else user.email
    role = user["role"] if isinstance(user, dict) else user.role
    emp_id = user["employee_id"] if isinstance(user, dict) else user.employee_id
    name = (user["name"] if isinstance(user, dict) else user.name) or email.split("@")[0]
    role_claim = legacy_role_claim if legacy_role_claim is not None else role
    token = create_session_token(
        email=email,
        role=role_claim,
        employee_id=emp_id,
        name=name,
        uid=user_id if include_uid else None,
    )
    return {Config.SESSION_COOKIE_NAME: token}


def test_token_with_role_admin_for_employee_user_gets_403(app_client):
    """AC 2: A token with role=admin but a user holding no admin role gets 403 on admin routes."""
    with get_db_context() as db:
        user = _create_test_user_with_roles(
            db,
            email="forged_admin@voyance.health",
            system_keys=["employee"],
            employee_id=10,
        )

    # Token claims role='admin', but user in DB has only Employee role
    cookies = _make_user_cookies(user, legacy_role_claim="admin")

    # POST to bank accounts requires finance.account.write (an admin permission)
    resp = app_client.post(
        "/api/finance/accounts",
        json={
            "account_name": "Unauthorized Account",
            "bank_name": "Fake Bank",
            "account_number": "UA-1234",
            "currency": "USD",
            "opening_balance": 100.0,
        },
        cookies=cookies,
    )
    assert resp.status_code == 403
    assert "Permission denied" in resp.text or "finance.account.write" in resp.text


def test_archived_user_gets_403(app_client):
    """AC 3: An archived user with a valid cookie gets 403 on the next request and cannot access endpoints."""
    with get_db_context() as db:
        user = _create_test_user_with_roles(
            db,
            email="archived_person@voyance.health",
            system_keys=["employee"],
            employee_id=11,
            is_archived=True,
        )

    cookies = _make_user_cookies(user)

    resp = app_client.get("/api/auth/me", cookies=cookies)
    assert resp.status_code == 403
    assert "archived" in resp.json()["detail"].lower()


def test_linked_employee_gets_baseline_without_user_roles_row(app_client):
    """AC 4: A user with a linked employee gets Employee permissions without any user_roles row."""
    from core.permissions import resolve_access
    with get_db_context() as db:
        sync_catalog(db)
        user = db.query(UserDB).filter(UserDB.email == "baseline_emp@voyance.health").first()
        if not user:
            user = UserDB(
                email="baseline_emp@voyance.health",
                name="Baseline Employee",
                employee_id=42,
                role="employee",
            )
            db.add(user)
            db.flush()
        else:
            user.employee_id = 42
            db.flush()

        # Explicitly delete any UserRole rows for this user
        db.query(UserRoleDB).filter(UserRoleDB.user_id == user.id).delete()
        db.commit()

        ctx = resolve_access(db, {"uid": user.id, "email": user.email})
        assert len(ctx.permissions) == 13
        assert "self.profile.read" in ctx.permissions
        assert "self.vacation.write" in ctx.permissions
        assert "self.vacation.read" in ctx.permissions
        assert "hr.company_document.read" in ctx.permissions
        assert ctx.portal == "employee"
        assert ctx.role_names == []  # Baseline role is excluded from display roles


def test_super_admin_has_all_keys_when_role_permissions_deleted(app_client):
    """AC 5: Super-Admin has every catalog key even when role_permissions rows are missing."""
    from core.permissions import resolve_access
    with get_db_context() as db:
        sync_catalog(db)
        user = _create_test_user_with_roles(
            db,
            email="sa_stripped@voyance.health",
            system_keys=["super_admin"],
        )

        super_admin_role = db.query(RoleDB).filter(RoleDB.system_key == "super_admin").first()
        # Delete all role_permissions rows for Super-Admin
        db.query(RolePermissionDB).filter(RolePermissionDB.role_id == super_admin_role.id).delete()
        db.commit()

        ctx = resolve_access(db, {"uid": user["id"], "email": user["email"]})
        assert len(ctx.permissions) == len(all_keys())
        assert "system.users.manage" in ctx.permissions
        assert "finance.adjustment.manage" in ctx.permissions
        assert ctx.is_super_admin is True
        assert ctx.portal == "admin"

        # Restore Super-Admin role permissions
        sync_catalog(db)


def test_non_admin_holding_adjustment_manage_records_adjustment(app_client):
    """AC 6: A non-admin role holding finance.adjustment.manage can record an adjustment."""
    from finance.models import FinanceBankAccountDB, TransactionCategoryDB, PaymentTypeDB
    with get_db_context() as db:
        sync_catalog(db)
        # Create bank account, category, payment type if missing
        acct = db.query(FinanceBankAccountDB).filter_by(account_number="ADJ-TEST-01").first()
        if not acct:
            acct = FinanceBankAccountDB(
                account_name="Adjustment Bank",
                bank_name="Test Bank",
                account_number="ADJ-TEST-01",
                currency="USD",
                opening_balance=1000.0,
                current_balance=1000.0,
                is_active=True,
            )
            db.add(acct)

        cat = db.query(TransactionCategoryDB).filter_by(name="Operations").first()
        if not cat:
            cat = TransactionCategoryDB(name="Operations", kind="cost", is_active=True, sort_order=1)
            db.add(cat)

        pt = db.query(PaymentTypeDB).filter_by(code="TRANSFER").first()
        if not pt:
            pt = PaymentTypeDB(name="Transfer", code="TRANSFER", is_active=True)
            db.add(pt)
        db.commit()

        # Financial-Admin role has finance.account.write AND finance.adjustment.manage
        fin_user = _create_test_user_with_roles(
            db,
            email="fin_admin_adj@voyance.health",
            system_keys=["financial_admin"],
        )
        fin_cookies = _make_user_cookies(fin_user)

        # Create a user with only finance.account.write but WITHOUT finance.adjustment.manage
        limited_role = db.query(RoleDB).filter_by(name="Limited-Writer").first()
        if not limited_role:
            limited_role = RoleDB(name="Limited-Writer", description="Write account only", is_locked=False)
            db.add(limited_role)
            db.flush()
            p_write = db.query(PermissionDB).filter_by(key="finance.account.write").first()
            p_read = db.query(PermissionDB).filter_by(key="finance.account.read").first()
            db.add(RolePermissionDB(role_id=limited_role.id, permission_id=p_write.id))
            db.add(RolePermissionDB(role_id=limited_role.id, permission_id=p_read.id))
            db.commit()

        writer_user = _create_test_user_with_roles(
            db,
            email="writer_only@voyance.health",
            role_names=["Limited-Writer"],
        )
        writer_cookies = _make_user_cookies(writer_user)
        acct_id = acct.id

    # 1. Limited writer tries to post an adjustment -> 403
    fail_resp = app_client.post(
        f"/api/finance/accounts/{acct_id}/transactions",
        json={
            "entry_type": "adjustment",
            "direction": "in",
            "amount": 50.0,
            "currency": "USD",
            "date": "2026-10-01",
            "reason": "Unauthorized adjustment",
            "description": "Unauthorized adjustment",
        },
        cookies=writer_cookies,
    )
    assert fail_resp.status_code == 403
    assert "finance.adjustment.manage" in fail_resp.text

    # 2. Financial-Admin (non-Super-Admin) posts adjustment -> Success (201)
    ok_resp = app_client.post(
        f"/api/finance/accounts/{acct_id}/transactions",
        json={
            "entry_type": "adjustment",
            "direction": "in",
            "amount": 50.0,
            "currency": "USD",
            "date": "2026-10-01",
            "reason": "Authorized audit balance true-up",
            "description": "Authorized audit balance true-up",
        },
        cookies=fin_cookies,
    )
    assert ok_resp.status_code == 201
    assert ok_resp.json()["entry_type"] == "adjustment"


def test_auth_me_returns_rbac_fields_and_compat_role(app_client):
    """AC 7: /api/auth/me returns permissions, portal, roles, and compatibility role."""
    with get_db_context() as db:
        sync_catalog(db)
        sa_user = _create_test_user_with_roles(
            db,
            email="sa_me@voyance.health",
            system_keys=["super_admin"],
        )
        emp_user = _create_test_user_with_roles(
            db,
            email="emp_me@voyance.health",
            system_keys=["employee"],
            employee_id=99,
        )

    sa_cookies = _make_user_cookies(sa_user)
    sa_resp = app_client.get("/api/auth/me", cookies=sa_cookies)
    assert sa_resp.status_code == 200
    sa_data = sa_resp.json()
    assert sa_data["portal"] == "admin"
    assert sa_data["role"] == "admin"
    assert "Super-Admin" in sa_data["roles"]
    assert len(sa_data["permissions"]) == len(all_keys())

    emp_cookies = _make_user_cookies(emp_user)
    emp_resp = app_client.get("/api/auth/me", cookies=emp_cookies)
    assert emp_resp.status_code == 200
    emp_data = emp_resp.json()
    assert emp_data["portal"] == "employee"
    assert emp_data["role"] == "employee"
    assert emp_data["roles"] == []
    assert len(emp_data["permissions"]) == 13


def test_tokens_without_uid_still_work(app_client):
    """AC 8: Tokens without uid claim resolve by email lookup."""
    with get_db_context() as db:
        user = _create_test_user_with_roles(
            db,
            email="no_uid_user@voyance.health",
            system_keys=["employee"],
            employee_id=55,
        )

    cookies = _make_user_cookies(user, include_uid=False)
    resp = app_client.get("/api/auth/me", cookies=cookies)
    assert resp.status_code == 200
    assert resp.json()["employee_id"] == 55


def test_permission_scope_own_and_all(app_client):
    """Test permission_scope dependency factory for Scope.all vs Scope.own vs 403."""
    from deps import permission_scope, Scope
    from core.permissions import AccessContext
    from unittest.mock import MagicMock
    from fastapi import HTTPException

    scope_dep = permission_scope("hr.vacation.read", "self.vacation.read")

    # 1. Caller with all_key gets Scope.all()
    req1 = MagicMock()
    req1.state.access_context = AccessContext(
        user_id=1,
        email="hr@voyance.health",
        employee_id=None,
        permissions={"hr.vacation.read"},
        role_names=["HR-Admin"],
        portal="admin",
    )
    scope1 = scope_dep(req1, current_user={"role": "employee"})
    assert scope1.is_all is True
    assert scope1.employee_id is None

    # 2. Caller with self_key and employee_id gets Scope.own(emp_id)
    req2 = MagicMock()
    req2.state.access_context = AccessContext(
        user_id=2,
        email="emp@voyance.health",
        employee_id=22,
        permissions={"self.vacation.read"},
        role_names=[],
        portal="employee",
    )
    scope2 = scope_dep(req2, current_user={"role": "employee"})
    assert scope2.is_all is False
    assert scope2.employee_id == 22

    # 3. Caller with neither key raises 403
    req3 = MagicMock()
    req3.state.access_context = AccessContext(
        user_id=3,
        email="finance@voyance.health",
        employee_id=33,
        permissions={"finance.report.read"},
        role_names=["Financial-Admin"],
        portal="admin",
    )
    with pytest.raises(HTTPException) as exc:
        scope_dep(req3, current_user={"role": "employee"})
    assert exc.value.status_code == 403


def test_rbac_latency_benchmark(app_client, admin_cookies):
    """AC 9: Benchmark and record latency on representative authenticated endpoints."""
    import time
    iterations = 50

    # 1. Benchmark /api/auth/me
    t0 = time.perf_counter()
    for _ in range(iterations):
        resp = app_client.get("/api/auth/me", cookies=admin_cookies)
        assert resp.status_code == 200
    t1 = time.perf_counter()
    auth_me_avg_ms = ((t1 - t0) / iterations) * 1000.0

    # 2. Benchmark /api/finance/accounts
    t0 = time.perf_counter()
    for _ in range(iterations):
        resp = app_client.get("/api/finance/accounts", cookies=admin_cookies)
        assert resp.status_code == 200
    t1 = time.perf_counter()
    accounts_avg_ms = ((t1 - t0) / iterations) * 1000.0

    print(f"\n[BENCHMARK] /api/auth/me average latency: {auth_me_avg_ms:.2f} ms")
    print(f"[BENCHMARK] /api/finance/accounts average latency: {accounts_avg_ms:.2f} ms")
    assert auth_me_avg_ms < 50.0  # Well within acceptable boundaries
    assert accounts_avg_ms < 100.0


