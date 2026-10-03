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
from models_db import UserDB, EmployeeDB
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
        assert "Super-Admin" in roles
        assert "Employee" in roles
        assert "HR-Admin" in roles
        assert "Financial-Admin" in roles
        assert "Payroll-Maker" in roles

        super_admin = db.query(RoleDB).filter(
            (RoleDB.system_key == "super_admin") | (RoleDB.name == "Super-Admin")
        ).first()
        assert super_admin is not None
        assert super_admin.is_locked is True

        # Super-Admin has all 63 catalog keys
        sa_perm_keys = {p.key for p in super_admin.permissions}
        assert len(sa_perm_keys) == 63
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
        if not existing_ur:
            u = db.query(UserDB).first()
            r = db.query(RoleDB).first()
            existing_ur = UserRoleDB(user_id=u.id, role_id=r.id)
            db.add(existing_ur)
            db.commit()
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
        assert len(admin_perms) == 63
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
            (RoleDB.system_key == "super_admin") | (RoleDB.name == "Super-Admin")
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


# ==============================================================================
# SLICE 3 TESTS: HR Guards and Self-Service Keys
# ==============================================================================

def test_no_hr_route_imports_require_admin():
    """AC 1: No HR route in be/routers/*.py (excluding auth.py) imports require_admin."""
    import os
    import re
    routers_dir = os.path.join(os.path.dirname(__file__), "..", "routers")
    pattern = re.compile(r"^\s*(from\s+auth\s+import\s+.*require_admin|import\s+.*require_admin)", re.MULTILINE)
    violations = []

    for fname in os.listdir(routers_dir):
        if fname.endswith(".py") and fname != "auth.py":
            fpath = os.path.join(routers_dir, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
            if pattern.search(content):
                violations.append(fname)

    assert violations == [], f"HR routers still importing require_admin: {violations}"


def test_hr_route_guard_coverage_walker():
    """AC 2: Verify that every HR route has a catalog permission guard matching the inventory."""
    import os
    import csv
    from main import app

    csv_path = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "project-context", "rbac", "route-guard-inventory.csv")
    assert os.path.exists(csv_path), "route-guard-inventory.csv not found"

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        csv_rows = list(reader)

    hr_rows = [r for r in csv_rows if r["file"].startswith("routers/") and r["file"] != "routers/auth.py" and r["file"] != "routers/system.py"]

    # Build map of app routes
    # (method, path) -> route
    app_routes = {}
    for r in app.routes:
        if hasattr(r, "methods") and hasattr(r, "path"):
            for m in r.methods:
                app_routes[(m.upper(), r.path)] = r

    for row in hr_rows:
        method = row["method"].upper()
        path = row["path"]
        route = app_routes.get((method, path))
        assert route is not None, f"Route {method} {path} from CSV not found on FastAPI app"

        endpoint = route.endpoint
        # Collect guards from endpoint attributes or dependencies
        guard_all = getattr(endpoint, "hrflow_permission_all", None)
        guard_self = getattr(endpoint, "hrflow_permission_self", None)
        guard_single = getattr(endpoint, "hrflow_permission", None)
        has_export = getattr(endpoint, "hrflow_proposed_guard", None) is not None

        # Check dependencies
        for dep in getattr(route.dependant, "dependencies", []):
            call_fn = dep.call
            if hasattr(call_fn, "hrflow_permission"):
                guard_single = call_fn.hrflow_permission
            if hasattr(call_fn, "hrflow_permission_all"):
                guard_all = call_fn.hrflow_permission_all
            if hasattr(call_fn, "hrflow_permission_self"):
                guard_self = call_fn.hrflow_permission_self

        # Verify that either guard_all, guard_self, guard_single, or has_export is present
        has_guard = bool(guard_all or guard_single or has_export)
        assert has_guard, f"Route {method} {path} has no catalog permission guard attached"


def test_employee_gets_403_on_admin_hr_routes_and_self_scoped(app_client):
    """AC 3: Employee gets 403 on admin-only routes and sees only own records on scoped routes."""
    with get_db_context() as db:
        emp_user = _create_test_user_with_roles(
            db,
            email="regular_emp@voyance.health",
            system_keys=["employee"],
            employee_id=2,
        )

    cookies = _make_user_cookies(emp_user)

    # 1. Admin-only: apply raise -> 403
    resp_raise = app_client.post(
        "/api/salary/raise",
        json={"employee_id": 2, "new_internal_salary_usd": 50000, "new_external_salary_usd": 0, "effective_date": "2026-10-01"},
        cookies=cookies,
    )
    assert resp_raise.status_code == 403

    # 2. Admin-only: upload company document -> 403
    resp_doc = app_client.post(
        "/api/company-documents",
        json={"name": "Hacked", "file_type": "pdf", "category": "General", "data_url": "data:application/pdf;base64,dGVzdA=="},
        cookies=cookies,
    )
    assert resp_doc.status_code == 403

    # 3. Admin-only: create employee note -> 403
    resp_note = app_client.post(
        "/api/employees/2/notes",
        json={"content": "Secret note"},
        cookies=cookies,
    )
    assert resp_note.status_code == 403

    # 4. Admin-only: audit log -> 403
    resp_audit = app_client.get("/api/audit-log", cookies=cookies)
    assert resp_audit.status_code == 403

    # 5. Scoped route: employees list returns only own record (id=2)
    resp_list = app_client.get("/api/employees", cookies=cookies)
    assert resp_list.status_code == 200
    employees = resp_list.json()
    assert len(employees) == 1
    assert employees[0]["id"] == 2


def test_hr_admin_passes_hr_routes_and_blocked_on_finance(app_client):
    """AC 4: HR-Admin passes all HR routes and gets 403 on every finance route."""
    with get_db_context() as db:
        hr_user = _create_test_user_with_roles(
            db,
            email="hr_admin_user@voyance.health",
            system_keys=["hr_admin"],
            employee_id=1,
        )

    cookies = _make_user_cookies(hr_user)

    # Passes HR routes
    resp_emp = app_client.get("/api/employees", cookies=cookies)
    assert resp_emp.status_code == 200
    assert len(resp_emp.json()) >= 2  # Sees all employees

    resp_sal = app_client.get("/api/salary/history", cookies=cookies)
    assert resp_sal.status_code == 200

    resp_docs = app_client.get("/api/company-documents", cookies=cookies)
    assert resp_docs.status_code == 200

    # Gets 403 on finance routes
    resp_fin_acc = app_client.get("/api/finance/accounts", cookies=cookies)
    assert resp_fin_acc.status_code == 403

    resp_fin_bills = app_client.get("/api/finance/bills", cookies=cookies)
    assert resp_fin_bills.status_code == 403


def test_user_holding_both_self_and_hr_sees_all_records(app_client):
    """AC 5: A user holding both self.* and hr.* sees all records."""
    with get_db_context() as db:
        # User is an employee with linked employee_id=2 (gets self.*) AND has hr_admin role (gets hr.*)
        user = _create_test_user_with_roles(
            db,
            email="dual_role_user@voyance.health",
            system_keys=["hr_admin", "employee"],
            employee_id=2,
        )

    cookies = _make_user_cookies(user)

    # On /api/employees, sees all employees (not restricted to id=2)
    resp = app_client.get("/api/employees", cookies=cookies)
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()}
    assert len(ids) > 1
    assert 2 in ids


def test_on_behalf_of_submission_needs_matching_hr_write(app_client, fake_sheets_client):
    """AC 6: On-behalf-of submission requires matching hr.*.write."""
    with get_db_context() as db:
        emp_user = _create_test_user_with_roles(
            db,
            email="emp_submitter@voyance.health",
            system_keys=["employee"],
            employee_id=2,
        )
        hr_user = _create_test_user_with_roles(
            db,
            email="hr_submitter@voyance.health",
            system_keys=["hr_admin"],
            employee_id=1,
        )

    emp_cookies = _make_user_cookies(emp_user)
    hr_cookies = _make_user_cookies(hr_user)

    # 1. Employee trying to submit request on behalf of employee 3 -> 403
    resp1 = app_client.post(
        "/api/requests",
        json={"employee_name": "Target", "type": "Work From Home", "details": "WFH", "employee_id": 3},
        cookies=emp_cookies,
    )
    assert resp1.status_code == 403
    assert "Only HR admins can submit" in resp1.text

    # 2. HR Admin submitting on behalf of employee 3 -> 201
    resp2 = app_client.post(
        "/api/requests",
        json={"employee_name": "Target", "type": "Work From Home", "details": "WFH", "employee_id": 3},
        cookies=hr_cookies,
    )
    assert resp2.status_code == 201


