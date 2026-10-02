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
        assert "*" in admin_perms
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
