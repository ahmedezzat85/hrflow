"""
main.py
HRFlow backend - FastAPI REST API backed entirely by a Google Sheet, with
employee document files and company-wide documents (Document Hub) stored
in Google Drive (per-employee sub-folders + a shared Company Documents
sub-folder).
"""
import time
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from config import Config
from logging_config import setup_logging, get_logger
from sheets_client import get_client
from drive_client import get_drive_client
from auth import login_with_google, get_current_user, require_admin
from models import (
    GoogleLoginRequest, LoginResponse, EmployeeCreate, EmployeeUpdate,
    RequestCreate, RequestAction, VacationRequestCreate,
    InsuranceCategoryCreate, InsuranceCategoryUpdate,
    InsuranceClaimCreate, InsuranceClaimAction, RaiseApply, EmployeeNoteCreate,
    EmployeeDocumentCreate, CompanyDocumentCreate,
)

setup_logging()
logger = get_logger("main")

# Fails fast (before the app accepts any traffic) if security-critical
# settings are missing or unsafe. See docs/analysis/security-analysis-plan.md
# (Phase 1) and config.py's Config.validate() for details.
Config.validate()

app = FastAPI(title="HRFlow API", version="2.8.0",
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
    "HRFlow API starting up (version=2.8.0, environment=%s, allowed_origins=%s)",
    Config.ENVIRONMENT, origins,
)


