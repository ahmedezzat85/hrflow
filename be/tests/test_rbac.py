"""
be/tests/test_rbac.py
Tests for Phase 1: Core RBAC Skeleton.
Verifies permission resolution, role-permission mappings, user-role assignments,
and FastAPI route protection via require_permission.
"""
import pytest
from sqlalchemy.exc import IntegrityError

from core.rbac_models import PermissionDB, RoleDB, RolePermissionDB, UserRoleDB
from core.permissions import get_user_permissions
from models_db import UserDB
from db import get_db_context


def test_rbac_models_and_seed_data(app_client):
    """Verify that roles, permissions, and initial user assignments exist in the test DB."""
    with get_db_context() as db:
        roles = {r.name: r for r in db.query(RoleDB).all()}
        assert "system_admin" in roles
        assert "employee" in roles

        admin_role = roles["system_admin"]
        employee_role = roles["employee"]

        # system_admin should have all seeded permissions (at least 22)
        assert len(admin_role.permissions) >= 22
        admin_perm_keys = {p.key for p in admin_role.permissions}
        assert "hr.employee.write" in admin_perm_keys
        assert "hr.employee.read" in admin_perm_keys
        assert "system.users.manage" in admin_perm_keys

        # employee should have only the 3 self.* permissions
        employee_perm_keys = {p.key for p in employee_role.permissions}
        assert employee_perm_keys == {
            "self.profile.read",
            "self.payslip.read",
            "self.requests.write",
        }


def test_rbac_unique_constraints(app_client):
    """Verify uniqueness constraints on role_permissions and user_roles."""
    with get_db_context() as db:
        admin_role = db.query(RoleDB).filter(RoleDB.name == "system_admin").first()
        perm = db.query(PermissionDB).first()

        # Duplicate role_permission should raise IntegrityError
        dup_rp = RolePermissionDB(role_id=admin_role.id, permission_id=perm.id)
        db.add(dup_rp)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

        # Duplicate user_role should raise IntegrityError
        user = db.query(UserDB).first()
        dup_ur = UserRoleDB(user_id=user.id, role_id=admin_role.id)
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
        assert "hr.employee.write" in admin_perms
        assert "hr.employee.read" in admin_perms
        assert "self.profile.read" in admin_perms

        emp_user = db.query(UserDB).filter(UserDB.email == "employee@hrflow.test").first()
        assert emp_user is not None
        emp_perms = get_user_permissions(emp_user.id, db)
        assert emp_perms == {
            "self.profile.read",
            "self.payslip.read",
            "self.requests.write",
        }
        assert "hr.employee.write" not in emp_perms
        assert "hr.employee.read" not in emp_perms


def test_require_permission_endpoint_admin_allowed(app_client, admin_cookies):
    """
    Acceptance check 5:
    User with system_admin role has 'hr.employee.write' and can call POST /api/employees.
    """
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
    """
    Acceptance check 5:
    User with only 'employee' role lacks 'hr.employee.write' and gets 403 Forbidden.
    """
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
