"""
test_oauth_sessions.py
Google OAuth authorization-code sign-in with refresh tokens: the start/callback routes, the auth_sessions row, how
the session JWT is renewed from Google (and what ends a session), and the encryption of the stored refresh token.
Google's side is always faked; no test reaches the network.
"""
import time
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import jwt
import pytest

import google_oauth
from config import Config
from db import get_db_context
from models_db import AuthSessionDB, UserDB
from oauth_helpers import fake_google, google_sign_in, login_error
from token_crypto import decrypt_token, encrypt_token, validate_keys

IDENTITY = {"email": "admin@hrflow.test", "name": "Admin", "email_verified": True}


def _session_rows():
    with get_db_context() as db:
        return [(r.id, r.user_id, r.refresh_token_enc, r.revoked_at, r.absolute_expires_at, r.last_refreshed_at)
                for r in db.query(AuthSessionDB).all()]


def _token(sid, user_id, exp_in=3600, email="admin@hrflow.test"):
    return jwt.encode({"email": email, "uid": user_id, "employee_id": None, "name": "Admin", "sid": sid,
                       "exp": int(time.time()) + exp_in}, Config.SECRET_KEY, algorithm="HS256")


@pytest.fixture
def signed_in(app_client, monkeypatch):
    """A client signed in through the real routes; returns (client, sid, user_id, refresh-calls list)."""
    fake_google(monkeypatch, IDENTITY, refresh_token="rt-plain-secret")
    response = google_sign_in(app_client)
    assert login_error(response) is None
    (sid, user_id, *_), = _session_rows()
    refreshes = []
    monkeypatch.setattr(google_oauth, "refresh_grant", lambda rt: refreshes.append(rt))
    return app_client, sid, user_id, refreshes


def _set_cookie(response):
    return next((c for c in response.headers.get_list("set-cookie") if c.startswith("hrflow_session=")), None)


# ---- start / callback -----------------------------------------------------------------------------------------

def test_start_redirects_to_google_with_pkce_offline_access_and_a_state_cookie(app_client):
    response = app_client.get("/api/auth/google/start", params={"return_to": "http://localhost:5173"}, follow_redirects=False)
    assert response.status_code == 302
    location = urlparse(response.headers["location"])
    assert location.netloc == "accounts.google.com"
    query = {k: v[0] for k, v in parse_qs(location.query).items()}
    assert query["client_id"] == Config.GOOGLE_OAUTH_CLIENT_ID
    assert query["response_type"] == "code"
    assert query["access_type"] == "offline"
    assert "consent" in query["prompt"]
    assert query["code_challenge_method"] == "S256" and query["code_challenge"]
    assert query["scope"] == "openid email profile"
    assert query["redirect_uri"].endswith("/api/auth/google/callback")
    assert "client_secret" not in query
    state_cookie = next(c for c in response.headers.get_list("set-cookie") if c.startswith("hrflow_oauth_state="))
    assert "httponly" in state_cookie.lower()


def test_start_ignores_a_return_to_that_is_not_an_allowed_origin(app_client, monkeypatch):
    monkeypatch.setattr(Config, "ALLOWED_ORIGINS", "https://app.example.com")
    response = app_client.get("/api/auth/google/start", params={"return_to": "https://evil.example.org"}, follow_redirects=False)
    cookie = next(c for c in response.headers.get_list("set-cookie") if c.startswith("hrflow_oauth_state="))
    token = cookie.split(";")[0].split("=", 1)[1]
    assert jwt.decode(token, Config.SECRET_KEY, algorithms=["HS256"])["return_origin"] == "http://testserver"


def test_start_reports_a_missing_client_secret_without_leaving_the_app(app_client, monkeypatch):
    monkeypatch.setattr(Config, "GOOGLE_OAUTH_CLIENT_SECRET", "")
    response = app_client.get("/api/auth/google/start", params={"return_to": "http://localhost:5173"}, follow_redirects=False)
    assert response.headers["location"] == "http://localhost:5173/?login_error=not_configured"


def test_callback_signs_in_stores_the_refresh_token_encrypted_and_sets_the_cookie(app_client, monkeypatch):
    calls = fake_google(monkeypatch, IDENTITY, refresh_token="rt-plain-secret")
    response = google_sign_in(app_client, return_to="http://localhost:5173")
    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:5173/"
    assert _set_cookie(response) is not None

    # the one-time code was exchanged with the PKCE verifier and the same redirect_uri the browser used
    assert calls["exchange"][0]["code"] == "one-time-code"
    assert calls["exchange"][0]["verifier"]
    assert calls["exchange"][0]["redirect_uri"].endswith("/api/auth/google/callback")

    (sid, user_id, token_enc, revoked_at, absolute_expires_at, _), = _session_rows()
    assert revoked_at is None
    assert token_enc and "rt-plain-secret" not in token_enc
    assert decrypt_token(token_enc) == "rt-plain-secret"
    assert timedelta(days=Config.SESSION_MAX_AGE_DAYS) - timedelta(minutes=1) < absolute_expires_at - datetime.utcnow()

    me = app_client.get("/api/auth/me")
    assert me.status_code == 200
    payload = jwt.decode(app_client.cookies.get("hrflow_session"), Config.SECRET_KEY, algorithms=["HS256"])
    assert payload["sid"] == sid and payload["uid"] == user_id


