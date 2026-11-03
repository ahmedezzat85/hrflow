"""
auth.py
Authentication for HRFlow via the Google OAuth 2.0 authorization-code flow. The backend exchanges the sign-in
code for a Google ID token (who the user is) and a refresh token. The refresh token is stored encrypted in
auth_sessions; HRFlow's own short-lived session JWT carries that row's id (claim `sid`). When the JWT is about
to expire, or has expired, the server asks Google whether the refresh token still works and, if so, issues a new
JWT. Google refusing it, a revoked row, or the absolute session limit ends the session.

Session tokens are stored in an HttpOnly cookie (see Config.SESSION_COOKIE_NAME) rather than being handed to
JavaScript. This means the token is never readable by page scripts (no XSS
exfiltration path) and is never carried in a URL query string (no leakage
into server access logs / browser history / Referer headers). The rest of
the API consumes the session via get_current_user and RBAC permissions, which
read the cookie automatically on every request.
"""
import secrets
import threading
import time
from datetime import datetime, timedelta
from typing import Optional
import jwt
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

import api_tokens
import config as config_module
import google_oauth
from config import Config
from db import get_db
from logging_config import get_logger
from token_crypto import decrypt_token, encrypt_token

logger = get_logger("main")

_google_request = google_requests.Request()


def verify_google_credential(credential: str) -> dict:
    """Verifies a Google ID token (the `id_token` Google returns from the code exchange).
    Raises HTTPException on any failure."""
    try:
        payload = google_id_token.verify_oauth2_token(
            credential, _google_request, Config.GOOGLE_OAUTH_CLIENT_ID
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google credential")

    if not payload.get("email_verified", False):
        raise HTTPException(status_code=401, detail="Google email is not verified")

    return payload


def create_session_token(email: str, role: Optional[str] = None, employee_id = None, name: str = "", uid: Optional[int] = None,
                         sid: Optional[str] = None):
    payload = {
        "email": email,
        "employee_id": employee_id,
        "name": name,
        "exp": int(time.time()) + Config.SESSION_ACCESS_MINUTES * 60,
    }
    if role is not None:
        payload["role"] = role
    if uid is not None:
        payload["uid"] = uid
    if sid is not None:
        payload["sid"] = sid
    return jwt.encode(payload, Config.SECRET_KEY, algorithm="HS256")


def decode_session_token(token: str):
    """Returns the payload of a correctly signed token, else None. A token tied to an auth_sessions row (`sid`)
    is returned even when its `exp` has passed: `exp` is when the server must next ask Google, and
    get_current_user does that. A token without `sid` has no row to renew from, so `exp` is final."""
    try:
        payload = jwt.decode(token, Config.SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False})
    except jwt.PyJWTError:
        return None
    if not payload.get("sid") and payload.get("exp", 0) <= time.time():
        return None
    return payload


def set_session_cookie(response: Response, token: str, max_age: int):
    cfg = config_module.Config  # read at call time so a reloaded config module is honoured
    response.set_cookie(
        key=cfg.SESSION_COOKIE_NAME,
        value=token,
        max_age=max(int(max_age), 1),
        httponly=True,
        secure=cfg.COOKIE_SECURE,
        samesite=cfg.COOKIE_SAMESITE,
        path="/",
    )


def clear_session_cookie(response: Response):
    response.delete_cookie(key=Config.SESSION_COOKIE_NAME, path="/")


def _find_user_by_email(email: str, user_repo=None):
    if user_repo is None:
        from repositories.deps import get_user_repo
        user_repo = get_user_repo()
    return user_repo.find_by_email(email)


def _authorize_google_user(google_payload: dict, user_repo=None) -> Optional[dict]:
    """Matches a verified Google identity to an HRFlow user. Returns None if the email has no HRFlow account yet.
    Raises 403 if the user is archived or has no effective access assigned."""
    email = google_payload["email"]

    user = _find_user_by_email(email, user_repo=user_repo)
    if not user:
        return None

    if user.get("archived_at") is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is archived",
        )

    # Effective access check: user must have a linked employee or an assigned role
    has_effective_access = bool(user.get("employee_id") is not None or user.get("has_roles"))
    if not has_effective_access:
        from db import get_db_context
        from models_db import UserDB
        with get_db_context() as db:
            db_u = db.query(UserDB).filter(UserDB.email.ilike(email.strip())).first()
            if db_u:
                if db_u.archived_at is not None:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="User account is archived",
                    )
                if db_u.employee_id is not None or len(db_u.user_roles) > 0:
                    has_effective_access = True

    if not has_effective_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access assigned. Contact your administrator.",
        )
    return user