def test_export_dataset_permissions(app_client):
    """AC 7: Exports require hr.export.run + dataset read key (or finance.report.read for finance)."""
    with get_db_context() as db:
        emp_user = _create_test_user_with_roles(
            db,
            email="export_emp@voyance.health",
            system_keys=["employee"],
            employee_id=2,
        )
        hr_user = _create_test_user_with_roles(
            db,
            email="export_hr@voyance.health",
            system_keys=["hr_admin"],
            employee_id=1,
        )
        fin_user = _create_test_user_with_roles(
            db,
            email="export_fin@voyance.health",
            system_keys=["financial_admin"],
            employee_id=3,
        )

    emp_cookies = _make_user_cookies(emp_user)
    hr_cookies = _make_user_cookies(hr_user)
    fin_cookies = _make_user_cookies(fin_user)

    # Status check
    assert app_client.get("/api/export/status", cookies=emp_cookies).status_code == 403
    assert app_client.get("/api/export/status", cookies=hr_cookies).status_code == 200

    # HR dataset: employees CSV
    assert app_client.get("/api/export/employees/csv", cookies=emp_cookies).status_code == 403
    assert app_client.get("/api/export/employees/csv", cookies=hr_cookies).status_code == 200

    # Finance dataset: finance_accounts CSV
    # HR-Admin does not have finance.report.read
    assert app_client.get("/api/export/finance_accounts/csv", cookies=hr_cookies).status_code == 403
    # Financial-Admin has finance.report.read and finance.account.read
    assert app_client.get("/api/export/finance_accounts/csv", cookies=fin_cookies).status_code == 200


def test_employee_reads_own_masked_bank_account_reveal_denied_without_key(app_client, admin_cookies):
    """AC 8: Employee reads own masked bank details; reveal=true is denied without reveal key."""
    # Create bank details for employee 2 using admin_cookies
    setup_res = app_client.put(
        "/api/employees/2/bank-account",
        json={
            "bank_name": "Test National Bank",
            "iban": "EG12345678901234567890",
            "swift_code": "TESTEGCA",
        },
        cookies=admin_cookies,
    )
    assert setup_res.status_code == 200

    with get_db_context() as db:
        emp_user = _create_test_user_with_roles(
            db,
            email="bank_emp@voyance.health",
            system_keys=["employee"],
            employee_id=2,
        )
        hr_user = _create_test_user_with_roles(
            db,
            email="bank_hr@voyance.health",
            system_keys=["hr_admin"],
            employee_id=1,
        )

    emp_cookies = _make_user_cookies(emp_user)
    hr_cookies = _make_user_cookies(hr_user)

    # 1. Employee reads own masked details
    resp1 = app_client.get("/api/employees/2/bank-account", cookies=emp_cookies)
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert data1["has_details"] is True
    assert data1["iban"].endswith("7890")
    assert "****" in data1["iban"]  # masked

    # 2. Employee cannot read other employee's details
    resp2 = app_client.get("/api/employees/3/bank-account", cookies=emp_cookies)
    assert resp2.status_code == 403

    # 3. Employee requesting reveal=true is denied 403
    resp3 = app_client.get("/api/employees/2/bank-account?reveal=true", cookies=emp_cookies)
    assert resp3.status_code == 403
    assert "hr.employee_bank_account.reveal" in resp3.text

    # 4. HR-Admin (holds hr.employee_bank_account.reveal) requesting reveal=true succeeds
    resp4 = app_client.get("/api/employees/2/bank-account?reveal=true", cookies=hr_cookies)
    assert resp4.status_code == 200
    data4 = resp4.json()
    assert data4["iban"] == "EG12345678901234567890"  # unmasked


# =============================================================================
# Slice 4 Acceptance Tests: Finance & Payroll Split
# =============================================================================

def test_slice4_payroll_split_maker_vs_financial_admin_vs_super_admin(app_client):
    """
    Acceptance 1, 2, 3:
    - Payroll-Maker can preview, adjust, create/generate, add/delete lines, submit, and edit compensation plans.
    - Payroll-Maker gets 403 on approve, finalize, pay, post-journal.
    - Financial-Admin can approve, finalize, pay, post-journal; gets 403 on prepare routes.
    - Super-Admin can do all.
    """
    with get_db_context() as db:
        sync_catalog(db)
        from models_db import EmployeeDB
        from finance.models import FinanceBankAccountDB
        for emp in db.query(EmployeeDB).all():
            if emp.id != 1:
                emp.status = "Inactive"
            else:
                emp.status = "Active"
        bank = db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.is_active == True).first()
        if not bank:
            db.add(FinanceBankAccountDB(
                account_name="Main Payroll Account",
                bank_name="Test Bank",
                account_number="ACC-TEST-01",
                currency="USD",
                opening_balance=100000.0,
                current_balance=100000.0,
                is_active=True,
            ))
        db.commit()

        maker_user = _create_test_user_with_roles(
            db, email="maker@voyance.health", system_keys=["payroll_maker"], employee_id=1
        )
        fin_user = _create_test_user_with_roles(
            db, email="finadmin@voyance.health", system_keys=["financial_admin"], employee_id=2
        )
        super_user = _create_test_user_with_roles(
            db, email="super@voyance.health", system_keys=["super_admin"]
        )

    maker_cookies = _make_user_cookies(maker_user)
    fin_cookies = _make_user_cookies(fin_user)
    super_cookies = _make_user_cookies(super_user)

    # 1. Compensation Plan Edit (requires finance.payroll.prepare)
    comp_payload = {
        "amount": 2500.0,
        "effective_start_date": "2026-10-01",
        "salary_basis": "gross",
        "notes": "Annual raise",
    }
    # Fin-Admin gets 403 (lacks finance.payroll.prepare)
    resp_fin_comp = app_client.put(
        "/api/finance/employees/1/compensation-plan/external_usd",
        json=comp_payload,
        cookies=fin_cookies,
    )
    assert resp_fin_comp.status_code == 403

    # Maker succeeds (holds finance.payroll.prepare)
    resp_maker_comp = app_client.put(
        "/api/finance/employees/1/compensation-plan/external_usd",
        json=comp_payload,
        cookies=maker_cookies,
    )
    assert resp_maker_comp.status_code == 200

    # 2. Preview (requires finance.payroll.read - implied by prepare, holds by maker, fin, super)
    preview_payload = {
        "period_label": "2026-10",
        "period_start": "2026-10-01",
        "period_end": "2026-10-31",
        "payment_date": "2026-10-31",
        "fx_rate_source": "manual",
        "fx_rate_value": 50.0,
    }
    resp = app_client.post("/api/finance/payroll/previews", json=preview_payload, cookies=maker_cookies)
    assert resp.status_code == 200
    preview_data = resp.json()
    preview_id = preview_data["preview_id"]

    # 3. Create run (requires finance.payroll.prepare)
    # Fin-Admin gets 403
    create_run_payload = {
        "period_label": "2026-10",
        "period_start": "2026-10-01",
        "period_end": "2026-10-31",
        "payment_date": "2026-10-31",
        "currency": "USD",
        "preview_id": preview_id,
    }
    resp_fin_run = app_client.post("/api/finance/payroll/runs", json=create_run_payload, cookies=fin_cookies)
    assert resp_fin_run.status_code == 403

    # Maker succeeds
    resp_maker_run = app_client.post("/api/finance/payroll/runs", json=create_run_payload, cookies=maker_cookies)
    assert resp_maker_run.status_code == 201
    run_id = resp_maker_run.json()["id"]

    # 4. Add line (requires finance.payroll.prepare)
    line_payload = {
        "employee_id": 1,
        "compensation_type": "commission_sales",
        "amount": 100.0,
        "notes": "Q3 performance bonus",
    }
    resp_fin_line = app_client.post(f"/api/finance/payroll/runs/{run_id}/lines", json=line_payload, cookies=fin_cookies)
    assert resp_fin_line.status_code == 403

    resp_maker_line = app_client.post(f"/api/finance/payroll/runs/{run_id}/lines", json=line_payload, cookies=maker_cookies)
    assert resp_maker_line.status_code == 201
    line_id = resp_maker_line.json()["id"]

    # Delete line
    resp_maker_del_line = app_client.delete(f"/api/finance/payroll/runs/{run_id}/lines/{line_id}", cookies=maker_cookies)
    assert resp_maker_del_line.status_code == 200

    # 5. Submit run (requires finance.payroll.prepare)
    resp_fin_sub = app_client.post(f"/api/finance/payroll/runs/{run_id}/submit", cookies=fin_cookies)
    assert resp_fin_sub.status_code == 403

    resp_maker_sub = app_client.post(f"/api/finance/payroll/runs/{run_id}/submit", cookies=maker_cookies)
    assert resp_maker_sub.status_code == 200

    # 6. Approve run (requires finance.payroll.approve)
    # Maker gets 403 (lacks finance.payroll.approve)
    resp_maker_appr = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=maker_cookies)
    assert resp_maker_appr.status_code == 403

    # Fin-Admin succeeds
    resp_fin_appr = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=fin_cookies)
    assert resp_fin_appr.status_code == 200

    # 7. Finalize run (requires finance.payroll.approve)
    # Maker gets 403
    resp_maker_fin = app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=maker_cookies)
    assert resp_maker_fin.status_code == 403

    # Fin-Admin succeeds
    resp_fin_fin = app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=fin_cookies)
    assert resp_fin_fin.status_code == 200

    # 8. Pay run (requires finance.payroll.pay)
    # Maker gets 403
    pay_payload = {"bank_account_id": None, "retry_failed_only": False}
    resp_maker_pay = app_client.post(f"/api/finance/payroll/runs/{run_id}/pay", json=pay_payload, cookies=maker_cookies)
    assert resp_maker_pay.status_code == 403

    # Fin-Admin succeeds
    resp_fin_pay = app_client.post(f"/api/finance/payroll/runs/{run_id}/pay", json=pay_payload, cookies=fin_cookies)
    assert resp_fin_pay.status_code == 200

    # 9. Post journal (requires finance.payroll.pay)
    # Maker gets 403
    resp_maker_gl = app_client.post(f"/api/finance/payroll/runs/{run_id}/post-journal", cookies=maker_cookies)
    assert resp_maker_gl.status_code == 403

    # Fin-Admin succeeds
    resp_fin_gl = app_client.post(f"/api/finance/payroll/runs/{run_id}/post-journal", cookies=fin_cookies)
    assert resp_fin_gl.status_code == 200


