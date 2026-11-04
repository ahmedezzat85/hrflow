"""
google_oauth.py
The calls HRFlow makes to Google for the OAuth 2.0 authorization-code flow: the sign-in URL (with PKCE), the
one-time code exchange, renewing a session from its refresh token, and revoking one. Kept apart from auth.py so
tests can replace these network calls.
"""
import base64
import hashlib
import secrets
from typing import Optional
from urllib.parse import urlencode

import httpx

from config import Config
from logging_config import get_logger

logger = get_logger("main")

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
SCOPES = "openid email profile"
_TIMEOUT = 10.0


class GoogleGrantRevoked(Exception):
    """Google no longer honours the refresh token (revoked, expired, or the account was disabled)."""


class GoogleUnavailable(Exception):
    """Google could not be reached or answered with an error that says nothing about the grant."""


def new_state_and_verifier():
    """Returns (state, code_verifier): random values for the CSRF check and PKCE."""
    return secrets.token_urlsafe(24), secrets.token_urlsafe(48)


def _challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def build_auth_url(redirect_uri: str, state: str, verifier: str) -> str:
    """Sign-in URL. `access_type=offline` + `prompt=consent` make Google return a refresh token on every sign-in."""
    params = {
        "client_id": Config.GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "select_account consent",
        "state": state,
        "code_challenge": _challenge(verifier),
        "code_challenge_method": "S256",
    }
    if Config.ALLOWED_WORKSPACE_DOMAIN:
        params["hd"] = Config.ALLOWED_WORKSPACE_DOMAIN
    return f"{AUTH_ENDPOINT}?{urlencode(params)}"


def exchange_code(code: str, redirect_uri: str, verifier: str) -> dict:
    """Exchanges the one-time sign-in code. Returns Google's token response (id_token, refresh_token, ...).
    Raises GoogleGrantRevoked when Google rejects the code and GoogleUnavailable on any other failure."""
    try:
        res = httpx.post(TOKEN_ENDPOINT, timeout=_TIMEOUT, data={
            "code": code,
            "client_id": Config.GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": Config.GOOGLE_OAUTH_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        })
    except httpx.HTTPError as exc:
        logger.warning("Google code exchange failed to connect: %s", type(exc).__name__)
        raise GoogleUnavailable() from exc
    if res.status_code == 200:
        return res.json()
    error = _error_code(res)
    logger.warning("Google code exchange refused: status=%s error=%s", res.status_code, error)
    if res.status_code == 400 and error in ("invalid_grant", "access_denied"):
        raise GoogleGrantRevoked()
    raise GoogleUnavailable()


def refresh_grant(refresh_token: str) -> None:
    """Asks Google whether the refresh token still works. Returns normally when it does.
    Raises GoogleGrantRevoked when Google says it does not, GoogleUnavailable when it cannot say."""
    try:
        res = httpx.post(TOKEN_ENDPOINT, timeout=_TIMEOUT, data={
            "client_id": Config.GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": Config.GOOGLE_OAUTH_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        })
    except httpx.HTTPError as exc:
        logger.warning("Google refresh failed to connect: %s", type(exc).__name__)
        raise GoogleUnavailable() from exc
    if res.status_code == 200:
        return
    error = _error_code(res)
    logger.warning("Google refresh refused: status=%s error=%s", res.status_code, error)
    if res.status_code == 400 and error == "invalid_grant":
        raise GoogleGrantRevoked()
    raise GoogleUnavailable()


def _error_code(res: httpx.Response) -> Optional[str]:
    try:
        return res.json().get("error")
    except ValueError:
        return None