def _absolute_remaining_seconds(row) -> int:
    return int((row.absolute_expires_at - datetime.utcnow()).total_seconds())


def _purge_old_sessions(db: Session):
    from models_db import AuthSessionDB
    cutoff = datetime.utcnow() - timedelta(days=7)
    db.query(AuthSessionDB).filter(
        (AuthSessionDB.absolute_expires_at < cutoff) | (AuthSessionDB.revoked_at < cutoff)
    ).delete(synchronize_session=False)


def sign_in_with_google_code(code: str, redirect_uri: str, verifier: str, db: Session, user_repo=None):
    """Completes a Google sign-in: exchanges the code, verifies the ID token, matches the user, stores the
    encrypted refresh token in a new auth_sessions row and returns the session cookie token. Returns None if
    the Google account has no HRFlow user. Raises HTTPException for refused accounts and the google_oauth
    exceptions when Google rejects the code or cannot be reached."""
    from models_db import AuthSessionDB

    tokens = google_oauth.exchange_code(code, redirect_uri, verifier)
    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Invalid Google credential")
    google_payload = verify_google_credential(id_token)

    user = _authorize_google_user(google_payload, user_repo=user_repo)
    if not user:
        return None

    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        logger.error("Google returned no refresh token for a successful sign-in; the session cannot be renewed")
        raise HTTPException(status_code=502, detail="Google did not return a refresh token")

    name = google_payload.get("name", "")
    now = datetime.utcnow()
    sid = secrets.token_hex(16)
    _purge_old_sessions(db)
    row = AuthSessionDB(
        id=sid,
        user_id=user["id"],
        refresh_token_enc=encrypt_token(refresh_token),
        created_at=now,
        last_refreshed_at=now,
        absolute_expires_at=now + timedelta(days=Config.SESSION_MAX_AGE_DAYS),
    )
    db.add(row)
    db.commit()

    return {
        "token": create_session_token(user["email"], employee_id=user.get("employee_id"), name=name, uid=user.get("id"), sid=sid),
        "max_age": _absolute_remaining_seconds(row),
        "employee_id": user.get("employee_id"),
        "name": name,
        "email": user["email"],
        "uid": user.get("id"),
    }


def revoke_session(db: Session, sid: str):
    """Ends one session and deletes its stored refresh token."""
    from models_db import AuthSessionDB
    row = db.get(AuthSessionDB, sid)
    if row is not None and row.revoked_at is None:
        row.revoked_at = datetime.utcnow()
        row.refresh_token_enc = None
        db.commit()


def revoke_user_sessions(db: Session, user_id: int):
    """Ends every session of a user (used when the user is archived) and deletes their stored refresh tokens."""
    from models_db import AuthSessionDB
    db.query(AuthSessionDB).filter(
        AuthSessionDB.user_id == user_id, AuthSessionDB.revoked_at.is_(None)
    ).update({"revoked_at": datetime.utcnow(), "refresh_token_enc": None}, synchronize_session=False)
    db.commit()
    api_tokens.revoke_user_tokens(db, user_id)


# One in-process lock per session, so concurrent requests carrying the same due token ask Google once.
_renew_locks: dict = {}
_renew_locks_guard = threading.Lock()
_RECENT_RENEWAL_SECONDS = 60


def _renew_lock(sid: str) -> threading.Lock:
    with _renew_locks_guard:
        return _renew_locks.setdefault(sid, threading.Lock())


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _google_unreachable() -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                         detail="Could not confirm your session with Google. Try again.")