def test_slice4_maker_checker_self_approval(app_client):
    """
    Acceptance 9:
    A Payroll-Maker cannot approve their own submitted run, with or without allow_self_approval;
    a Super-Admin can with it.
    """
    with get_db_context() as db:
        sync_catalog(db)
        from models_db import EmployeeDB
        from finance.models import FinanceBankAccountDB, EmployeeCompensationPlanDB
        for emp in db.query(EmployeeDB).all():
            if emp.id != 1:
                emp.status = "Inactive"
            else:
                emp.status = "Active"
        bank = db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.is_active == True).first()
        if not bank:
            db.add(FinanceBankAccountDB(
                account_name="Main Payroll Account",
                bank_name="Test Bank",
                account_number="ACC-TEST-01",
                currency="USD",
                opening_balance=100000.0,
                current_balance=100000.0,
                is_active=True,
            ))
        existing_cp = db.query(EmployeeCompensationPlanDB).filter(EmployeeCompensationPlanDB.employee_id == 1).first()
        if not existing_cp:
            db.add(EmployeeCompensationPlanDB(
                employee_id=1,
                component_type="external_usd",
                amount=2000.0,
                effective_start_date="2020-01-01",
            ))
        db.commit()

        maker_user = _create_test_user_with_roles(
            db, email="maker_mc@voyance.health", system_keys=["payroll_maker"], employee_id=1
        )
        super_user = _create_test_user_with_roles(
            db, email="super_mc@voyance.health", system_keys=["super_admin"]
        )

    maker_cookies = _make_user_cookies(maker_user)
    super_cookies = _make_user_cookies(super_user)

    # Super-Admin generates and submits a run
    gen_payload = {
        "period_label": "2029-01",
        "period_start": "2029-01-01",
        "period_end": "2029-01-31",
        "payment_date": "2029-01-31",
        "fx_rate_source": "manual",
        "fx_rate_value": 50.0,
    }
    resp = app_client.post("/api/finance/payroll/runs/generate", json=gen_payload, cookies=super_cookies)
    assert resp.status_code == 201
    run_id = resp.json()["id"]

    # Submit by Super-Admin
    resp_sub = app_client.post(f"/api/finance/payroll/runs/{run_id}/submit", cookies=super_cookies)
    assert resp_sub.status_code == 200

    # 1. Maker attempts to approve (even with allow_self_approval=true) -> 403 Forbidden
    resp_maker = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve?allow_self_approval=true", cookies=maker_cookies)
    assert resp_maker.status_code == 403

    # 2. Super-Admin without allow_self_approval fails maker-checker self-approval (400)
    resp_sa_blocked = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve?allow_self_approval=false", cookies=super_cookies)
    assert resp_sa_blocked.status_code == 400
    assert "Maker-checker violation" in resp_sa_blocked.text

    # 3. Super-Admin with allow_self_approval=true succeeds
    resp_sa_ok = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve?allow_self_approval=true", cookies=super_cookies)
    assert resp_sa_ok.status_code == 200
    assert resp_sa_ok.json()["status"] == "approved"


def test_slice4_vendor_payment_instructions_tightening(app_client):
    """
    Acceptance 4:
    A role holding only finance.vendor.write can no longer create, update, or verify payment instructions.
    Only finance.vendor_payment.manage / verify are accepted.
    """
    with get_db_context() as db:
        sync_catalog(db)
        vendor_write_role = db.query(RoleDB).filter(RoleDB.name == "Vendor-Writer-Only").first()
        if not vendor_write_role:
            vendor_write_role = RoleDB(name="Vendor-Writer-Only", is_locked=False, description="Write vendors only")
            db.add(vendor_write_role)
            db.flush()
        db.query(RolePermissionDB).filter(RolePermissionDB.role_id == vendor_write_role.id).delete()
        for pk in ["finance.vendor.write", "finance.vendor.read"]:
            p = db.query(PermissionDB).filter(PermissionDB.key == pk).first()
            if p:
                db.add(RolePermissionDB(role_id=vendor_write_role.id, permission_id=p.id))
        db.commit()

        writer_user = _create_test_user_with_roles(
            db, email="vendor_writer@voyance.health", role_names=["Vendor-Writer-Only"]
        )
        fin_user = _create_test_user_with_roles(
            db, email="fin_vp@voyance.health", system_keys=["financial_admin"]
        )

    writer_cookies = _make_user_cookies(writer_user)
    fin_cookies = _make_user_cookies(fin_user)

    # 1. Create a vendor using writer_cookies (has finance.vendor.write)
    v_resp = app_client.post("/api/finance/vendors", json={"name": "Test Vendor PI", "legal_name": "Test Vendor Legal"}, cookies=writer_cookies)
    assert v_resp.status_code == 201
    vendor_id = v_resp.json()["id"]

    # 2. Writer attempts to create payment instruction -> 403 Forbidden (finance.vendor.write alias removed)
    pi_payload = {
        "payment_method": "bank_transfer",
        "bank_name": "HSBC",
        "account_number": "1234567890",
        "account_holder_name": "Test Vendor",
    }
    resp_writer_create = app_client.post(f"/api/finance/vendors/{vendor_id}/payment-instructions", json=pi_payload, cookies=writer_cookies)
    assert resp_writer_create.status_code == 403
    assert "finance.vendor_payment.manage" in resp_writer_create.text

    # 3. Fin-Admin succeeds in creating instruction (has finance.vendor_payment.manage)
    resp_fin_create = app_client.post(f"/api/finance/vendors/{vendor_id}/payment-instructions", json=pi_payload, cookies=fin_cookies)
    assert resp_fin_create.status_code == 201
    inst_id = resp_fin_create.json()["id"]

    # 4. Writer attempts to update instruction -> 403
    resp_writer_upd = app_client.put(f"/api/finance/vendors/{vendor_id}/payment-instructions/{inst_id}", json={"bank_name": "CIB"}, cookies=writer_cookies)
    assert resp_writer_upd.status_code == 403

    # 5. Writer attempts to verify instruction -> 403
    verify_payload = {"status": "verified", "notes": "Approved"}
    resp_writer_ver = app_client.post(f"/api/finance/vendors/{vendor_id}/payment-instructions/{inst_id}/verify", json=verify_payload, cookies=writer_cookies)
    assert resp_writer_ver.status_code == 403


def test_slice4_statutory_routes_permissions(app_client):
    """
    Acceptance 5:
    Statutory routes accept finance.statutory.* and reject finance.bill.* alone.
    """
    with get_db_context() as db:
        sync_catalog(db)
        bill_only_role = db.query(RoleDB).filter(RoleDB.name == "Bill-Only-Role").first()
        if not bill_only_role:
            bill_only_role = RoleDB(name="Bill-Only-Role", is_locked=False, description="Bill read and write only")
            db.add(bill_only_role)
            db.flush()
        db.query(RolePermissionDB).filter(RolePermissionDB.role_id == bill_only_role.id).delete()
        for pk in ["finance.bill.read", "finance.bill.write"]:
            p = db.query(PermissionDB).filter(PermissionDB.key == pk).first()
            if p:
                db.add(RolePermissionDB(role_id=bill_only_role.id, permission_id=p.id))
        db.commit()

        bill_user = _create_test_user_with_roles(
            db, email="bill_only@voyance.health", role_names=["Bill-Only-Role"]
        )
        fin_user = _create_test_user_with_roles(
            db, email="fin_stat@voyance.health", system_keys=["financial_admin"]
        )

    bill_cookies = _make_user_cookies(bill_user)
    fin_cookies = _make_user_cookies(fin_user)

    # 1. Bill user tries to list statutory obligations -> 403 (needs finance.statutory.read)
    resp_b_list = app_client.get("/api/finance/statutory-obligations", cookies=bill_cookies)
    assert resp_b_list.status_code == 403
    assert "finance.statutory.read" in resp_b_list.text

    # 2. Bill user tries to create statutory obligation -> 403 (needs finance.statutory.write)
    stat_payload = {
        "obligation_type": "social_insurance_employee",
        "period": "2026-09",
        "amount_accrued": 1500.0,
        "currency": "EGP",
        "due_date": "2026-10-15",
    }
    resp_b_create = app_client.post("/api/finance/statutory-obligations", json=stat_payload, cookies=bill_cookies)
    assert resp_b_create.status_code == 403
    assert "finance.statutory.write" in resp_b_create.text

    # 3. Financial-Admin (holds finance.statutory.read/write) succeeds
    resp_fin_list = app_client.get("/api/finance/statutory-obligations", cookies=fin_cookies)
    assert resp_fin_list.status_code == 200

    resp_fin_create = app_client.post("/api/finance/statutory-obligations", json=stat_payload, cookies=fin_cookies)
    assert resp_fin_create.status_code == 201