# ---------------------------------------------------------------------------
# Phase 3 security headers (docs/analysis/security-analysis-plan.md).
# Applied to every response. CSP is deliberately permissive only for the
# specific third-party origins HRFlow actually depends on (Google Identity
# Services for Sign-In, Google's own frames for the sign-in button/consent,
# Font Awesome + Google Fonts CDNs, Chart.js CDN) - not a blanket wildcard.
#
# 'unsafe-inline' is kept for script-src/style-src because the current
# frontend uses inline onclick="..." handlers throughout and an inline
# <style> block. This still blocks third-party/supply-chain script
# injection (a rogue CDN, a compromised ad script, an injected
# <script src="evil.com">), but does NOT block an attacker's inline
# <script> or onclick="..." injected via an XSS bug elsewhere in the app.
# Closing that second gap requires migrating the frontend off inline event
# handlers first - tracked as a follow-up in
# docs/analysis/architecture-review-plan.md rather than rushed here, since
# it is a real refactor (not a header change) and touches every page.
# ---------------------------------------------------------------------------
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
    """
    Adds standard defensive headers to every response. None of these
    replace proper server-side authorization checks - they reduce the
    blast radius of client-side bugs (XSS, clickjacking, MIME sniffing)
    and are cheap, standard hardening with no functional downside.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = _CSP_POLICY
    # HSTS only makes sense (and is only safe to send) once the app is
    # actually served over HTTPS in production. Sending it in local HTTP
    # dev would have no effect but is misleading; gating it on
    # Config.IS_PRODUCTION keeps the header meaningful and avoids ever
    # accidentally shipping it while still testing over plain HTTP.
    if Config.IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


def _set_session_cookie(response: Response, token: str):
    """
    Issues the session as an HttpOnly cookie so the token is never exposed
    to page JavaScript (mitigates XSS token theft) and never needs to be
    passed as a URL query parameter (mitigates token leakage via logs /
    browser history / Referer headers). See docs/analysis/
    security-analysis-plan.md, Phase 1 (SEC-01 / SEC-04).
    """
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


def _resolve_target_employee(client, current_user, employee_id, fallback_name):
    """
    Shared helper for admin-on-behalf-of-employee creation across
    requests/vacations/claims. Returns (emp_id, employee_name, submitted_by_admin).
    Non-admins may never pass employee_id; if they try, this raises 403.
    Admin-provided employee_id is resolved against the real Employees sheet
    so the employee's name is never trusted from client input.
    """
    if employee_id is not None:
        if current_user["role"] != "admin":
            logger.warning("User %s (role=%s) attempted to submit on behalf of employee_id=%s without admin rights", current_user.get("email"), current_user.get("role"), employee_id)
            raise HTTPException(status_code=403, detail="Only HR admins can submit this on behalf of another employee")
        employees = client.get_all_records("Employees")
        target = next((e for e in employees if str(e["id"]) == str(employee_id)), None)
        if not target:
            logger.warning("Admin %s tried to act on behalf of unknown employee_id=%s", current_user.get("email"), employee_id)
            raise HTTPException(status_code=404, detail="Employee not found")
        return target["id"], target["name"], True
    return current_user["employee_id"], fallback_name, False


@app.post("/api/auth/google", response_model=LoginResponse, tags=["Auth"])
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


@app.get("/api/auth/me", response_model=LoginResponse, tags=["Auth"])
def api_get_current_session(current_user: dict = Depends(get_current_user)):
    """Lets the frontend re-establish who's signed in on page load/refresh,
    without ever handling the session token itself (it lives only in the
    HttpOnly cookie, sent automatically by the browser)."""
    return LoginResponse(
        role=current_user["role"],
        employee_id=current_user.get("employee_id"),
        name=current_user.get("name"),
    )


@app.post("/api/auth/logout", tags=["Auth"])
def api_logout(response: Response):
    _clear_session_cookie(response)
    return {"message": "Signed out"}


@app.get("/api/employees", tags=["Employees"])
def get_employees(current_user: dict = Depends(get_current_user)):
    client = get_client()
    employees = client.get_all_records("Employees")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        employees = [e for e in employees if str(e["id"]) == my_id]
    return employees


@app.get("/api/employees/{emp_id}", tags=["Employees"])
def get_employee(emp_id: int, current_user: dict = Depends(get_current_user)):
    client = get_client()
    if current_user["role"] != "admin" and str(current_user["employee_id"]) != str(emp_id):
        raise HTTPException(status_code=403, detail="You can only view your own profile")
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(emp_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return emp


@app.post("/api/employees", status_code=201, tags=["Employees"])
def create_employee(payload: EmployeeCreate, current_user: dict = Depends(require_admin)):
    client = get_client()
    new_id = client.next_id("Employees")
    employee_row = {
        "id": new_id, "name": payload.name, "email": payload.email, "role": "employee",
        "dept": payload.dept, "job_role": payload.job_role, "salary": payload.salary,
        "join_date": payload.join_date, "status": payload.status, "vac_total": payload.vac_total,
        "vac_used": 0, "next_raise": payload.next_raise,
        "employment_state": payload.employment_state,
    }
    client.append_row("Employees", employee_row)
    client.append_row("Users", {"email": payload.email, "role": "employee", "employee_id": new_id})
    logger.info("Admin %s created employee id=%s (%s)", current_user.get("email"), new_id, payload.email)
    return {"message": "Employee created. They can now sign in with their Google Workspace account.", "id": new_id}


@app.put("/api/employees/{emp_id}", tags=["Employees"])
def update_employee(emp_id: int, payload: EmployeeUpdate, current_user: dict = Depends(require_admin)):
    client = get_client()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    ok = client.update_row_by_match("Employees", "id", emp_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": "Employee updated"}


@app.delete("/api/employees/{emp_id}", tags=["Employees"])
def delete_employee(emp_id: int, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.delete_row_by_match("Employees", "id", emp_id)
    client.delete_row_by_match("Users", "employee_id", emp_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": "Employee deleted"}


@app.get("/api/employees/{emp_id}/notes", tags=["Employees"])
def get_employee_notes(emp_id: int, current_user: dict = Depends(require_admin)):
    client = get_client()
    notes = client.get_all_records("EmployeeNotes")
    notes = [n for n in notes if str(n["employee_id"]) == str(emp_id)]
    notes.sort(key=lambda n: str(n.get("date", "")), reverse=True)
    return notes


@app.post("/api/employees/{emp_id}/notes", status_code=201, tags=["Employees"])
def create_employee_note(emp_id: int, payload: EmployeeNoteCreate, current_user: dict = Depends(require_admin)):
    client = get_client()
    employees = client.get_all_records("Employees")
    if not any(str(e["id"]) == str(emp_id) for e in employees):
        raise HTTPException(status_code=404, detail="Employee not found")
    note_id = client.next_id("EmployeeNotes")
    client.append_row("EmployeeNotes", {
        "id": note_id,
        "employee_id": emp_id,
        "date": payload.date or datetime.utcnow().strftime("%Y-%m-%d"),
        "category": payload.category,
        "note": payload.note,
        "created_by": current_user["email"],
    })
    return {"message": "Note added", "id": note_id}


@app.delete("/api/employees/notes/{note_id}", tags=["Employees"])
def delete_employee_note(note_id: int, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.delete_row_by_match("EmployeeNotes", "id", note_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}


def _check_document_access(current_user, emp_id):
    """Admins may access any employee's documents; employees only their own."""
    if current_user["role"] != "admin" and str(current_user["employee_id"]) != str(emp_id):
        logger.warning("User %s attempted to access documents for employee_id=%s without permission", current_user.get("email"), emp_id)
        raise HTTPException(status_code=403, detail="You can only access your own documents")