def _check_and_renew_session(db: Session, request: Request, payload: dict, user_id: int):
    """Validates the auth_sessions row behind a token and, when the token's `exp` is within half the access
    window (or past), renews it from Google. A renewed token is left on request.state for the cookie
    middleware. Raises 401 when the session is over and 503 when it is due but Google cannot be reached."""
    from models_db import AuthSessionDB

    sid = payload["sid"]
    row = db.get(AuthSessionDB, sid)
    if (row is None or row.revoked_at is not None or row.user_id != user_id
            or row.absolute_expires_at <= datetime.utcnow()):
        raise _unauthorized("Invalid or expired session. Please sign in again.")

    now = time.time()
    exp = payload.get("exp", 0)
    if exp - now > Config.SESSION_ACCESS_MINUTES * 30:
        return
    expired = exp <= now

    lock = _renew_lock(sid)
    acquired = lock.acquire(timeout=15) if expired else lock.acquire(blocking=False)
    if not acquired:
        if expired:
            raise _google_unreachable()
        return
    try:
        db.refresh(row)
        if row.revoked_at is not None:
            raise _unauthorized("Invalid or expired session. Please sign in again.")
        if (datetime.utcnow() - row.last_refreshed_at).total_seconds() > _RECENT_RENEWAL_SECONDS:
            refresh_token = decrypt_token(row.refresh_token_enc) if row.refresh_token_enc else None
            try:
                if not refresh_token:
                    raise google_oauth.GoogleGrantRevoked()
                google_oauth.refresh_grant(refresh_token)
            except google_oauth.GoogleGrantRevoked:
                logger.info("Google no longer honours the refresh token of a session (user_id=%s); ending it", user_id)
                revoke_session(db, sid)
                raise _unauthorized("Your Google session has ended. Please sign in again.")
            except google_oauth.GoogleUnavailable:
                if expired:
                    raise _google_unreachable()
                return
            row.last_refreshed_at = datetime.utcnow()
            db.commit()
        new_token = create_session_token(
            payload["email"], employee_id=payload.get("employee_id"), name=payload.get("name", ""),
            uid=payload.get("uid"), sid=sid,
        )
        request.state.refreshed_session_token = (new_token, _absolute_remaining_seconds(row))
    finally:
        lock.release()


def _authenticate_api_token(request: Request, db: Session, secret: str) -> dict:
    """A personal access token (api_tokens.py): the token's user, with permissions narrowed to its scopes.
    No cookie is read or set; the token cannot reach routes beyond what its scopes allow."""
    from core.permissions import has_admin_surface, resolve_access

    row = api_tokens.lookup_token(db, secret)
    if row is None:
        raise _unauthorized("Invalid or expired API token.")
    ctx = api_tokens.narrow_context(resolve_access(db, {"uid": row.user_id}), row.scopes)
    request.state.access_context = ctx
    user_dict = {
        "user_id": ctx.user_id,
        "id": ctx.user_id,
        "email": ctx.email,
        "employee_id": ctx.employee_id,
        "name": ctx.email.split("@")[0],
        "permissions": sorted(ctx.permissions),
        "roles": ctx.role_names,
        "portal": "admin" if has_admin_surface(ctx.permissions) else "employee",
        "is_super_admin": False,
        "api_token_id": row.id,
    }
    request.state.current_user = user_dict
    return user_dict


def get_current_user(request: Request, db: Session = Depends(get_db)) -> dict:
    """
    Reads the session from the HttpOnly cookie (Config.SESSION_COOKIE_NAME).
    Resolves permissions and roles via resolve_access and caches on request.state.
    A session backed by an auth_sessions row is validated and, when due, renewed from Google.
    """
    if hasattr(request.state, "current_user") and request.state.current_user:
        return request.state.current_user

    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer " + api_tokens.TOKEN_PREFIX):
        return _authenticate_api_token(request, db, authorization[7:].strip())

    token = request.cookies.get(Config.SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not signed in. Please sign in again.",
        )
    payload = decode_session_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session. Please sign in again.",
        )

    from core.permissions import resolve_access
    ctx = resolve_access(db, payload)
    request.state.access_context = ctx

    if payload.get("sid"):
        _check_and_renew_session(db, request, payload, ctx.user_id)

    user_dict = {
        "user_id": ctx.user_id,
        "id": ctx.user_id,
        "email": ctx.email,
        "employee_id": ctx.employee_id,
        "name": payload.get("name", "") or ctx.email.split("@")[0],
        "permissions": sorted(list(ctx.permissions)),
        "roles": ctx.role_names,
        "portal": ctx.portal,
        "is_super_admin": ctx.is_super_admin,
    }
    request.state.current_user = user_dict
    return user_dict
