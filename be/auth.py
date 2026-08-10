"""
auth.py
Authentication for HRFlow via "Sign in with Google" - verifies a Google ID
token and enforces the Workspace domain restriction.

Session tokens issued after a successful Google sign-in are consumed by
the rest of the API via get_current_user / require_admin, or (for
document preview/download links embedded in <a>/<iframe> tags that cannot
send an Authorization header) via get_current_user_from_token_param.
"""
import time
import jwt
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from config import Config
from sheets_client import get_client

bearer_scheme = HTTPBearer()
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

    if Config.ALLOWED_WORKSPACE_DOMAIN:
        hd = payload.get("hd", "")
        if hd.lower() != Config.ALLOWED_WORKSPACE_DOMAIN.lower():
            raise HTTPException(
                status_code=403,
                detail=f"Only @{Config.ALLOWED_WORKSPACE_DOMAIN} Google Workspace accounts are allowed",
            )
    return payload


def create_session_token(email: str, role: str, employee_id, name: str = ""):
    payload = {
        "email": email,
        "role": role,
        "employee_id": employee_id,
        "name": name,
        "exp": int(time.time()) + Config.TOKEN_EXPIRY_HOURS * 3600,
    }
    return jwt.encode(payload, Config.SECRET_KEY, algorithm="HS256")


def decode_session_token(token: str):
    try:
        return jwt.decode(token, Config.SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def _find_user_by_email(email: str):
    client = get_client()
    users = client.get_all_records("Users")
    email = email.strip().lower()
    for u in users:
        if u["email"].strip().lower() == email:
            return u
    return None


def login_with_google(credential: str):
    """Verifies the Google credential and matches it to a row in the Users
    tab. Returns None if the email has no HRFlow account yet."""
    google_payload = verify_google_credential(credential)
    email = google_payload["email"]
    name = google_payload.get("name", "")

    user = _find_user_by_email(email)
    if not user:
        return None
    token = create_session_token(user["email"], user["role"], user.get("employee_id"), name)
    return {"token": token, "role": user["role"], "employee_id": user.get("employee_id"), "name": name}


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    token = credentials.credentials
    payload = decode_session_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return current_user


def get_current_user_from_token_param(token: str) -> dict:
    """
    Same session validation as get_current_user, but for the token passed
    as a `?token=` query string parameter instead of an Authorization
    header. Needed for document preview/download links opened directly by
    the browser (e.g. in an <a target="_blank">, <iframe>, or <img> tag),
    which cannot attach custom headers.
    """
    payload = decode_session_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session. Please sign in again.",
        )
    return payload