def test_the_session_cookie_lives_for_the_absolute_session_not_the_short_token(app_client, monkeypatch):
    fake_google(monkeypatch, IDENTITY)
    cookie = _set_cookie(google_sign_in(app_client))
    max_age = int(next(p.split("=")[1] for p in cookie.split(";") if p.strip().lower().startswith("max-age")))
    assert abs(max_age - Config.SESSION_MAX_AGE_DAYS * 86400) < 120


def test_callback_without_the_state_cookie_or_with_a_wrong_state_fails(app_client):
    no_cookie = app_client.get("/api/auth/google/callback", params={"code": "c", "state": "x"}, follow_redirects=False)
    assert login_error(no_cookie) == "failed"
    app_client.get("/api/auth/google/start", follow_redirects=False)
    wrong = app_client.get("/api/auth/google/callback", params={"code": "c", "state": "not-the-state"}, follow_redirects=False)
    assert login_error(wrong) == "failed"
    assert _session_rows() == []


def test_callback_after_the_user_denies_consent(app_client):
    app_client.get("/api/auth/google/start", params={"return_to": "http://localhost:5173"}, follow_redirects=False)
    start_cookie = app_client.cookies.get("hrflow_oauth_state")
    state = jwt.decode(start_cookie, Config.SECRET_KEY, algorithms=["HS256"])["state"]
    response = app_client.get("/api/auth/google/callback", params={"error": "access_denied", "state": state}, follow_redirects=False)
    assert login_error(response) == "denied"
    assert _session_rows() == []


def test_sign_in_with_a_google_response_that_has_no_refresh_token_is_refused(app_client, monkeypatch):
    fake_google(monkeypatch, IDENTITY, refresh_token=None)
    response = google_sign_in(app_client)
    assert login_error(response) == "failed"
    assert _session_rows() == [] and _set_cookie(response) is None


def test_sign_in_when_google_cannot_be_reached(app_client, monkeypatch):
    def down(code, redirect_uri, verifier):
        raise google_oauth.GoogleUnavailable()
    monkeypatch.setattr(google_oauth, "exchange_code", down)
    assert login_error(google_sign_in(app_client)) == "unavailable"