def test_slice4_activity_timeline_guards_and_no_nameerror(app_client):
    """
    Acceptance 6:
    Activity timeline: no read key for the entity means 403; no NameError for non-admins.
    """
    with get_db_context() as db:
        sync_catalog(db)
        inv_read_role = db.query(RoleDB).filter(RoleDB.name == "Invoice-Read-Only").first()
        if not inv_read_role:
            inv_read_role = RoleDB(name="Invoice-Read-Only", is_locked=False, description="Invoice read only")
            db.add(inv_read_role)
            db.flush()
        db.query(RolePermissionDB).filter(RolePermissionDB.role_id == inv_read_role.id).delete()
        p = db.query(PermissionDB).filter(PermissionDB.key == "finance.invoice.read").first()
        if p:
            db.add(RolePermissionDB(role_id=inv_read_role.id, permission_id=p.id))
        db.commit()

        inv_user = _create_test_user_with_roles(
            db, email="inv_reader@voyance.health", role_names=["Invoice-Read-Only"]
        )
        fin_user = _create_test_user_with_roles(
            db, email="fin_act@voyance.health", system_keys=["financial_admin"]
        )

    inv_cookies = _make_user_cookies(inv_user)
    fin_cookies = _make_user_cookies(fin_user)

    # 1. Invoice reader tries to access vendor activity -> 403 Forbidden
    resp1 = app_client.get("/api/finance/activity/vendor/1", cookies=inv_cookies)
    assert resp1.status_code == 403
    assert "finance.vendor.read" in resp1.text

    # 2. Invoice reader tries to access bill activity -> 403 Forbidden
    resp2 = app_client.get("/api/finance/activity/bill/1", cookies=inv_cookies)
    assert resp2.status_code == 403
    assert "finance.bill.read" in resp2.text

    # 3. Non-admin Fin-Admin accesses vendor activity -> No NameError! (200 or 404)
    resp3 = app_client.get("/api/finance/activity/vendor/1", cookies=fin_cookies)
    assert resp3.status_code in (200, 404)


def test_slice4_observability_tightening(app_client):
    """
    Acceptance 7:
    Feature-flag and metrics GETs reject users without finance.settings.read;
    Financial-Admin / Super-Admin succeed.
    """
    with get_db_context() as db:
        sync_catalog(db)
        maker_user = _create_test_user_with_roles(
            db, email="maker_obs@voyance.health", system_keys=["payroll_maker"], employee_id=1
        )
        fin_user = _create_test_user_with_roles(
            db, email="fin_obs@voyance.health", system_keys=["financial_admin"]
        )

    maker_cookies = _make_user_cookies(maker_user)
    fin_cookies = _make_user_cookies(fin_user)

    # 1. Payroll-Maker lacks finance.settings.read -> 403
    resp1 = app_client.get("/api/finance/feature-flags", cookies=maker_cookies)
    assert resp1.status_code == 403
    assert "finance.settings.read" in resp1.text

    resp2 = app_client.get("/api/finance/observability/metrics", cookies=maker_cookies)
    assert resp2.status_code == 403
    assert "finance.settings.read" in resp2.text

    # 2. Fin-Admin (has finance.settings.write which implies finance.settings.read) -> 200
    resp3 = app_client.get("/api/finance/feature-flags", cookies=fin_cookies)
    assert resp3.status_code == 200
    assert "flags" in resp3.json()

    resp4 = app_client.get("/api/finance/observability/metrics", cookies=fin_cookies)
    assert resp4.status_code == 200
    assert "uptime_seconds" in resp4.json()


def test_slice4_migration_payroll_write_eradication(app_client):
    """
    Acceptance 8:
    finance.payroll.write no longer exists in permissions table or role_permissions after migration.
    """
    with get_db_context() as db:
        sync_catalog(db)
        p = db.query(PermissionDB).filter(PermissionDB.key == "finance.payroll.write").first()
        assert p is None, "finance.payroll.write must not exist in permissions table"

        # Check all roles
        for r in db.query(RoleDB).all():
            keys = {perm.key for perm in r.permissions}
            assert "finance.payroll.write" not in keys, f"Role {r.name} should not have finance.payroll.write"


# =============================================================================
# Slice 5: Access Service, API, and Employee Lifecycle (R1–R14)
# =============================================================================

def test_slice5_r1_self_action_prohibition(app_client):
    """
    R1: An actor cannot delete, archive, or revoke the access of their own user.
    """
    with get_db_context() as db:
        sync_catalog(db)
        emp1 = db.query(EmployeeDB).filter(EmployeeDB.id == 101).first()
        if not emp1:
            emp1 = EmployeeDB(id=101, name="SA 1", email="sa1_self@voyance.health", dept="Tech", job_role="Eng")
            db.add(emp1)
        emp2 = db.query(EmployeeDB).filter(EmployeeDB.id == 102).first()
        if not emp2:
            emp2 = EmployeeDB(id=102, name="SA 2", email="sa2_self@voyance.health", dept="Tech", job_role="Eng")
            db.add(emp2)
        db.flush()

        # Create SA user 1
        sa1 = _create_test_user_with_roles(db, email="sa1_self@voyance.health", system_keys=["super_admin"], employee_id=101)
        # Create SA user 2
        sa2 = _create_test_user_with_roles(db, email="sa2_self@voyance.health", system_keys=["super_admin"], employee_id=102)
        sa1_id = sa1["id"]
        sa2_id = sa2["id"]

    sa1_cookies = _make_user_cookies(sa1)
    sa2_cookies = _make_user_cookies(sa2)

    # 1. Negative: SA1 tries to archive self -> 409
    resp_archive_self = app_client.post(f"/api/access/users/{sa1_id}/archive", cookies=sa1_cookies)
    assert resp_archive_self.status_code == 409
    assert "own user" in resp_archive_self.text

    # 2. Negative: SA1 tries to revoke roles from self -> 409
    resp_revoke_self = app_client.put(f"/api/access/users/{sa1_id}/role", json={"role_id": None}, cookies=sa1_cookies)
    assert resp_revoke_self.status_code == 409
    assert "own user" in resp_revoke_self.text

    # 3. Negative: SA1 tries to delete own employee record -> 409
    resp_del_self_emp = app_client.delete(f"/api/employees/101", cookies=sa1_cookies)
    assert resp_del_self_emp.status_code == 409
    assert "own user" in resp_del_self_emp.text

    # 4. Positive: SA2 archives a normal other user -> 200
    with get_db_context() as db:
        other_user = _create_test_user_with_roles(db, email="other_user@voyance.health", system_keys=["hr_admin"])
        other_id = other_user["id"]
    resp_archive_other = app_client.post(f"/api/access/users/{other_id}/archive", cookies=sa2_cookies)
    assert resp_archive_other.status_code == 200


def test_slice5_r2_last_active_super_admin_protection(app_client):
    """
    R2: The last active Super-Admin cannot be revoked, archived, or deleted.
    """
    with get_db_context() as db:
        sync_catalog(db)
        emp = db.query(EmployeeDB).filter(EmployeeDB.id == 201).first()
        if not emp:
            emp = EmployeeDB(id=201, name="Sole SA", email="sole_sa@voyance.health", dept="Tech", job_role="Eng")
            db.add(emp)
        db.flush()

        sa_role = db.query(RoleDB).filter_by(system_key="super_admin").first()
        hr_role = db.query(RoleDB).filter_by(system_key="hr_admin").first()
        if not hr_role:
            hr_role = RoleDB(name="HR-Admin", system_key="hr_admin", is_locked=False)
            db.add(hr_role)
            db.flush()

        # Archive all other Super-Admins so exactly 1 is active
        all_sa_users = (
            db.query(UserDB)
            .join(UserRoleDB, UserRoleDB.role_id == RoleDB.id)
            .filter(RoleDB.system_key == "super_admin")
            .all()
        )
        import datetime
        for u in all_sa_users:
            u.archived_at = datetime.datetime.utcnow()
        db.flush()

        # Create the sole active Super-Admin
        sole_sa = _create_test_user_with_roles(db, email="sole_sa@voyance.health", system_keys=["super_admin"], employee_id=201)
        # Create non-SA manager who has system.users.manage and hr.employee.write
        manager_role = db.query(RoleDB).filter_by(name="Custom-Manager").first()
        if not manager_role:
            manager_role = RoleDB(name="Custom-Manager", is_locked=False)
            db.add(manager_role)
            db.flush()
            p_um = db.query(PermissionDB).filter_by(key="system.users.manage").first()
            p_ew = db.query(PermissionDB).filter_by(key="hr.employee.write").first()
            db.add(RolePermissionDB(role_id=manager_role.id, permission_id=p_um.id))
            db.add(RolePermissionDB(role_id=manager_role.id, permission_id=p_ew.id))
            db.commit()

        manager_user = _create_test_user_with_roles(db, email="mgr@voyance.health", role_names=["Custom-Manager"])
        sole_sa_id = sole_sa["id"]
        hr_role_id = hr_role.id

    mgr_cookies = _make_user_cookies(manager_user)

    # 1. Negative: Manager tries to revoke Super-Admin from the sole active SA -> 409
    resp_revoke = app_client.put(f"/api/access/users/{sole_sa_id}/role", json={"role_id": hr_role_id}, cookies=mgr_cookies)
    assert resp_revoke.status_code == 409
    assert "last active Super-Admin" in resp_revoke.text

    # 2. Negative: Manager tries to archive the sole active SA -> 409
    resp_archive = app_client.post(f"/api/access/users/{sole_sa_id}/archive", cookies=mgr_cookies)
    assert resp_archive.status_code == 409
    assert "last active Super-Admin" in resp_archive.text

    # 3. Negative: Manager tries to delete employee of the sole active SA -> 409
    resp_delete_emp = app_client.delete(f"/api/employees/201", cookies=mgr_cookies)
    assert resp_delete_emp.status_code == 409

    # 4. Positive: When second active SA exists, revoking SA from the first one succeeds
    with get_db_context() as db:
        sa2 = _create_test_user_with_roles(db, email="second_sa@voyance.health", system_keys=["super_admin"])
    resp_revoke_ok = app_client.put(f"/api/access/users/{sole_sa_id}/role", json={"role_id": hr_role_id}, cookies=mgr_cookies)
    assert resp_revoke_ok.status_code == 200


