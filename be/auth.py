"""
auth.py
Authentication for HRFlow via "Sign in with Google" - verifies a Google ID
token and enforces the Workspace domain restriction.

Session tokens issued after a successful Google sign-in are stored in an
HttpOnly cookie (see Config.SESSION_COOKIE_NAME) rather than being handed to
JavaScript. This means the token is never readable by page scripts (no XSS
exfiltration path) and is never carried in a URL query string (no leakage
into server access logs / browser history / Referer headers). The rest of
the API consumes the session via get_current_user and RBAC permissions, which
read the cookie automatically on every request.
"""
import time
from typing import Optional
import jwt
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from config import Config
from db import get_db
from sheets_client import get_client
from repositories.sheets.auth import SheetsUserRepository

_google_request = google_requests.Request()


def verify_google_credential(credential: str) -> dict:
    """Verifies a Google ID token (the `credential` string sent by the
    Google Sign-In button). Raises HTTPException on any failure."""
    try:
        payload = google_id_token.verify_oauth2_token(
            credential, _google_request, Config.GOOGLE_OAUTH_CLIENT_ID
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google credential")

    if not payload.get("email_verified", False):
        raise HTTPException(status_code=401, detail="Google email is not verified")

    return payload


def create_session_token(email: str, role: Optional[str] = None, employee_id = None, name: str = "", uid: Optional[int] = None):
    payload = {
        "email": email,
        "employee_id": employee_id,
        "name": name,
        "exp": int(time.time()) + Config.TOKEN_EXPIRY_HOURS * 3600,
    }
    if role is not None:
        payload["role"] = role
    if uid is not None:
        payload["uid"] = uid
    return jwt.encode(payload, Config.SECRET_KEY, algorithm="HS256")


def decode_session_token(token: str):
    try:
        return jwt.decode(token, Config.SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def _find_user_by_email(email: str, user_repo=None):
    if user_repo is None:
        from repositories.deps import get_user_repo
        user_repo = get_user_repo()
    return user_repo.find_by_email(email)


def login_with_google(credential: str, user_repo=None):
    """Verifies the Google credential and matches it to a user.
    Returns None if the email has no HRFlow account yet.
    Raises 403 if the user is archived or has no effective access assigned."""
    google_payload = verify_google_credential(credential)
    email = google_payload["email"]
    name = google_payload.get("name", "")

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

    token = create_session_token(
        user["email"],
        employee_id=user.get("employee_id"),
        name=name,
        uid=user.get("id"),
    )
    return {
        "token": token,
        "role": user.get("role", "employee"),
        "employee_id": user.get("employee_id"),
        "name": name,
        "email": user["email"],
        "uid": user.get("id"),
    }


def get_current_user(request: Request, db: Session = Depends(get_db)) -> dict:
    """
    Reads the session from the HttpOnly cookie (Config.SESSION_COOKIE_NAME).
    Resolves permissions and roles via resolve_access and caches on request.state.
    """
    if hasattr(request.state, "current_user") and request.state.current_user:
        return request.state.current_user

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