def test_the_state_cookie_is_single_use(app_client, monkeypatch):
    fake_google(monkeypatch, IDENTITY)
    start = app_client.get("/api/auth/google/start", follow_redirects=False)
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    first = app_client.get("/api/auth/google/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert login_error(first) is None
    replay = app_client.get("/api/auth/google/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert login_error(replay) == "failed"
    assert len(_session_rows()) == 1


# ---- using and renewing a session -------------------------------------------------------------------------------

def test_a_fresh_token_is_not_renewed_and_google_is_not_called(signed_in):
    client, sid, user_id, refreshes = signed_in
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert _set_cookie(response) is None
    assert refreshes == []


def test_a_token_in_the_last_half_of_its_life_is_renewed_from_google(signed_in):
    client, sid, user_id, refreshes = signed_in
    with get_db_context() as db:
        db.get(AuthSessionDB, sid).last_refreshed_at = datetime.utcnow() - timedelta(minutes=40)
        db.commit()
    client.cookies.set("hrflow_session", _token(sid, user_id, exp_in=Config.SESSION_ACCESS_MINUTES * 60 // 4))
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert refreshes == ["rt-plain-secret"]
    renewed = _set_cookie(response)
    assert renewed is not None and "httponly" in renewed.lower()
    new_payload = jwt.decode(renewed.split(";")[0].split("=", 1)[1], Config.SECRET_KEY, algorithms=["HS256"])
    assert new_payload["sid"] == sid and new_payload["uid"] == user_id
    assert new_payload["exp"] > time.time() + Config.SESSION_ACCESS_MINUTES * 60 - 60


def test_an_expired_token_is_renewed_in_the_same_request(signed_in):
    """Back after days away: the short token expired long ago but the session (30 days) is alive."""
    client, sid, user_id, refreshes = signed_in
    client.cookies.set("hrflow_session", _token(sid, user_id, exp_in=-3 * 86400))
    with get_db_context() as db:
        row = db.get(AuthSessionDB, sid)
        row.last_refreshed_at = datetime.utcnow() - timedelta(days=3)
        db.commit()
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert refreshes == ["rt-plain-secret"]
    assert _set_cookie(response) is not None


def test_requests_right_after_a_renewal_do_not_ask_google_again(signed_in):
    client, sid, user_id, refreshes = signed_in
    due = _token(sid, user_id, exp_in=60)
    client.cookies.set("hrflow_session", due)
    with get_db_context() as db:
        row = db.get(AuthSessionDB, sid)
        row.last_refreshed_at = datetime.utcnow() - timedelta(hours=1)
        db.commit()
    assert client.get("/api/auth/me", cookies={"hrflow_session": due}).status_code == 200
    assert client.get("/api/auth/me", cookies={"hrflow_session": due}).status_code == 200
    assert len(refreshes) == 1


def test_google_refusing_the_refresh_token_ends_the_session(signed_in, monkeypatch):
    client, sid, user_id, refreshes = signed_in
    def revoked(rt):
        raise google_oauth.GoogleGrantRevoked()
    monkeypatch.setattr(google_oauth, "refresh_grant", revoked)
    with get_db_context() as db:
        row = db.get(AuthSessionDB, sid)
        row.last_refreshed_at = datetime.utcnow() - timedelta(hours=2)
        db.commit()
    client.cookies.set("hrflow_session", _token(sid, user_id, exp_in=30))
    assert client.get("/api/auth/me").status_code == 401
    (_, _, token_enc, revoked_at, *_), = _session_rows()
    assert revoked_at is not None and token_enc is None
    # and the old cookie never works again, even if Google would now accept the token
    monkeypatch.setattr(google_oauth, "refresh_grant", lambda rt: None)
    client.cookies.set("hrflow_session", _token(sid, user_id))
    assert client.get("/api/auth/me").status_code == 401


def test_google_being_down_does_not_sign_out_a_token_that_is_still_valid(signed_in, monkeypatch):
    client, sid, user_id, refreshes = signed_in
    def down(rt):
        raise google_oauth.GoogleUnavailable()
    monkeypatch.setattr(google_oauth, "refresh_grant", down)
    with get_db_context() as db:
        row = db.get(AuthSessionDB, sid)
        row.last_refreshed_at = datetime.utcnow() - timedelta(hours=2)
        db.commit()
    client.cookies.set("hrflow_session", _token(sid, user_id, exp_in=60))
    response = client.get("/api/auth/me")
    assert response.status_code == 200 and _set_cookie(response) is None
    assert _session_rows()[0][3] is None  # not revoked


def test_google_being_down_for_an_expired_token_is_a_503_not_a_sign_out(signed_in, monkeypatch):
    client, sid, user_id, refreshes = signed_in
    def down(rt):
        raise google_oauth.GoogleUnavailable()
    monkeypatch.setattr(google_oauth, "refresh_grant", down)
    with get_db_context() as db:
        row = db.get(AuthSessionDB, sid)
        row.last_refreshed_at = datetime.utcnow() - timedelta(hours=2)
        db.commit()
    client.cookies.set("hrflow_session", _token(sid, user_id, exp_in=-60))
    assert client.get("/api/auth/me").status_code == 503
    assert _session_rows()[0][3] is None


def test_the_absolute_session_limit_ends_the_session_whatever_the_activity(signed_in):
    client, sid, user_id, refreshes = signed_in
    with get_db_context() as db:
        row = db.get(AuthSessionDB, sid)
        row.absolute_expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/auth/me").status_code == 401
    assert refreshes == []


def test_a_session_row_belonging_to_another_user_is_rejected(signed_in):
    client, sid, user_id, refreshes = signed_in
    with get_db_context() as db:
        other = db.query(UserDB).filter(UserDB.id != user_id).first()
        other_id, other_email = other.id, other.email
    client.cookies.set("hrflow_session", _token(sid, other_id, email=other_email))
    assert client.get("/api/auth/me").status_code == 401


def test_a_token_naming_a_session_that_does_not_exist_is_rejected(signed_in):
    client, sid, user_id, refreshes = signed_in
    client.cookies.set("hrflow_session", _token("0" * 32, user_id))
    assert client.get("/api/auth/me").status_code == 401


def test_a_token_signed_with_another_key_is_rejected(signed_in):
    client, sid, user_id, refreshes = signed_in
    forged = jwt.encode({"email": "admin@hrflow.test", "uid": user_id, "sid": sid, "exp": int(time.time()) + 600},
                        "not-the-secret", algorithm="HS256")
    client.cookies.set("hrflow_session", forged)
    assert client.get("/api/auth/me").status_code == 401


def test_a_token_without_a_session_row_expires_at_its_exp(app_client):
    """Tokens that carry no `sid` (no row to renew from) keep a hard expiry."""
    with get_db_context() as db:
        user_id = db.query(UserDB).filter(UserDB.email == "admin@hrflow.test").first().id
    live = jwt.encode({"email": "admin@hrflow.test", "uid": user_id, "exp": int(time.time()) + 600}, Config.SECRET_KEY, algorithm="HS256")
    dead = jwt.encode({"email": "admin@hrflow.test", "uid": user_id, "exp": int(time.time()) - 5}, Config.SECRET_KEY, algorithm="HS256")
    assert app_client.get("/api/auth/me", cookies={"hrflow_session": live}).status_code == 200
    assert app_client.get("/api/auth/me", cookies={"hrflow_session": dead}).status_code == 401


# ---- ending sessions -------------------------------------------------------------------------------------------

def test_logout_revokes_the_session_and_deletes_the_stored_token(signed_in):
    client, sid, user_id, refreshes = signed_in
    old_cookie = client.cookies.get("hrflow_session")
    assert client.post("/api/auth/logout").status_code == 200
    (_, _, token_enc, revoked_at, *_), = _session_rows()
    assert revoked_at is not None and token_enc is None
    assert client.get("/api/auth/me", cookies={"hrflow_session": old_cookie}).status_code == 401


def test_archiving_a_user_ends_all_their_sessions(signed_in):
    from auth import revoke_user_sessions
    client, sid, user_id, refreshes = signed_in
    with get_db_context() as db:
        revoke_user_sessions(db, user_id)
    (_, _, token_enc, revoked_at, *_), = _session_rows()
    assert revoked_at is not None and token_enc is None
    assert client.get("/api/auth/me").status_code == 401


def test_an_archived_user_is_not_renewed(signed_in):
    client, sid, user_id, refreshes = signed_in
    with get_db_context() as db:
        db.get(UserDB, user_id).archived_at = datetime.utcnow()
        db.commit()
    client.cookies.set("hrflow_session", _token(sid, user_id, exp_in=60))
    response = client.get("/api/auth/me")
    assert response.status_code == 403
    assert refreshes == [] and _set_cookie(response) is None


def test_old_session_rows_are_purged_at_the_next_sign_in(app_client, monkeypatch):
    fake_google(monkeypatch, IDENTITY)
    google_sign_in(app_client)
    with get_db_context() as db:
        row = db.query(AuthSessionDB).first()
        row.absolute_expires_at = datetime.utcnow() - timedelta(days=8)
        db.commit()
    google_sign_in(app_client)
    assert len(_session_rows()) == 1


# ---- encryption --------------------------------------------------------------------------------------------------

def test_token_encryption_round_trips_and_is_not_deterministic():
    a, b = encrypt_token("rt-1"), encrypt_token("rt-1")
    assert a != b and "rt-1" not in a
    assert decrypt_token(a) == decrypt_token(b) == "rt-1"


def test_a_new_first_key_rotates_without_losing_old_tokens(monkeypatch):
    from cryptography.fernet import Fernet
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setattr(Config, "TOKEN_ENCRYPTION_KEY", old)
    stored = encrypt_token("rt-rotate")
    monkeypatch.setattr(Config, "TOKEN_ENCRYPTION_KEY", f"{new},{old}")
    assert decrypt_token(stored) == "rt-rotate"
    monkeypatch.setattr(Config, "TOKEN_ENCRYPTION_KEY", new)
    assert decrypt_token(stored) is None  # old key removed: unreadable, which ends the session safely


def test_validate_keys_rejects_bad_keys():
    from cryptography.fernet import Fernet
    assert validate_keys(Fernet.generate_key().decode()) is None
    assert validate_keys("") is not None
    assert validate_keys("not-a-fernet-key") is not None


def test_production_refuses_to_start_without_the_oauth_secret_and_encryption_key(monkeypatch):
    monkeypatch.setattr(Config, "ENVIRONMENT", "production")
    monkeypatch.setattr(Config, "IS_PRODUCTION", True)
    monkeypatch.setattr(Config, "ALLOWED_ORIGINS", "https://app.example.com")
    monkeypatch.setattr(Config, "ALLOWED_WORKSPACE_DOMAIN", "example.com")
    monkeypatch.setattr(Config, "GOOGLE_OAUTH_CLIENT_SECRET", "")
    monkeypatch.setattr(Config, "TOKEN_ENCRYPTION_KEY", "")
    with pytest.raises(RuntimeError) as exc:
        Config.validate()
    assert "GOOGLE_OAUTH_CLIENT_SECRET" in str(exc.value) and "TOKEN_ENCRYPTION_KEY" in str(exc.value)