def test_slice5_r3_external_user_role_invariants(app_client):
    """
    R3: External user without linked employee must keep >= 1 role; revoking last role rejected.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_ext@voyance.health", system_keys=["super_admin"])
        hr_role = db.query(RoleDB).filter_by(system_key="hr_admin").first()
        hr_role_id = hr_role.id

    sa_cookies = _make_user_cookies(sa)

    # 1. Positive: Create external user with 1 role -> 201
    resp_create = app_client.post(
        "/api/access/users",
        json={
            "email": "consultant@external-advisor.com",
            "name": "External Consultant",
            "role_id": hr_role_id,
        },
        cookies=sa_cookies,
    )
    assert resp_create.status_code == 201
    data = resp_create.json()
    assert data["is_external"] is True
    assert data["employee_id"] is None
    ext_user_id = data["id"]

    # 2. Negative: Creating external user with 0 roles -> 422
    resp_bad_create = app_client.post(
        "/api/access/users",
        json={
            "email": "zero_roles@external.com",
            "name": "Zero Roles",
            "role_id": None,
        },
        cookies=sa_cookies,
    )
    assert resp_bad_create.status_code == 422

    # 3. Negative: Revoking the last role of an external user -> 409
    resp_revoke_last = app_client.put(
        f"/api/access/users/{ext_user_id}/role",
        json={"role_id": None},
        cookies=sa_cookies,
    )
    assert resp_revoke_last.status_code == 409
    assert "must always have a role" in resp_revoke_last.text


def test_slice5_r4_r5_employee_deletion_lifecycle(app_client):
    """
    R4: Deleting employee rejected if linked user has elevated roles (409 pointing to Users page).
    R5: Deleting baseline-only employee deletes linked user in same transaction.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_del_emp@voyance.health", system_keys=["super_admin"])

    sa_cookies = _make_user_cookies(sa)

    # 1. Create baseline-only employee via API
    resp_emp1 = app_client.post(
        "/api/employees",
        json={
            "name": "Baseline Worker",
            "email": "baseline_worker@voyance.health",
            "dept": "Operations",
            "job_role": "Specialist",
            "internal_salary_usd": 0.0,
            "external_salary_usd": 0.0,
        },
        cookies=sa_cookies,
    )
    assert resp_emp1.status_code == 201
    emp1_id = resp_emp1.json()["id"]

    # Verify linked user exists in DB with no elevated roles
    with get_db_context() as db:
        u1 = db.query(UserDB).filter_by(employee_id=emp1_id).first()
        assert u1 is not None
        u1_id = u1.id

    # R5: Delete baseline employee -> 200, linked user deleted in DB
    resp_del1 = app_client.delete(f"/api/employees/{emp1_id}", cookies=sa_cookies)
    assert resp_del1.status_code == 200
    with get_db_context() as db:
        assert db.query(UserDB).filter_by(id=u1_id).first() is None

    # 2. Create elevated employee
    resp_emp2 = app_client.post(
        "/api/employees",
        json={
            "name": "Elevated Worker",
            "email": "elevated_worker@voyance.health",
            "dept": "Finance",
            "job_role": "Analyst",
            "internal_salary_usd": 0.0,
            "external_salary_usd": 0.0,
        },
        cookies=sa_cookies,
    )
    assert resp_emp2.status_code == 201
    emp2_id = resp_emp2.json()["id"]

    # Assign Financial-Admin role to emp2's user
    with get_db_context() as db:
        u2 = db.query(UserDB).filter_by(employee_id=emp2_id).first()
        fin_role = db.query(RoleDB).filter_by(system_key="financial_admin").first()
        db.add(UserRoleDB(user_id=u2.id, role_id=fin_role.id))
        db.commit()

    # R4: Delete elevated employee -> 409 pointing to Users page
    resp_del2 = app_client.delete(f"/api/employees/{emp2_id}", cookies=sa_cookies)
    assert resp_del2.status_code == 409
    assert "Users page" in resp_del2.text


def test_slice5_r6_locked_role_immutability(app_client):
    """
    R6: Locked roles cannot be edited, renamed, or deleted.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_lock@voyance.health", system_keys=["super_admin"])
        locked_role = db.query(RoleDB).filter_by(system_key="super_admin").first()
        locked_id = locked_role.id

    sa_cookies = _make_user_cookies(sa)

    # 1. Negative: Edit locked role -> 409
    resp_edit = app_client.put(
        f"/api/access/roles/{locked_id}",
        json={"name": "New Super Admin", "description": "Attempted edit"},
        cookies=sa_cookies,
    )
    assert resp_edit.status_code == 409
    assert "locked role" in resp_edit.text

    # 2. Negative: Delete locked role -> 409
    resp_del = app_client.delete(f"/api/access/roles/{locked_id}", cookies=sa_cookies)
    assert resp_del.status_code == 409
    assert "locked role" in resp_del.text


def test_slice5_r7_assigned_role_deletion_protection(app_client):
    """
    R7: Assigned roles cannot be deleted.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_r7@voyance.health", system_keys=["super_admin"])

    sa_cookies = _make_user_cookies(sa)

    # 1. Create a custom role
    resp_create = app_client.post(
        "/api/access/roles",
        json={
            "name": "Temporary-Role-R7",
            "description": "Will be deleted",
            "permissions": ["hr.employee.read"],
        },
        cookies=sa_cookies,
    )
    assert resp_create.status_code == 201
    role_id = resp_create.json()["id"]

    # 2. Assign custom role to a test user
    with get_db_context() as db:
        test_user = _create_test_user_with_roles(db, email="assigned_user_r7@voyance.health")
        db.add(UserRoleDB(user_id=test_user["id"], role_id=role_id))
        db.commit()

    # 3. Negative: Deleting assigned role -> 409
    resp_del_assigned = app_client.delete(f"/api/access/roles/{role_id}", cookies=sa_cookies)
    assert resp_del_assigned.status_code == 409
    assert "assigned to 1 user" in resp_del_assigned.text

    # 4. Positive: Unassign role and delete -> 200
    with get_db_context() as db:
        db.query(UserRoleDB).filter_by(role_id=role_id).delete()
        db.commit()

    resp_del_ok = app_client.delete(f"/api/access/roles/{role_id}", cookies=sa_cookies)
    assert resp_del_ok.status_code == 200
    assert resp_del_ok.json()["message"] == "Role deleted"


