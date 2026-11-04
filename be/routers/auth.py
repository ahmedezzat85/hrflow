"""
routers/auth.py
Authentication endpoints: Google sign-in (OAuth 2.0 authorization-code flow with PKCE), session check, logout.

Sign-in is two top-level browser navigations, so the browser never handles a Google token:
  GET /api/auth/google/start    -> redirects to Google; a short-lived signed cookie remembers state + PKCE verifier
  GET /api/auth/google/callback -> Google returns here with a one-time code; the backend exchanges it, stores the
                                   refresh token (encrypted), sets the session cookie and redirects to the app.
A refused sign-in redirects back to the app with ?login_error=<code>; the codes are fixed, never free text.
"""
import secrets
import time
from typing import Optional
from urllib.parse import urlparse

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

import google_oauth
from config import Config
from logging_config import get_logger
from auth import (
    clear_session_cookie, decode_session_token, get_current_user, revoke_session, set_session_cookie,
    sign_in_with_google_code,
)
from models import LoginResponse
from repositories.interfaces import UserRepository
from repositories.deps import get_user_repo
from db import get_db
from core.permissions import resolve_access, AccessContext

logger = get_logger("main")
router = APIRouter(prefix="/api/auth", tags=["Auth"])

CALLBACK_PATH = "/api/auth/google/callback"
OAUTH_STATE_COOKIE = "hrflow_oauth_state"
_OAUTH_STATE_SECONDS = 600


def _origin(url: str) -> Optional[str]:
    parts = urlparse(url or "")
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}"


def _origin_allowed(origin: Optional[str], request: Request) -> bool:
    """An origin may receive the browser back from Google when it is the one serving this request, a configured
    frontend origin, or (outside production, where ALLOWED_ORIGINS may be '*') a local development address."""
    if not origin:
        return False
    if origin == f"{request.url.scheme}://{request.url.netloc}":
        return True
    allowed = [o.strip().rstrip("/") for o in Config.ALLOWED_ORIGINS.split(",") if o.strip()]
    if origin in allowed:
        return True
    return not Config.IS_PRODUCTION and urlparse(origin).hostname in ("localhost", "127.0.0.1", "::1")


def _login_error_code(exc: HTTPException) -> str:
    detail = str(exc.detail).lower()
    if exc.status_code == 403:
        return "archived" if "archived" in detail else "no_access"
    if exc.status_code == 401 and "not verified" in detail:
        return "unverified"
    return "failed"


def _return_to_app(return_origin: str, error: Optional[str] = None) -> RedirectResponse:
    target = f"{return_origin}/" + (f"?login_error={error}" if error else "")
    response = RedirectResponse(target, status_code=302)
    response.delete_cookie(key=OAUTH_STATE_COOKIE, path="/api/auth/google")
    return response


@router.get("/google/start")
def api_google_start(request: Request, return_to: str = ""):
    """Starts the Google sign-in: redirects the browser to Google. `return_to` is the app origin to come back to."""
    api_origin = f"{request.url.scheme}://{request.url.netloc}"
    return_origin = _origin(return_to)
    if not _origin_allowed(return_origin, request):
        return_origin = api_origin
    if not Config.GOOGLE_OAUTH_CLIENT_ID or not Config.GOOGLE_OAUTH_CLIENT_SECRET:
        logger.error("Google sign-in is not configured (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)")
        return _return_to_app(return_origin, "not_configured")

    redirect_uri = api_origin + CALLBACK_PATH
    state, verifier = google_oauth.new_state_and_verifier()
    state_token = jwt.encode(
        {"state": state, "verifier": verifier, "redirect_uri": redirect_uri, "return_origin": return_origin,
         "exp": int(time.time()) + _OAUTH_STATE_SECONDS},
        Config.SECRET_KEY, algorithm="HS256",
    )
    response = RedirectResponse(google_oauth.build_auth_url(redirect_uri, state, verifier), status_code=302)
    response.set_cookie(
        key=OAUTH_STATE_COOKIE, value=state_token, max_age=_OAUTH_STATE_SECONDS, httponly=True,
        secure=Config.COOKIE_SECURE, samesite=Config.COOKIE_SAMESITE, path="/api/auth/google",
    )
    return response


@router.get("/google/callback")
def api_google_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    user_repo: UserRepository = Depends(get_user_repo),
    db: Session = Depends(get_db),
):
    """Google sends the browser back here. Completes the sign-in and redirects to the app."""
    api_origin = f"{request.url.scheme}://{request.url.netloc}"
    try:
        saved = jwt.decode(request.cookies.get(OAUTH_STATE_COOKIE, ""), Config.SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        logger.warning("Google callback without a valid sign-in state cookie")
        return _return_to_app(api_origin, "failed")
    return_origin = saved["return_origin"]

    if not state or not secrets.compare_digest(state, saved["state"]):
        logger.warning("Google callback state mismatch")
        return _return_to_app(return_origin, "failed")
    if error or not code:
        logger.info("Google sign-in not completed: %s", error or "no code")
        return _return_to_app(return_origin, "denied" if error == "access_denied" else "failed")

    try:
        result = sign_in_with_google_code(code, saved["redirect_uri"], saved["verifier"], db, user_repo=user_repo)
    except HTTPException as exc:
        logger.warning("Google login refused: %s", exc.detail)
        return _return_to_app(return_origin, _login_error_code(exc))
    except google_oauth.GoogleGrantRevoked:
        return _return_to_app(return_origin, "failed")
    except google_oauth.GoogleUnavailable:
        return _return_to_app(return_origin, "unavailable")

    if not result:
        logger.warning("Google login rejected: credential valid but no matching HRFlow user found")
        return _return_to_app(return_origin, "not_registered")

    logger.info("Google login successful: employee_id=%s", result.get("employee_id"))
    response = _return_to_app(return_origin)
    set_session_cookie(response, result["token"], result["max_age"])
    return response


@router.get("/me", response_model=LoginResponse)
def api_get_current_session(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ctx: AccessContext = getattr(request.state, "access_context", None)
    if not ctx:
        ctx = resolve_access(db, current_user)

    return LoginResponse(
        portal=ctx.portal,
        roles=ctx.role_names,
        employee_id=ctx.employee_id,
        name=current_user.get("name"),
        permissions=sorted(list(ctx.permissions)),
    )


@router.post("/logout")
def api_logout(request: Request, response: Response, db: Session = Depends(get_db)):
    payload = decode_session_token(request.cookies.get(Config.SESSION_COOKIE_NAME, ""))
    if payload and payload.get("sid"):
        revoke_session(db, payload["sid"])
    clear_session_cookie(response)
    return {"message": "Signed out"}
