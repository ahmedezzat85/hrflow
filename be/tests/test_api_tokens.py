"""
test_api_tokens.py
Personal access tokens for the MCP server (MCP-1): bearer authentication, scope narrowing, expiry/revocation,
and that a token never reaches beyond its scopes. Tokens exist only as hashes.
"""
from datetime import datetime, timedelta

import pytest

import api_tokens
from conftest import add_test_user
from db import get_db_context
from models_db import ApiTokenDB


def _make_token(email="admin@hrflow.test", role_key="super_admin", employee_id=1, scopes=("mcp:read",), days=30):
    with get_db_context() as db:
        uid = add_test_user(db, email, role_key=role_key, employee_id=employee_id)
        row, secret = api_tokens.create_token(db, uid, "test", list(scopes), days)
        return row.id, secret


def _bearer(secret):
    return {"Authorization": f"Bearer {secret}"}


def test_valid_token_authenticates_as_its_user(app_client):
    _, secret = _make_token()
    response = app_client.get("/api/auth/me", headers=_bearer(secret))
    assert response.status_code == 200
    assert response.json()["name"] == "admin"
    assert set(response.json()["permissions"]) == api_tokens.SCOPES["mcp:read"]


def test_token_is_stored_as_hash_only(app_client):
    token_id, secret = _make_token()
    with get_db_context() as db:
        row = db.get(ApiTokenDB, token_id)
        assert secret not in (row.token_hash, row.name, row.scopes)
        assert row.token_hash == api_tokens.hash_token(secret)
    assert secret.startswith("hrf_") and len(secret) > 40


def test_unknown_token_is_401_and_does_not_fall_back_to_cookie(app_client, admin_cookies):
    response = app_client.get("/api/auth/me", headers=_bearer("hrf_not-a-real-token"), cookies=admin_cookies)
    assert response.status_code == 401


def test_expired_token_is_401(app_client):
    token_id, secret = _make_token()
    with get_db_context() as db:
        db.get(ApiTokenDB, token_id).expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    assert app_client.get("/api/auth/me", headers=_bearer(secret)).status_code == 401


def test_revoked_token_is_401(app_client):
    token_id, secret = _make_token()
    with get_db_context() as db:
        db.get(ApiTokenDB, token_id).revoked_at = datetime.utcnow()
        db.commit()
    assert app_client.get("/api/auth/me", headers=_bearer(secret)).status_code == 401


def test_archived_user_token_is_rejected(app_client):
    _, secret = _make_token(email="archived@hrflow.test", role_key="hr_admin", employee_id=None)
    with get_db_context() as db:
        from models_db import UserDB
        db.query(UserDB).filter(UserDB.email == "archived@hrflow.test").one().archived_at = datetime.utcnow()
        db.commit()
    assert app_client.get("/api/auth/me", headers=_bearer(secret)).status_code in (401, 403)


def test_scope_narrows_a_super_admin_to_read_permissions(app_client):
    _, secret = _make_token(scopes=("mcp:read",))
    # Within scope: employee list is readable.
    assert app_client.get("/api/employees", headers=_bearer(secret)).status_code == 200
    # Outside scope: Super-Admin power is not inherited. Writing leave and reading finance/users are forbidden.
    assert app_client.post("/api/vacations/request", headers=_bearer(secret),
                           json={"employee_id": 2, "start_date": "2026-01-04", "end_date": "2026-01-05"}).status_code == 403
    assert app_client.get("/api/access/users", headers=_bearer(secret)).status_code == 403


def test_token_cannot_exceed_owner_role(app_client):
    # A user with no HR permission gets nothing from a token, whatever the scope says.
    _, secret = _make_token(email="plain@hrflow.test", role_key=None, employee_id=2)
    assert app_client.get("/api/employees", headers=_bearer(secret)).status_code == 403


def test_token_use_sets_no_cookie(app_client):
    _, secret = _make_token()
    response = app_client.get("/api/auth/me", headers=_bearer(secret))
    assert "set-cookie" not in response.headers


def test_create_rejects_unknown_scope_and_bad_lifetime(app_client):
    with get_db_context() as db:
        uid = add_test_user(db, "x@hrflow.test", role_key="hr_admin")
        with pytest.raises(ValueError):
            api_tokens.create_token(db, uid, "t", ["admin:all"])
        with pytest.raises(ValueError):
            api_tokens.create_token(db, uid, "t", ["mcp:read"], days=api_tokens.MAX_DAYS + 1)


def test_archiving_helper_revokes_tokens(app_client):
    token_id, _ = _make_token()
    with get_db_context() as db:
        uid = db.get(ApiTokenDB, token_id).user_id
        api_tokens.revoke_user_tokens(db, uid)
        assert db.get(ApiTokenDB, token_id).revoked_at is not None