def _normalize_document_record(d: dict) -> dict:
    """
    Google Sheets (via gspread's get_all_records) auto-types cell values,
    so a document named e.g. "6" (from a file like 6.jpg) comes back as the
    Python int 6 instead of the string "6". The frontend then does
    `(d.name || '').replace(...)` on it, which throws
    "X.replace is not a function" because numbers don't have .replace().
    We normalize every document field to a plain string here so the API
    contract is stable regardless of how a cell happens to be typed.
    """
    normalized = dict(d)
    for field in ("id", "employee_id", "name", "file_type", "drive_file_id",
                  "view_url", "download_url", "uploaded_by", "uploaded_at"):
        if field in normalized and normalized[field] is not None:
            normalized[field] = str(normalized[field])
        elif field in normalized:
            normalized[field] = ""
    return normalized


@app.get("/api/employees/{emp_id}/documents", tags=["Documents"])
def get_employee_documents(emp_id: int, current_user: dict = Depends(get_current_user)):
    client = get_client()
    _check_document_access(current_user, emp_id)
    docs = client.get_all_records("EmployeeDocuments")
    docs = [d for d in docs if str(d["employee_id"]) == str(emp_id)]
    docs.sort(key=lambda d: str(d.get("uploaded_at", "")), reverse=True)
    docs = [_normalize_document_record(d) for d in docs]
    logger.debug("Listed %d documents for employee_id=%s", len(docs), emp_id)
    return docs


@app.post("/api/employees/{emp_id}/documents", status_code=201, tags=["Documents"])
def upload_employee_document(emp_id: int, payload: EmployeeDocumentCreate, current_user: dict = Depends(get_current_user)):
    client = get_client()
    _check_document_access(current_user, emp_id)
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(emp_id)), None)
    if not emp:
        logger.warning("Document upload rejected: employee_id=%s not found", emp_id)
        raise HTTPException(status_code=404, detail="Employee not found")

    logger.info("Document upload requested: employee_id=%s, name='%s', file_type=%s, by=%s",
                emp_id, payload.name, payload.file_type, current_user.get("email"))

    if payload.file_type not in ("pdf", "image"):
        logger.warning("Document upload rejected: unsupported file_type='%s' for employee_id=%s", payload.file_type, emp_id)
        raise HTTPException(status_code=400, detail="Only PDF and image files are supported")
    if not payload.data_url:
        logger.warning("Document upload rejected: empty data_url for employee_id=%s", emp_id)
        raise HTTPException(status_code=400, detail="No file content received")
    if len(payload.data_url) > 6_000_000:
        logger.warning("Document upload rejected: data_url too large (%d chars) for employee_id=%s", len(payload.data_url), emp_id)
        raise HTTPException(status_code=400, detail="File is too large (max ~4MB)")

    drive = get_drive_client()
    try:
        uploaded = drive.upload_file(emp_id, emp["name"], payload.name, payload.data_url)
    except Exception as exc:
        logger.exception("Drive upload failed for employee_id=%s, name='%s'. Returning 502 to client.", emp_id, payload.name)
        raise HTTPException(status_code=502, detail=f"Could not upload document to Google Drive: {exc}")

    doc_id = client.next_id("EmployeeDocuments")
    try:
        client.append_row("EmployeeDocuments", {
            "id": doc_id,
            "employee_id": emp_id,
            # Always store the document name as a string so Google Sheets
            # never auto-types a purely-numeric name (e.g. "6") as an int,
            # which previously broke `.replace()` calls on the frontend.
            "name": str(payload.name),
            "file_type": payload.file_type,
            "drive_file_id": uploaded["file_id"],
            "view_url": uploaded["view_url"],
            "download_url": uploaded["download_url"],
            "uploaded_by": current_user["email"],
            "uploaded_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
        })
    except Exception:
        logger.exception("Uploaded file to Drive (file_id=%s) but failed to record it in EmployeeDocuments sheet. Manual cleanup may be needed.", uploaded.get("file_id"))
        raise

    logger.info("Document upload complete: doc_id=%s, employee_id=%s, drive_file_id=%s", doc_id, emp_id, uploaded["file_id"])
    return {"message": "Document uploaded", "id": doc_id}


