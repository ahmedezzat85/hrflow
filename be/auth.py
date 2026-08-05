"""
auth.py
Authentication for HRFlow. Supports TWO sign-in methods:

  1. "Sign in with Google" (primary, recommended) - verifies a Google ID
     token and enforces the Workspace domain restriction.
  2. Dummy email/password login (fallback, for testing/demo purposes only)
     - accepts any email that already exists in the Users tab, paired with
       a single shared TEST_PASSWORD. No real passwords are stored anywhere;
       this exists purely so the app is usable/testable before Google OAuth
       is fully configured, or for local demos.

Both paths issue the SAME kind of session token, so the rest of the API
(get_current_user / require_admin) doesn't need to know which method was used.
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

# Shared dummy password for the test/demo login path. NOT secure - intended
# only for local testing until Google Sign-In is fully wired up, or for
# quick demos where creating real Google test accounts is inconvenient.
TEST_PASSWORD = "demo1234"


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
    print(f"Looking up user by email: {email}")
    client = get_client()
    users = client.get_all_records("Users")
    email = email.strip().lower()
    for u in users:
        print(f"Checking user: {u['email']}")
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


def login_with_password(email: str, password: str):
    """
    DUMMY / TEST-ONLY login path. Accepts any email that exists in the
    Users tab, as long as the password matches the single shared
    TEST_PASSWORD constant above. Returns None on any mismatch.

    This intentionally does NOT check per-user passwords - there are none
    stored, by design (see module docstring). Swap this out for a real
    password check (e.g. bcrypt hashes in the Users tab) if you decide not
    to rely on Google Sign-In exclusively later on.
    """
    if password != TEST_PASSWORD:
        return None
    user = _find_user_by_email(email)
    if not user:
        return None
    token = create_session_token(user["email"], user["role"], user.get("employee_id"), user.get("name", ""))
    return {"token": token, "role": user["role"], "employee_id": user.get("employee_id"), "name": ""}


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
