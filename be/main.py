"""
main.py
HRFlow backend - FastAPI REST API backed entirely by a Google Sheet, with
employee document files and company-wide documents (Document Hub) stored
in Google Drive (per-employee sub-folders + a shared Company Documents
sub-folder).

This file is intentionally thin: it wires up the app, security/logging
middleware, and includes each domain's router. Endpoint logic lives in
routers/*.py, and shared cross-router helpers live in deps.py and
services/*.py. See docs/analysis/architecture-review-plan.md for the
router-decomposition rationale (this refactor is a pure structural move -
no behavior change from the previous single-file main.py).
"""
import time
import uuid
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import Config
from logging_config import setup_logging, get_logger

from routers import auth as auth_router
from routers import employees as employees_router
from routers import documents as documents_router
from routers import requests as requests_router
from routers import vacations as vacations_router
from routers import insurance as insurance_router
from routers import salary as salary_router
from routers import system as system_router

# Re-exported here so existing code/tests that reach into main.py for
# these pure-logic helpers (e.g. be/tests/test_salary_logic.py) keep
# working unmodified after the router split. New code should import
# them from their real homes (routers.insurance / services.uploads)
# instead.
from routers.insurance import compute_consumption as _compute_consumption
from services.uploads import (
    safe_content_disposition_filename as _safe_content_disposition_filename,
    detect_file_signature as _detect_file_signature,
)

setup_logging()
logger = get_logger("main")

# Fails fast (before the app accepts any traffic) if security-critical
# settings are missing or unsafe. See docs/analysis/security-analysis-plan.md
# (Phase 1) and config.py's Config.validate() for details.
Config.validate()

app = FastAPI(title="HRFlow API", version="2.11.0",
              description="HR Management System backend - Google Sheets database, Google Drive document storage (employee + company documents), Sign in with Google authentication only.")

origins = ["*"] if Config.ALLOWED_ORIGINS == "*" else Config.ALLOWED_ORIGINS.split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info(
    "HRFlow API starting up (version=2.11.0, environment=%s, allowed_origins=%s)",
    Config.ENVIRONMENT, origins,
)


_CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://accounts.google.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; "
    "img-src 'self' data: https:; "
    "connect-src 'self' https://accounts.google.com; "
    "frame-src https://accounts.google.com; "
    "frame-ancestors 'self';"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = _CSP_POLICY
    if Config.IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Logs every request with a correlation id, status code and duration.
    On unhandled exceptions, logs the full traceback and returns a 500 so
    the client never sees an opaque 502 without a trace in the logs."""
    request_id = uuid.uuid4().hex[:8]
    start = time.time()
    logger.info("[%s] --> %s %s", request_id, request.method, request.url.path)
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.time() - start) * 1000, 1)
        logger.exception("[%s] Unhandled exception while processing %s %s (after %sms)", request_id, request.method, request.url.path, duration_ms)
        return JSONResponse(status_code=500, content={"detail": "Internal server error. Check backend logs for request id " + request_id})
    duration_ms = round((time.time() - start) * 1000, 1)
    log_fn = logger.warning if response.status_code >= 400 else logger.info
    log_fn("[%s] <-- %s %s %s (%sms)", request_id, request.method, request.url.path, response.status_code, duration_ms)
    response.headers["X-Request-ID"] = request_id
    return response


app.include_router(auth_router.router)
app.include_router(employees_router.router)
app.include_router(documents_router.router)
app.include_router(requests_router.router)
app.include_router(vacations_router.router)
app.include_router(insurance_router.router)
app.include_router(salary_router.router)
app.include_router(system_router.router)