def test_slice5_r8_role_permission_closure_and_validation(app_client):
    """
    R8: Role saving applies closure, rejects unknown/non-assignable keys, returns implied_added.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_r8@voyance.health", system_keys=["super_admin"])

    sa_cookies = _make_user_cookies(sa)

    # 1. Positive: Save role with hr.employee.write -> returns implied_added hr.employee.read
    resp_create = app_client.post(
        "/api/access/roles",
        json={
            "name": "Writer-With-Closure",
            "description": "Tests closure computation",
            "permissions": ["hr.employee.write"],
        },
        cookies=sa_cookies,
    )
    assert resp_create.status_code == 201
    data = resp_create.json()
    assert "hr.employee.read" in data["permissions"]
    assert "hr.employee.write" in data["permissions"]
    assert "hr.employee.read" in data["implied_added"]

    # 2. Negative: Unknown permission key -> 422
    resp_unknown = app_client.post(
        "/api/access/roles",
        json={
            "name": "Bad-Perm-Role",
            "permissions": ["hr.nonexistent.fake"],
        },
        cookies=sa_cookies,
    )
    assert resp_unknown.status_code == 422
    assert "Invalid permission keys" in resp_unknown.text

    # 3. Negative: Non-assignable permission key (system.users.manage) -> 422
    resp_non_assignable = app_client.post(
        "/api/access/roles",
        json={
            "name": "Non-Assignable-Perm-Role",
            "permissions": ["system.users.manage"],
        },
        cookies=sa_cookies,
    )
    assert resp_non_assignable.status_code == 422
    assert "Invalid permission keys" in resp_non_assignable.text


def test_slice5_r9_role_assignment_authorization(app_client):
    """
    R9: Role assignment guarded by system.users.manage.
    """
    with get_db_context() as db:
        sync_catalog(db)
        # Create user without system.users.manage
        hr_user = _create_test_user_with_roles(db, email="hr_no_um@voyance.health", system_keys=["hr_admin"])
        # Create target user
        target = _create_test_user_with_roles(db, email="target_r9@voyance.health")
        target_id = target["id"]

    hr_cookies = _make_user_cookies(hr_user)

    # Negative: HR-Admin (lacks system.users.manage) -> 403
    resp = app_client.put(f"/api/access/users/{target_id}/role", json={"role_id": None}, cookies=hr_cookies)
    assert resp.status_code == 403
    assert "system.users.manage" in resp.text


def test_slice5_r10_r11_archived_user_lifecycle(app_client):
    """
    R10: Archiving sets archived_at and archived_by, preserves roles, blocks access.
    R11: Archived user cannot have roles changed.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_arch@voyance.health", system_keys=["super_admin"])
        fin_role = db.query(RoleDB).filter_by(system_key="financial_admin").first()
        target = _create_test_user_with_roles(db, email="to_archive@voyance.health", system_keys=["financial_admin"])
        target_id = target["id"]
        fin_role_id = fin_role.id

    sa_cookies = _make_user_cookies(sa)

    # 1. Archive user -> 200
    resp_archive = app_client.post(f"/api/access/users/{target_id}/archive", cookies=sa_cookies)
    assert resp_archive.status_code == 200

    # Verify DB state: archived_at and archived_by set, roles preserved
    with get_db_context() as db:
        u = db.query(UserDB).filter_by(id=target_id).first()
        assert u.archived_at is not None
        assert u.archived_by == "sa_arch@voyance.health"
        roles = [ur.role_id for ur in u.user_roles]
        assert fin_role_id in roles

    # 2. R11 Negative: Modifying roles of an archived user -> 409
    resp_mod = app_client.put(f"/api/access/users/{target_id}/role", json={"role_id": fin_role_id}, cookies=sa_cookies)
    assert resp_mod.status_code == 409
    assert "archived user" in resp_mod.text


def test_slice5_r12_employee_provisioning_rules(app_client):
    """
    R12: Provisioning links existing non-archived user; rejects archived user with 409.
    Creating employee creates linked user with no explicit role rows and full baseline access.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_r12@voyance.health", system_keys=["super_admin"])
        # Create an existing external user with financial_admin role
        fin_role = db.query(RoleDB).filter_by(system_key="financial_admin").first()
        ext_user = _create_test_user_with_roles(
            db, email="ext_to_link@voyance.health", system_keys=["financial_admin"]
        )
        # Create an archived user
        arch_user = _create_test_user_with_roles(db, email="archived_person@voyance.health", is_archived=True)

    sa_cookies = _make_user_cookies(sa)

    # 1. Negative: Attempt to create employee with email of archived user -> 409
    resp_arch = app_client.post(
        "/api/employees",
        json={
            "name": "Archived Person",
            "email": "archived_person@voyance.health",
            "dept": "Sales",
            "job_role": "Rep",
            "internal_salary_usd": 0.0,
            "external_salary_usd": 0.0,
        },
        cookies=sa_cookies,
    )
    assert resp_arch.status_code == 409
    assert "archived user already exists" in resp_arch.text

    # 2. Positive: Create employee with email of existing external user -> links user and preserves roles
    resp_link = app_client.post(
        "/api/employees",
        json={
            "name": "Linked Consultant",
            "email": "ext_to_link@voyance.health",
            "dept": "Finance",
            "job_role": "Director",
            "internal_salary_usd": 0.0,
            "external_salary_usd": 0.0,
        },
        cookies=sa_cookies,
    )
    assert resp_link.status_code == 201
    emp_id = resp_link.json()["id"]

    with get_db_context() as db:
        u = db.query(UserDB).filter_by(email="ext_to_link@voyance.health").first()
        assert u.employee_id == emp_id
        # Roles preserved
        role_keys = {ur.role.system_key for ur in u.user_roles}
        assert "financial_admin" in role_keys

    # 3. Positive: Creating employee with brand new email provisions user with baseline access
    resp_new = app_client.post(
        "/api/employees",
        json={
            "name": "Fresh Hire",
            "email": "fresh_hire@voyance.health",
            "dept": "Engineering",
            "job_role": "Developer",
            "internal_salary_usd": 0.0,
            "external_salary_usd": 0.0,
        },
        cookies=sa_cookies,
    )
    assert resp_new.status_code == 201
    fresh_emp_id = resp_new.json()["id"]

    with get_db_context() as db:
        fresh_user = db.query(UserDB).filter_by(email="fresh_hire@voyance.health").first()
        assert fresh_user is not None
        assert fresh_user.employee_id == fresh_emp_id
        # Baseline access: no explicit elevated roles
        assert len(fresh_user.user_roles) == 0


def test_slice5_r13_role_naming_and_uniqueness(app_client):
    """
    R13: Role name 1-100 chars, unique, reserved names protected.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_r13@voyance.health", system_keys=["super_admin"])

    sa_cookies = _make_user_cookies(sa)

    # 1. Negative: Empty name -> 409
    resp_empty = app_client.post(
        "/api/access/roles",
        json={"name": "   ", "permissions": ["hr.employee.read"]},
        cookies=sa_cookies,
    )
    assert resp_empty.status_code == 409
    assert "between 1 and 100 characters" in resp_empty.text

    # 2. Negative: Name > 100 chars -> 409
    resp_long = app_client.post(
        "/api/access/roles",
        json={"name": "X" * 105, "permissions": ["hr.employee.read"]},
        cookies=sa_cookies,
    )
    assert resp_long.status_code == 409

    # 3. Negative: Reserved name -> 409
    resp_res = app_client.post(
        "/api/access/roles",
        json={"name": "super-admin", "permissions": ["hr.employee.read"]},
        cookies=sa_cookies,
    )
    assert resp_res.status_code == 409
    assert "reserved" in resp_res.text

    # 4. Positive & Duplicate: Create unique role, then try duplicate -> 409
    resp_ok = app_client.post(
        "/api/access/roles",
        json={"name": "My-Unique-Role-1", "permissions": ["hr.employee.read"]},
        cookies=sa_cookies,
    )
    assert resp_ok.status_code == 201

    resp_dup = app_client.post(
        "/api/access/roles",
        json={"name": "My-Unique-Role-1", "permissions": ["hr.employee.read"]},
        cookies=sa_cookies,
    )
    assert resp_dup.status_code == 409
    assert "already exists" in resp_dup.text