@app.get("/api/employees/documents/{doc_id}/stream", tags=["Documents"])
def stream_employee_document(doc_id: int, download: bool = Query(False), current_user: dict = Depends(get_current_user)):
    """
    Streams a document's bytes through the backend using the service
    account's own Drive access, so the caller never needs Drive
    permissions of their own.

    Auth is via the HttpOnly session cookie, sent automatically by the
    browser even for direct navigations (<a target="_blank">, <iframe>,
    or a download click) - so, unlike the previous implementation, no
    session token is ever placed in this URL's query string. See
    docs/analysis/security-analysis-plan.md, Phase 1 (SEC-01).

    `download=false` (default) returns Content-Disposition: inline, so
    browsers render PDFs/images directly (in-app preview via an <iframe>
    or new tab). `download=true` returns Content-Disposition: attachment,
    forcing a file download with the original file name.
    """
    client = get_client()
    docs = client.get_all_records("EmployeeDocuments")
    doc = next((d for d in docs if str(d["id"]) == str(doc_id)), None)
    if not doc:
        logger.warning("Document stream rejected: doc_id=%s not found", doc_id)
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_access(current_user, doc["employee_id"])

    drive = get_drive_client()
    try:
        raw_bytes, mime, drive_name = drive.download_file(doc.get("drive_file_id"))
    except Exception as exc:
        logger.exception("Failed to stream document doc_id=%s (drive_file_id=%s)", doc_id, doc.get("drive_file_id"))
        raise HTTPException(status_code=502, detail=f"Could not fetch document from Google Drive: {exc}")

    file_name = _safe_content_disposition_filename(str(doc.get("name") or drive_name))
    disposition = "attachment" if download else "inline"
    headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{file_name}"}
    logger.info("Streaming doc_id=%s to %s (disposition=%s, %d bytes)", doc_id, current_user.get("email"), disposition, len(raw_bytes))
    return StreamingResponse(iter([raw_bytes]), media_type=mime, headers=headers)


@app.delete("/api/employees/documents/{doc_id}", tags=["Documents"])
def delete_employee_document(doc_id: int, current_user: dict = Depends(get_current_user)):
    client = get_client()
    docs = client.get_all_records("EmployeeDocuments")
    doc = next((d for d in docs if str(d["id"]) == str(doc_id)), None)
    if not doc:
        logger.warning("Document delete rejected: doc_id=%s not found", doc_id)
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_access(current_user, doc["employee_id"])
    logger.info("Deleting document doc_id=%s (drive_file_id=%s) requested by %s", doc_id, doc.get("drive_file_id"), current_user.get("email"))
    drive = get_drive_client()
    drive_deleted = drive.delete_file(doc.get("drive_file_id"))
    if not drive_deleted:
        logger.warning("Drive file deletion returned False for drive_file_id=%s (doc_id=%s) - continuing to remove sheet row", doc.get("drive_file_id"), doc_id)
    client.delete_row_by_match("EmployeeDocuments", "id", doc_id)
    logger.info("Document delete complete: doc_id=%s", doc_id)
    return {"message": "Document deleted"}


# =========================================================
# COMPANY DOCUMENTS (Document Hub)
# General company documents/policies visible to every employee.
# Admin: add/view/delete. Employee: view/download only.
# =========================================================

def _normalize_company_document_record(d: dict) -> dict:
    """Same numeric-name safety normalization as employee documents (see
    _normalize_document_record) applied to CompanyDocuments rows."""
    normalized = dict(d)
    for field in ("id", "name", "file_type", "category", "drive_file_id",
                  "view_url", "download_url", "uploaded_by", "uploaded_at"):
        if field in normalized and normalized[field] is not None:
            normalized[field] = str(normalized[field])
        elif field in normalized:
            normalized[field] = ""
    return normalized


def _safe_content_disposition_filename(name: str) -> str:
    """
    Strips characters that could break or inject into the
    Content-Disposition header (quotes, control characters, path
    separators) and percent-encodes the remainder for the RFC 5987
    filename*=UTF-8''... form. See docs/analysis/security-analysis-plan.md,
    Phase 1 (finding #8: header injection via unsanitized filenames).
    """
    import re
    from urllib.parse import quote

    cleaned = re.sub(r'[\r\n\"\\/\x00-\x1f]', "", name).strip() or "document"
    return quote(cleaned)


