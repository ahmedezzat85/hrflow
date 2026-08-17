"""
routers/auth.py
Authentication endpoints: Google Sign-In, session check, logout. Moved
from main.py during the router-decomposition refactor - pure structural
move, no behavior change.
"""
from fastapi import APIRouter, Depends, HTTPException, Response

from config import Config
from logging_config import get_logger
from auth import login_with_google, get_current_user
from models import GoogleLoginRequest, LoginResponse

logger = get_logger("main")
router = APIRouter(prefix="/api/auth", tags=["Auth"])


def _set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key=Config.SESSION_COOKIE_NAME,
        value=token,
        max_age=Config.TOKEN_EXPIRY_HOURS * 3600,
        httponly=True,
        secure=Config.COOKIE_SECURE,
        samesite=Config.COOKIE_SAMESITE,
        path="/",
    )


def _clear_session_cookie(response: Response):
    response.delete_cookie(key=Config.SESSION_COOKIE_NAME, path="/")


@router.post("/google", response_model=LoginResponse)
def api_google_login(payload: GoogleLoginRequest, response: Response):
    logger.info("Google login attempt received")
    result = login_with_google(payload.credential)
    if not result:
        logger.warning("Google login rejected: credential valid but no matching HRFlow user found")
        raise HTTPException(
            status_code=403,
            detail="This Google account is not registered in HRFlow. Ask your HR admin to add you as an employee first.",
        )
    logger.info("Google login successful: role=%s, employee_id=%s", result.get("role"), result.get("employee_id"))
    _set_session_cookie(response, result["token"])
    return LoginResponse(role=result["role"], employee_id=result.get("employee_id"), name=result.get("name"))


@router.get("/me", response_model=LoginResponse)
def api_get_current_session(current_user: dict = Depends(get_current_user)):
    return LoginResponse(
        role=current_user["role"],
        employee_id=current_user.get("employee_id"),
        name=current_user.get("name"),
    )


@router.post("/logout")
def api_logout(response: Response):
    _clear_session_cookie(response)
    return {"message": "Signed out"}