def test_slice5_r14_employee_email_update_sync(app_client):
    """
    R14: Employee email update keeps users.email synchronized.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_r14@voyance.health", system_keys=["super_admin"])

    sa_cookies = _make_user_cookies(sa)

    # 1. Create employee with email v1
    resp_create = app_client.post(
        "/api/employees",
        json={
            "name": "Sync Person",
            "email": "sync_v1@voyance.health",
            "dept": "Design",
            "job_role": "UI Designer",
            "internal_salary_usd": 0.0,
            "external_salary_usd": 0.0,
        },
        cookies=sa_cookies,
    )
    assert resp_create.status_code == 201
    emp_id = resp_create.json()["id"]

    # Verify user email matches v1
    with get_db_context() as db:
        u = db.query(UserDB).filter_by(employee_id=emp_id).first()
        assert u.email == "sync_v1@voyance.health"

    # 2. Update employee email to v2
    resp_update = app_client.put(
        f"/api/employees/{emp_id}",
        json={"email": "sync_v2@voyance.health"},
        cookies=sa_cookies,
    )
    assert resp_update.status_code == 200

    # Verify user email synchronized to v2
    with get_db_context() as db:
        u = db.query(UserDB).filter_by(employee_id=emp_id).first()
        assert u.email == "sync_v2@voyance.health"


def test_slice5_audit_logging_coverage(app_client):
    """
    Acceptance 7: Every mutation writes an audit entry via deps.audit_log:
    role.create, role.update, role.delete, user.create_external, user.roles_update, user.archive.
    """
    from models_db import AuditLogDB

    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_audit@voyance.health", system_keys=["super_admin"])
        hr_role = db.query(RoleDB).filter_by(system_key="hr_admin").first()
        hr_role_id = hr_role.id

    sa_cookies = _make_user_cookies(sa)

    # 1. role.create
    resp_rc = app_client.post(
        "/api/access/roles",
        json={"name": "Audit-Role-Test", "permissions": ["hr.employee.read"]},
        cookies=sa_cookies,
    )
    assert resp_rc.status_code == 201
    role_id = resp_rc.json()["id"]

    # 2. role.update
    resp_ru = app_client.put(
        f"/api/access/roles/{role_id}",
        json={"description": "Updated audit description"},
        cookies=sa_cookies,
    )
    assert resp_ru.status_code == 200

    # 3. role.delete
    resp_rd = app_client.delete(f"/api/access/roles/{role_id}", cookies=sa_cookies)
    assert resp_rd.status_code == 200

    # 4. user.create_external
    resp_uc = app_client.post(
        "/api/access/users",
        json={
            "email": "audit_ext@external.com",
            "name": "Audit Ext",
            "role_id": hr_role_id,
        },
        cookies=sa_cookies,
    )
    assert resp_uc.status_code == 201
    ext_id = resp_uc.json()["id"]

    # 5. user.roles_update
    resp_uu = app_client.put(
        f"/api/access/users/{ext_id}/role",
        json={"role_id": hr_role_id},
        cookies=sa_cookies,
    )
    assert resp_uu.status_code == 200

    # 6. user.archive
    resp_ua = app_client.post(f"/api/access/users/{ext_id}/archive", cookies=sa_cookies)
    assert resp_ua.status_code == 200

    # Verify audit entries in AuditLogDB
    with get_db_context() as db:
        actions = {
            a.action for a in db.query(AuditLogDB).filter(AuditLogDB.actor_email == "sa_audit@voyance.health").all()
        }
        assert "role.create" in actions
        assert "role.update" in actions
        assert "role.delete" in actions
        assert "user.create_external" in actions
        assert "user.roles_update" in actions
        assert "user.archive" in actions


def test_slice5_catalog_and_users_listing(app_client):
    """
    Catalog and Users list endpoints with filters (all, employees, external, archived) and search.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_list@voyance.health", system_keys=["super_admin"])

    sa_cookies = _make_user_cookies(sa)

    # 1. Catalog list
    resp_cat = app_client.get("/api/access/catalog", cookies=sa_cookies)
    assert resp_cat.status_code == 200
    groups = resp_cat.json()
    assert len(groups) > 0
    group_names = [g["group"] for g in groups]
    assert any("HR" in g or "Human" in g or "hr" in g.lower() for g in group_names)

    # 2. Roles list
    resp_roles = app_client.get("/api/access/roles", cookies=sa_cookies)
    assert resp_roles.status_code == 200
    roles = resp_roles.json()
    assert any(r["name"] == "Super-Admin" for r in roles)

    # 3. Users list with filters
    resp_all = app_client.get("/api/access/users?filter=all", cookies=sa_cookies)
    assert resp_all.status_code == 200

    resp_ext = app_client.get("/api/access/users?filter=external", cookies=sa_cookies)
    assert resp_ext.status_code == 200
    for u in resp_ext.json():
        assert u["is_external"] is True
        assert u["employee_id"] is None

    resp_emp = app_client.get("/api/access/users?filter=employees", cookies=sa_cookies)
    assert resp_emp.status_code == 200
    for u in resp_emp.json():
        assert u["is_external"] is False
        assert u["employee_id"] is not None

    resp_arch = app_client.get("/api/access/users?filter=archived", cookies=sa_cookies)
    assert resp_arch.status_code == 200
    for u in resp_arch.json():
        assert u["archived_at"] is not None


# =============================================================================
# Slice 6: Sign-In Policy (D-013)
# =============================================================================

def test_slice6_verified_google_account_any_domain_signs_in(app_client, monkeypatch):
    """
    Acceptance: A verified Google account of any domain signs in if and only if
    a non-archived user with that email exists (case-insensitive).
    """
    import auth as auth_module

    with get_db_context() as db:
        sync_catalog(db)
        # Create external contractor with @gmail.com (outside company domain)
        contractor = _create_test_user_with_roles(
            db, email="contractor.external@gmail.com", system_keys=["financial_admin"]
        )

    # Mock Google verification returning uppercase email and verified
    monkeypatch.setattr(
        auth_module.google_id_token,
        "verify_oauth2_token",
        lambda cred, req, aud: {
            "email": "CONTRACTOR.EXTERNAL@GMAIL.COM",
            "name": "External Contractor",
            "email_verified": True,
            "hd": "gmail.com",
        },
    )

    resp = app_client.post("/api/auth/google", json={"credential": "valid_token_any_domain"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "External Contractor"
    assert "finance.invoice.read" in data["permissions"]
    assert resp.cookies.get("hrflow_session") is not None


def test_slice6_unverified_email_rejected(app_client, monkeypatch):
    """
    Acceptance: Unverified emails from Google are rejected with 401.
    """
    import auth as auth_module

    with get_db_context() as db:
        sync_catalog(db)
        _create_test_user_with_roles(db, email="unverified@somecorp.org", system_keys=["hr_admin"])

    monkeypatch.setattr(
        auth_module.google_id_token,
        "verify_oauth2_token",
        lambda cred, req, aud: {
            "email": "unverified@somecorp.org",
            "name": "Unverified User",
            "email_verified": False,
        },
    )

    resp = app_client.post("/api/auth/google", json={"credential": "unverified_token"})
    assert resp.status_code == 401
    assert "not verified" in resp.text


def test_slice6_unknown_email_rejected(app_client, monkeypatch):
    """
    Acceptance: Unknown emails (no HRFlow user record) are rejected with 403.
    """
    import auth as auth_module

    monkeypatch.setattr(
        auth_module.google_id_token,
        "verify_oauth2_token",
        lambda cred, req, aud: {
            "email": "stranger_unknown@unknowncompany.com",
            "name": "Stranger",
            "email_verified": True,
        },
    )

    resp = app_client.post("/api/auth/google", json={"credential": "unknown_user_token"})
    assert resp.status_code == 403
    assert "not registered in HRFlow" in resp.text


def test_slice6_archived_user_rejected_at_signin(app_client, monkeypatch):
    """
    Acceptance: Archived users get a clear 403 at sign-in.
    """
    import auth as auth_module
    import datetime

    with get_db_context() as db:
        sync_catalog(db)
        u = _create_test_user_with_roles(db, email="departed_employee@voyance.health", system_keys=["hr_admin"])
        # Archive the user
        db_u = db.query(UserDB).filter_by(email="departed_employee@voyance.health").first()
        db_u.archived_at = datetime.datetime.utcnow()
        db.commit()

    monkeypatch.setattr(
        auth_module.google_id_token,
        "verify_oauth2_token",
        lambda cred, req, aud: {
            "email": "departed_employee@voyance.health",
            "name": "Departed Employee",
            "email_verified": True,
        },
    )

    resp = app_client.post("/api/auth/google", json={"credential": "archived_user_token"})
    assert resp.status_code == 403
    assert "archived" in resp.text.lower()


def test_slice6_user_without_effective_access_rejected_at_signin(app_client, monkeypatch):
    """
    Acceptance: A user record with no effective access (no employee baseline and no roles)
    is rejected with 403 'No access assigned'.
    """
    import auth as auth_module

    with get_db_context() as db:
        sync_catalog(db)
        # Create external user with no employee and no roles
        u = db.query(UserDB).filter_by(email="empty_access@vendor.com").first()
        if not u:
            u = UserDB(email="empty_access@vendor.com", name="No Access", employee_id=None, role="employee")
            db.add(u)
            db.commit()
        db.query(UserRoleDB).filter_by(user_id=u.id).delete()
        db.commit()

    monkeypatch.setattr(
        auth_module.google_id_token,
        "verify_oauth2_token",
        lambda cred, req, aud: {
            "email": "empty_access@vendor.com",
            "name": "No Access",
            "email_verified": True,
        },
    )

    resp = app_client.post("/api/auth/google", json={"credential": "no_access_token"})
    assert resp.status_code == 403
    assert "no access assigned" in resp.text.lower()


def test_slice8_drop_users_role_and_compatibility():
    """AC: users table has dropped the role column, migration 0026 drops/adds it, and UserDB maintains backwards compatibility."""
    import sqlalchemy as sa
    from db import Base
    from models_db import UserDB
    from core.rbac_models import RoleDB, UserRoleDB
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    import importlib

    # 1. Base.metadata check: UserDB no longer maps 'role'
    assert "role" not in Base.metadata.tables["users"].columns, "UserDB table definition still includes 'role' column"

    # 2. Fresh schema creation has no 'role' column in users
    fresh_engine = sa.create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=fresh_engine)
    insp_fresh = sa.inspect(fresh_engine)
    fresh_cols = [c["name"] for c in insp_fresh.get_columns("users")]
    assert "role" not in fresh_cols, f"'role' column unexpectedly found in fresh users table: {fresh_cols}"

    # 3. Test Migration 0026 upgrade and downgrade directly
    test_mig_engine = sa.create_engine("sqlite:///:memory:")
    with test_mig_engine.connect() as conn:
        conn.execute(sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255), role VARCHAR(50), employee_id INTEGER)"))
        conn.commit()

    mig_0026 = importlib.import_module("migrations.versions.0026_drop_users_role")

    with test_mig_engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mig_0026.upgrade()
        conn.commit()

    insp_after = sa.inspect(test_mig_engine)
    assert "role" not in [c["name"] for c in insp_after.get_columns("users")], "Migration 0026 upgrade failed to drop 'role'"

    with test_mig_engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mig_0026.downgrade()
        conn.commit()

    insp_down = sa.inspect(test_mig_engine)
    assert "role" in [c["name"] for c in insp_down.get_columns("users")], "Migration 0026 downgrade failed to re-add 'role'"

    # 4. UserDB backwards compatibility
    u1 = UserDB(email="test_no_role@test.com", name="Test No Role")
    assert u1.role == "user"

    # Deprecated role kwarg silently ignored
    u2 = UserDB(email="test_compat_role@test.com", name="Test Compat Role", role="admin")
    assert u2.role == "user"
    u2.role = "employee"
    assert u2.role == "user"

    # Employee ID returns 'employee'
    u3 = UserDB(email="emp@test.com", employee_id=123)
    assert u3.role == "employee"

    # Super-Admin role returns 'admin'
    sa_role = RoleDB(name="Super-Admin", system_key="super_admin")
    ur = UserRoleDB(role=sa_role)
    u4 = UserDB(email="sa@test.com", employee_id=123, user_roles=[ur])
    assert u4.role == "admin"