@app.get("/api/company-documents", tags=["Document Hub"])
def get_company_documents(current_user: dict = Depends(get_current_user)):
    """Any signed-in user (admin or employee) can list company documents."""
    client = get_client()
    docs = client.get_all_records("CompanyDocuments")
    docs.sort(key=lambda d: str(d.get("uploaded_at", "")), reverse=True)
    docs = [_normalize_company_document_record(d) for d in docs]
    logger.debug("Listed %d company documents for %s", len(docs), current_user.get("email"))
    return docs


@app.post("/api/company-documents", status_code=201, tags=["Document Hub"])
def upload_company_document(payload: CompanyDocumentCreate, current_user: dict = Depends(require_admin)):
    """Admin-only: uploads a new company-wide document/policy."""
    logger.info("Company document upload requested: name='%s', file_type=%s, category=%s, by=%s",
                payload.name, payload.file_type, payload.category, current_user.get("email"))

    if payload.file_type not in ("pdf", "image"):
        raise HTTPException(status_code=400, detail="Only PDF and image files are supported")
    if not payload.data_url:
        raise HTTPException(status_code=400, detail="No file content received")
    if len(payload.data_url) > 6_000_000:
        raise HTTPException(status_code=400, detail="File is too large (max ~4MB)")

    drive = get_drive_client()
    try:
        uploaded = drive.upload_company_file(payload.name, payload.data_url)
    except Exception as exc:
        logger.exception("Drive upload failed for company document '%s'. Returning 502 to client.", payload.name)
        raise HTTPException(status_code=502, detail=f"Could not upload document to Google Drive: {exc}")

    client = get_client()
    doc_id = client.next_id("CompanyDocuments")
    try:
        client.append_row("CompanyDocuments", {
            "id": doc_id,
            "name": str(payload.name),
            "file_type": payload.file_type,
            "category": payload.category,
            "drive_file_id": uploaded["file_id"],
            "view_url": uploaded["view_url"],
            "download_url": uploaded["download_url"],
            "uploaded_by": current_user["email"],
            "uploaded_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
        })
    except Exception:
        logger.exception("Uploaded company document to Drive (file_id=%s) but failed to record it in CompanyDocuments sheet.", uploaded.get("file_id"))
        raise

    logger.info("Company document upload complete: doc_id=%s, drive_file_id=%s", doc_id, uploaded["file_id"])
    return {"message": "Document uploaded", "id": doc_id}


@app.get("/api/company-documents/{doc_id}/stream", tags=["Document Hub"])
def stream_company_document(doc_id: int, download: bool = Query(False), current_user: dict = Depends(get_current_user)):
    """
    Streams a company document's bytes through the backend (service
    account's Drive access). Any signed-in user (admin or employee) may
    view/download - Document Hub content is company-wide by design.

    Auth is via the HttpOnly session cookie (see stream_employee_document
    above) - no session token is placed in this URL.
    """
    client = get_client()
    docs = client.get_all_records("CompanyDocuments")
    doc = next((d for d in docs if str(d["id"]) == str(doc_id)), None)
    if not doc:
        logger.warning("Company document stream rejected: doc_id=%s not found", doc_id)
        raise HTTPException(status_code=404, detail="Document not found")

    drive = get_drive_client()
    try:
        raw_bytes, mime, drive_name = drive.download_file(doc.get("drive_file_id"))
    except Exception as exc:
        logger.exception("Failed to stream company document doc_id=%s (drive_file_id=%s)", doc_id, doc.get("drive_file_id"))
        raise HTTPException(status_code=502, detail=f"Could not fetch document from Google Drive: {exc}")

    file_name = _safe_content_disposition_filename(str(doc.get("name") or drive_name))
    disposition = "attachment" if download else "inline"
    headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{file_name}"}
    logger.info("Streaming company doc_id=%s to %s (disposition=%s, %d bytes)", doc_id, current_user.get("email"), disposition, len(raw_bytes))
    return StreamingResponse(iter([raw_bytes]), media_type=mime, headers=headers)


@app.delete("/api/company-documents/{doc_id}", tags=["Document Hub"])
def delete_company_document(doc_id: int, current_user: dict = Depends(require_admin)):
    """Admin-only: deletes a company document from Drive and the sheet."""
    client = get_client()
    docs = client.get_all_records("CompanyDocuments")
    doc = next((d for d in docs if str(d["id"]) == str(doc_id)), None)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    logger.info("Deleting company document doc_id=%s (drive_file_id=%s) requested by %s", doc_id, doc.get("drive_file_id"), current_user.get("email"))
    drive = get_drive_client()
    drive_deleted = drive.delete_file(doc.get("drive_file_id"))
    if not drive_deleted:
        logger.warning("Drive file deletion returned False for drive_file_id=%s (doc_id=%s) - continuing to remove sheet row", doc.get("drive_file_id"), doc_id)
    client.delete_row_by_match("CompanyDocuments", "id", doc_id)
    logger.info("Company document delete complete: doc_id=%s", doc_id)
    return {"message": "Document deleted"}


@app.get("/api/requests", tags=["Requests"])
def get_requests(type: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
    client = get_client()
    reqs = client.get_all_records("Requests")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        reqs = [r for r in reqs if str(r["employee_id"]) == my_id]
    if type and type != "all":
        reqs = [r for r in reqs if r["type"] == type]
    return reqs


@app.post("/api/requests", status_code=201, tags=["Requests"])
def create_request(payload: RequestCreate, current_user: dict = Depends(get_current_user)):
    """
    Submits a general request (currently used for Work From Home).
    HR Admins may submit on behalf of another employee via `employee_id`,
    optionally backdating it via `record_date` and/or directly setting
    `status` (e.g. to log an already-approved historical WFH day).
    """
    client = get_client()
    emp_id, employee_name, submitted_by_admin = _resolve_target_employee(
        client, current_user, payload.employee_id, payload.employee_name
    )

    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    new_id = client.next_id("Requests")
    row = {
        "id": new_id, "employee_id": emp_id, "employee_name": employee_name,
        "type": payload.type, "details": payload.details, "date": record_date,
        "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    }
    client.append_row("Requests", row)
    return {"message": "Request submitted", "id": new_id}


@app.post("/api/requests/{req_id}/action", tags=["Requests"])
def action_request(req_id: int, payload: RequestAction, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.update_row_by_match("Requests", "id", req_id, {
        "status": payload.status, "reviewed_by": current_user["email"],
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
    })
    if not ok:
        raise HTTPException(status_code=404, detail="Request not found")
    return {"message": f"Request {payload.status.lower()}"}


@app.get("/api/vacations/history", tags=["Vacations"])
def get_vacation_history(employee_id: Optional[int] = Query(None), current_user: dict = Depends(get_current_user)):
    client = get_client()
    history = client.get_all_records("VacationHistory")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        history = [h for h in history if str(h["employee_id"]) == my_id]
    elif employee_id is not None:
        history = [h for h in history if str(h["employee_id"]) == str(employee_id)]
    return history


@app.post("/api/vacations/request", status_code=201, tags=["Vacations"])
def request_vacation(payload: VacationRequestCreate, current_user: dict = Depends(get_current_user)):
    """
    Submits a Vacation/leave request. HR Admins may submit on behalf of
    another employee via `employee_id`, optionally backdating the
    submission record via `record_date` and/or directly setting `status`
    (e.g. to log a historical approved leave from a previous year).
    """
    client = get_client()
    emp_id, employee_name, submitted_by_admin = _resolve_target_employee(
        client, current_user, payload.employee_id, payload.employee_name
    )

    end_date = payload.end_date or payload.start_date
    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    vac_id = client.next_id("VacationHistory")
    client.append_row("VacationHistory", {
        "id": vac_id, "employee_id": emp_id, "type": payload.leave_type,
        "start_date": payload.start_date, "end_date": end_date, "days": payload.days, "status": status,
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })

    req_id = client.next_id("Requests")
    client.append_row("Requests", {
        "id": req_id, "employee_id": emp_id, "employee_name": employee_name, "type": "Vacation",
        "details": f"{payload.leave_type}: {payload.start_date} to {end_date}",
        "date": record_date, "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })
    return {"message": "Vacation request submitted", "id": vac_id}


APPROACHING_THRESHOLD_PCT = 80


def _compute_consumption(employees, categories, claims):
    approved_claims = [c for c in claims if c.get("status") == "Approved"]
    results = []
    for emp in employees:
        emp_id = emp["id"]
        emp_claims = [c for c in approved_claims if str(c.get("employee_id")) == str(emp_id)]
        cat_results = []
        total_limit = 0.0
        total_consumed = 0.0
        for cat in categories:
            limit = float(cat.get("annual_limit") or 0)
            consumed = sum(float(c.get("amount") or 0) for c in emp_claims if c.get("category") == cat["name"])
            remaining = max(limit - consumed, 0)
            pct_used = round((consumed / limit) * 100, 1) if limit > 0 else 0
            if limit > 0 and consumed >= limit:
                status = "limit_reached"
            elif limit > 0 and pct_used >= APPROACHING_THRESHOLD_PCT:
                status = "approaching"
            else:
                status = "ok"
            cat_results.append({
                "category_id": cat["id"], "category": cat["name"], "limit": limit, "consumed": consumed,
                "remaining": remaining, "pct_used": pct_used, "status": status,
            })
            total_limit += limit
            total_consumed += consumed
        total_pct = round((total_consumed / total_limit) * 100, 1) if total_limit > 0 else 0
        if total_limit > 0 and total_consumed >= total_limit:
            total_status = "limit_reached"
        elif total_limit > 0 and total_pct >= APPROACHING_THRESHOLD_PCT:
            total_status = "approaching"
        else:
            total_status = "ok"
        results.append({
            "employee_id": emp_id, "employee_name": emp["name"], "categories": cat_results,
            "total_limit": total_limit, "total_consumed": total_consumed,
            "total_remaining": max(total_limit - total_consumed, 0),
            "total_pct_used": total_pct, "total_status": total_status,
        })
    return results


@app.get("/api/insurance/categories", tags=["Insurance"])
def get_insurance_categories(current_user: dict = Depends(get_current_user)):
    client = get_client()
    return client.get_all_records("InsuranceCategories")


@app.post("/api/insurance/categories", status_code=201, tags=["Insurance"])
def create_insurance_category(payload: InsuranceCategoryCreate, current_user: dict = Depends(require_admin)):
    client = get_client()
    categories = client.get_all_records("InsuranceCategories")
    if any(c["name"].strip().lower() == payload.name.strip().lower() for c in categories):
        raise HTTPException(status_code=400, detail="A category with this name already exists")
    new_id = client.next_id("InsuranceCategories")
    client.append_row("InsuranceCategories", {"id": new_id, "name": payload.name, "annual_limit": payload.annual_limit})
    return {"message": "Category created", "id": new_id}


@app.put("/api/insurance/categories/{cat_id}", tags=["Insurance"])
def update_insurance_category(cat_id: int, payload: InsuranceCategoryUpdate, current_user: dict = Depends(require_admin)):
    client = get_client()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    ok = client.update_row_by_match("InsuranceCategories", "id", cat_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category updated"}


@app.delete("/api/insurance/categories/{cat_id}", tags=["Insurance"])
def delete_insurance_category(cat_id: int, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.delete_row_by_match("InsuranceCategories", "id", cat_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category deleted"}


@app.get("/api/insurance/consumption", tags=["Insurance"])
def get_insurance_consumption(employee_id: Optional[int] = Query(None), current_user: dict = Depends(get_current_user)):
    client = get_client()
    employees = client.get_all_records("Employees")
    categories = client.get_all_records("InsuranceCategories")
    claims = client.get_all_records("InsuranceClaims")

    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        employees = [e for e in employees if str(e["id"]) == my_id]
    elif employee_id is not None:
        employees = [e for e in employees if str(e["id"]) == str(employee_id)]

    return _compute_consumption(employees, categories, claims)


@app.get("/api/insurance/claims", tags=["Insurance"])
def get_insurance_claims(current_user: dict = Depends(get_current_user)):
    client = get_client()
    claims = client.get_all_records("InsuranceClaims")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        claims = [c for c in claims if str(c["employee_id"]) == my_id]
    return claims


@app.post("/api/insurance/claims", status_code=201, tags=["Insurance"])
def submit_insurance_claim(payload: InsuranceClaimCreate, current_user: dict = Depends(get_current_user)):
    """
    Submits a medical insurance claim. HR Admins may submit on behalf of
    another employee via `employee_id` (resolved server-side), optionally
    backdating the claim via `record_date` and/or directly setting
    `status` for historical record-keeping.
    """
    client = get_client()
    categories = client.get_all_records("InsuranceCategories")
    if not any(c["name"] == payload.category for c in categories):
        raise HTTPException(status_code=400, detail="Unknown insurance category")

    if payload.document_url and len(payload.document_url) > 3_000_000:
        raise HTTPException(status_code=400, detail="Supporting document is too large")

    emp_id, employee_name, submitted_by_admin = _resolve_target_employee(
        client, current_user, payload.employee_id, payload.employee_name
    )

    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    claim_id = client.next_id("InsuranceClaims")
    client.append_row("InsuranceClaims", {
        "id": claim_id, "employee_id": emp_id, "employee_name": employee_name,
        "category": payload.category, "provider": payload.provider, "amount": payload.amount,
        "date": record_date, "status": status,
        "document_url": payload.document_url or "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })

    detail_suffix = " (submitted by HR admin)" if submitted_by_admin else ""
    req_id = client.next_id("Requests")
    client.append_row("Requests", {
        "id": req_id, "employee_id": emp_id, "employee_name": employee_name, "type": "Medical Insurance",
        "details": f"{payload.category} claim - EGP {payload.amount}{detail_suffix}",
        "date": record_date, "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })
    return {"message": "Claim submitted", "id": claim_id}


@app.post("/api/insurance/claims/{claim_id}/action", tags=["Insurance"])
def action_insurance_claim(claim_id: int, payload: InsuranceClaimAction, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.update_row_by_match("InsuranceClaims", "id", claim_id, {"status": payload.status})
    if not ok:
        raise HTTPException(status_code=404, detail="Claim not found")
    return {"message": f"Claim {payload.status.lower()}"}


@app.get("/api/salary/history", tags=["Salary"])
def get_salary_history(employee_id: Optional[int] = Query(None), current_user: dict = Depends(get_current_user)):
    """
    Non-admins are always restricted to their own salary history: their
    own employee_id fully overrides (and ignores) any employee_id query
    param they might pass. This is deliberately expressed as a single
    if/else - not as two separate conditions that both mutate `history` -
    so the access rule cannot be silently bypassed by future edits that
    reorder the filtering logic. See docs/analysis/security-analysis-plan.md,
    Phase 1 (finding #9).
    """
    client = get_client()
    history = client.get_all_records("SalaryHistory")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        history = [h for h in history if str(h["employee_id"]) == my_id]
    elif employee_id is not None:
        history = [h for h in history if str(h["employee_id"]) == str(employee_id)]
    return history


@app.post("/api/salary/raise", status_code=201, tags=["Salary"])
def apply_raise(payload: RaiseApply, current_user: dict = Depends(require_admin)):
    """
    Admin applies a raise to one employee: percentage, flat amount, or a
    direct new salary. `effective_date` may be backdated to create a
    historical salary record for a previous year; in that case the
    employee's current salary/next_raise on the Employees sheet are left
    untouched (only a SalaryHistory row is added), so a backdated entry
    never clobbers a more recent real salary.
    """
    client = get_client()
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(payload.employee_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    current_salary = float(emp["salary"])
    if payload.mode == "pct":
        new_salary = round(current_salary * (1 + payload.value / 100), 2)
    elif payload.mode == "amount":
        new_salary = round(current_salary + payload.value, 2)
    else:
        new_salary = round(payload.value, 2)

    if new_salary <= 0:
        raise HTTPException(status_code=400, detail="Resulting salary must be positive")

    pct_change = round((new_salary - current_salary) / current_salary * 100, 2)
    effective_date = payload.effective_date or datetime.utcnow().strftime("%Y-%m-%d")

    history_id = client.next_id("SalaryHistory")
    client.append_row("SalaryHistory", {
        "id": history_id, "employee_id": emp["id"], "date": effective_date,
        "previous_salary": current_salary, "new_salary": new_salary,
        "pct_change": f"{'+' if pct_change >= 0 else ''}{pct_change}%",
        "reason": payload.reason, "applied_by": current_user["email"],
    })

    is_backdated = False
    try:
        is_backdated = datetime.strptime(effective_date, "%Y-%m-%d") < (datetime.utcnow() - timedelta(days=1))
    except ValueError:
        pass

    if not is_backdated:
        next_raise_date = (datetime.strptime(effective_date, "%Y-%m-%d") + timedelta(days=365)).strftime("%Y-%m-%d")
        client.update_row_by_match("Employees", "id", emp["id"], {
            "salary": new_salary,
            "next_raise": next_raise_date,
        })

    return {"message": "Raise applied", "previous_salary": current_salary, "new_salary": new_salary, "pct_change": pct_change}


@app.get("/api/health", tags=["System"])
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}