def test_all_routes_guard_coverage_walker():
    """
    Slice 8 Acceptance:
    Every route on FastAPI app has a catalog permission marker or is on the named allow-list:
    {'/api/auth/google', '/api/auth/logout', '/api/auth/me', '/api/health'}.
    """
    from main import app
    from fastapi.routing import APIRoute

    allow_list = {"/api/auth/google", "/api/auth/logout", "/api/auth/me", "/api/health"}

    uncovered = []
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        if r.path in allow_list:
            continue
        endpoint = r.endpoint
        guard_single = getattr(endpoint, "hrflow_permission", None)
        guard_all = getattr(endpoint, "hrflow_permission_all", None)
        guard_self = getattr(endpoint, "hrflow_permission_self", None)
        has_export = getattr(endpoint, "hrflow_proposed_guard", None) is not None

        for dep in getattr(r.dependant, "dependencies", []):
            call_fn = dep.call
            if hasattr(call_fn, "hrflow_permission"):
                guard_single = call_fn.hrflow_permission
            if hasattr(call_fn, "hrflow_permission_all"):
                guard_all = call_fn.hrflow_permission_all
            if hasattr(call_fn, "hrflow_permission_self"):
                guard_self = call_fn.hrflow_permission_self

        if not (guard_single or guard_all or guard_self or has_export):
            uncovered.append((list(r.methods), r.path))

    assert uncovered == [], f"Routes lacking catalog permission guard: {uncovered}"


def test_catalog_usage():
    """
    Slice 8 Acceptance:
    All permission keys attached to route guards or defined in role matrices belong to all_keys().
    """
    from main import app
    from fastapi.routing import APIRoute
    from core.permission_catalog import all_keys
    from core.role_seed import DEFAULT_ROLES

    valid_keys = set(all_keys())

    # Check all role matrices
    for rdef in DEFAULT_ROLES.values():
        for p in rdef.permissions:
            assert p in valid_keys, f"Role {rdef.name} has non-catalog permission '{p}'"

    # Check all route guards
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        endpoint = r.endpoint
        guard_single = getattr(endpoint, "hrflow_permission", None)
        guard_all = getattr(endpoint, "hrflow_permission_all", None)
        guard_self = getattr(endpoint, "hrflow_permission_self", None)

        for dep in getattr(r.dependant, "dependencies", []):
            call_fn = dep.call
            if hasattr(call_fn, "hrflow_permission"):
                guard_single = call_fn.hrflow_permission
            if hasattr(call_fn, "hrflow_permission_all"):
                guard_all = call_fn.hrflow_permission_all
            if hasattr(call_fn, "hrflow_permission_self"):
                guard_self = call_fn.hrflow_permission_self

        for g in [guard_single, guard_all, guard_self]:
            if g and isinstance(g, str):
                assert g in valid_keys, f"Route {r.path} uses non-catalog permission key '{g}'"


def test_no_require_admin_or_legacy_role_or_wildcard_in_code():
    """
    Slice 8 Acceptance:
    Repository code has no require_admin, no role == 'admin', no '*' in perms.
    """
    import os

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    violations = []
    for root, _, files in os.walk(base_dir):
        if "migrations" in root or ".pytest_cache" in root or "__pycache__" in root:
            continue
        for f in files:
            if not f.endswith(".py"):
                continue
            path = os.path.join(root, f)
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                content = fh.read()
            if "require_admin" in content and "test_" not in f:
                violations.append(f"require_admin found in {path}")
            if ('role == "admin"' in content or "role == 'admin'" in content) and "test_" not in f:
                violations.append(f"role == 'admin' found in {path}")
            if ('"*" in perms' in content or "'*' in perms" in content) and "test_" not in f:
                violations.append(f"'*' in perms found in {path}")

    assert violations == [], f"Found forbidden legacy authorization patterns: {violations}"


def test_single_assigned_role_per_user(app_client):
    """
    D-011 amendment: a user holds at most one assigned role; the Employee baseline is derived.
    - PUT /api/access/users/{id}/role replaces the previous role (never adds a second one).
    - The Employee role cannot be assigned (422).
    - A linked employee may have no assigned role and keeps baseline access.
    - The users list reports a single `role` and never the Employee role.
    - The multi-role and alias routes no longer exist.
    """
    with get_db_context() as db:
        sync_catalog(db)
        sa_actor = _create_test_user_with_roles(db, email="sa_single@voyance.health", system_keys=["super_admin"])
        target = _create_test_user_with_roles(db, email="single_target@voyance.health", system_keys=["hr_admin"], employee_id=777)
        target_id = target["id"]
        ids = {r.system_key: r.id for r in db.query(RoleDB).filter(RoleDB.system_key.isnot(None)).all()}

    sa_cookies = _make_user_cookies(sa_actor)

    # 1. Assigning a new role replaces the old one
    resp = app_client.put(f"/api/access/users/{target_id}/role", json={"role_id": ids["payroll_maker"]}, cookies=sa_cookies)
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"]["system_key"] == "payroll_maker"
    with get_db_context() as db:
        rows = db.query(UserRoleDB).filter(UserRoleDB.user_id == target_id).all()
        assert [r.role_id for r in rows] == [ids["payroll_maker"]]

    # 2. Super-Admin can be assigned as the single role
    resp = app_client.put(f"/api/access/users/{target_id}/role", json={"role_id": ids["super_admin"]}, cookies=sa_cookies)
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"]["system_key"] == "super_admin"
    with get_db_context() as db:
        assert db.query(UserRoleDB).filter(UserRoleDB.user_id == target_id).count() == 1

    # 3. The Employee role is derived and cannot be assigned
    resp = app_client.put(f"/api/access/users/{target_id}/role", json={"role_id": ids["employee"]}, cookies=sa_cookies)
    assert resp.status_code == 422
    assert "cannot be assigned" in resp.text

    # 4. A linked employee may be left with no assigned role
    resp = app_client.put(f"/api/access/users/{target_id}/role", json={"role_id": None}, cookies=sa_cookies)
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] is None
    with get_db_context() as db:
        assert db.query(UserRoleDB).filter(UserRoleDB.user_id == target_id).count() == 0

    # 5. Users list: single `role`, Employee never listed
    listing = app_client.get("/api/access/users", cookies=sa_cookies)
    assert listing.status_code == 200
    for row in listing.json():
        assert "roles" not in row
        assert row["role"] is None or row["role"]["system_key"] != "employee"

    # 6. External user creation rejects the Employee role too
    resp = app_client.post(
        "/api/access/users",
        json={"email": "ext_emp_role@external.com", "name": "Ext", "role_id": ids["employee"]},
        cookies=sa_cookies,
    )
    assert resp.status_code == 422

    # 7. Old multi-role and alias routes are gone
    assert app_client.put(f"/api/access/users/{target_id}/roles", json={"role_ids": [ids["hr_admin"]]}, cookies=sa_cookies).status_code in (404, 405)
    assert app_client.put(f"/api/access/users/{target_id}", json={"role": "super_admin"}, cookies=sa_cookies).status_code in (404, 405)


def test_r4_blocks_delete_for_custom_role_holder(app_client):
    """R4 regression: a custom role (system_key NULL) counts as an assigned role above the baseline."""
    with get_db_context() as db:
        sync_catalog(db)
        sa = _create_test_user_with_roles(db, email="sa_r4_custom@voyance.health", system_keys=["super_admin"])
        if not db.query(EmployeeDB).filter(EmployeeDB.id == 778).first():
            db.add(EmployeeDB(id=778, name="Custom Role Holder", email="custom_holder@voyance.health", dept="Tech", job_role="Eng"))
        if not db.query(RoleDB).filter(RoleDB.name == "Custom-R4-Role").first():
            db.add(RoleDB(name="Custom-R4-Role", is_locked=False))
        db.flush()
        holder = _create_test_user_with_roles(db, email="custom_holder@voyance.health", role_names=["Custom-R4-Role"], employee_id=778)
        holder_id = holder["id"]

    resp = app_client.delete("/api/employees/778", cookies=_make_user_cookies(sa))
    assert resp.status_code == 409
    assert "Users page" in resp.text
    with get_db_context() as db:
        assert db.query(UserDB).filter(UserDB.id == holder_id).first() is not None
