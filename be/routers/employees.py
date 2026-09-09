"""
routers/employees.py
Employee CRUD, notes, and employee-document endpoints. Moved from
main.py during the router-decomposition refactor - pure structural move,
no behavior change.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

import drive_client
from logging_config import get_logger
from auth import get_current_user, require_admin
from deps import audit_log, current_user_employee_scope
from services.uploads import validate_upload_content, safe_content_disposition_filename
from models import EmployeeCreate, EmployeeUpdate, EmployeeNoteCreate, EmployeeDocumentCreate
from repositories.interfaces import EmployeeRepository, AuditRepository
from repositories.deps import get_employee_repo, get_audit_repo
from core.permissions import require_permission

logger = get_logger("main")
router = APIRouter(prefix="/api/employees", tags=["Employees"])


@router.get("")
def get_employees(
    scoped_employee_id: Optional[int] = Depends(current_user_employee_scope),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    """Employee ownership is resolved by current_user_employee_scope
    before this route executes."""
    return employee_repo.list_all(scoped_employee_id=scoped_employee_id)


@router.get("/{emp_id}")
def get_employee(
    emp_id: int,
    current_user: dict = Depends(get_current_user),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    if current_user["role"] != "admin" and str(current_user["employee_id"]) != str(emp_id):
        raise HTTPException(status_code=403, detail="You can only view your own profile")
    emp = employee_repo.get_by_id(emp_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return emp


@router.post("", status_code=201)
def create_employee(
    payload: EmployeeCreate,
    current_user: dict = Depends(require_permission("hr.employee.write")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    # `salary` (legacy, total) is derived inside employee_repo.create()
    new_id = employee_repo.create({
        "name": payload.name,
        "email": payload.email,
        "dept": payload.dept,
        "job_role": payload.job_role,
        "join_date": payload.join_date,
        "status": payload.status,
        "vac_total": payload.vac_total,
        "next_raise": payload.next_raise,
        "employment_state": payload.employment_state,
        "internal_salary_usd": payload.internal_salary_usd,
        "external_salary_usd": payload.external_salary_usd,
        "invoice_id": payload.invoice_id or "",
        "address_line_1": payload.address_line_1 or "",
        "address_line_2": payload.address_line_2 or "",
    })
    logger.info("Admin %s created employee id=%s (%s)", current_user.get("email"), new_id, payload.email)
    audit_log(audit_repo, "employee.create", current_user.get("email"), "employee", new_id, f"name={payload.name}, email={payload.email}")
    return {"message": "Employee created. They can now sign in with their Google Workspace account.", "id": new_id}


@router.put("/{emp_id}")
def update_employee(
    emp_id: int,
    payload: EmployeeUpdate,
    current_user: dict = Depends(require_admin),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    ok = employee_repo.update(emp_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    audit_log(audit_repo, "employee.update", current_user.get("email"), "employee", emp_id, f"fields={list(updates.keys())}")
    return {"message": "Employee updated"}


@router.delete("/{emp_id}")
def delete_employee(
    emp_id: int,
    current_user: dict = Depends(require_admin),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    ok = employee_repo.delete(emp_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    audit_log(audit_repo, "employee.delete", current_user.get("email"), "employee", emp_id)
    return {"message": "Employee deleted"}


@router.get("/{emp_id}/notes")
def get_employee_notes(
    emp_id: int,
    current_user: dict = Depends(require_admin),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    return employee_repo.get_notes(emp_id)


@router.post("/{emp_id}/notes", status_code=201)
def create_employee_note(
    emp_id: int,
    payload: EmployeeNoteCreate,
    current_user: dict = Depends(require_admin),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    if not employee_repo.get_by_id(emp_id):
        raise HTTPException(status_code=404, detail="Employee not found")
    note_id = employee_repo.create_note(emp_id, {
        "date": payload.date or datetime.utcnow().strftime("%Y-%m-%d"),
        "category": payload.category,
        "note": payload.note,
        "created_by": current_user["email"],
    })
    return {"message": "Note added", "id": note_id}


@router.delete("/notes/{note_id}")
def delete_employee_note(
    note_id: int,
    current_user: dict = Depends(require_admin),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    ok = employee_repo.delete_note(note_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}


def _check_document_access(current_user, emp_id):
    if current_user["role"] != "admin" and str(current_user["employee_id"]) != str(emp_id):
        logger.warning("User %s attempted to access documents for employee_id=%s without permission", current_user.get("email"), emp_id)
        raise HTTPException(status_code=403, detail="You can only access your own documents")


@router.get("/{emp_id}/documents", tags=["Documents"])
def get_employee_documents(
    emp_id: int,
    current_user: dict = Depends(get_current_user),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    _check_document_access(current_user, emp_id)
    docs = employee_repo.get_documents(emp_id)
    logger.debug("Listed %d documents for employee_id=%s", len(docs), emp_id)
    return docs


@router.post("/{emp_id}/documents", status_code=201, tags=["Documents"])
def upload_employee_document(
    emp_id: int,
    payload: EmployeeDocumentCreate,
    current_user: dict = Depends(get_current_user),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    _check_document_access(current_user, emp_id)
    emp = employee_repo.get_by_id(emp_id)
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

    validate_upload_content(payload.file_type, payload.data_url)

    drive = drive_client.get_drive_client()
    try:
        uploaded = drive.upload_file(emp_id, emp["name"], payload.name, payload.data_url)
    except Exception as exc:
        logger.exception("Drive upload failed for employee_id=%s, name='%s'. Returning 502 to client.", emp_id, payload.name)
        raise HTTPException(status_code=502, detail=f"Could not upload document to Google Drive: {exc}")

    try:
        doc_id = employee_repo.create_document(emp_id, {
            "name": str(payload.name),
            "file_type": payload.file_type,
            "drive_file_id": uploaded["file_id"],
            "view_url": uploaded["view_url"],
            "download_url": uploaded["download_url"],
            "uploaded_by": current_user["email"],
            "uploaded_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
        })
    except Exception:
        logger.exception("Uploaded file to Drive (file_id=%s) but failed to record it in repository. Manual cleanup may be needed.", uploaded.get("file_id"))
        raise

    logger.info("Document upload complete: doc_id=%s, employee_id=%s, drive_file_id=%s", doc_id, emp_id, uploaded["file_id"])
    return {"message": "Document uploaded", "id": doc_id}


@router.get("/documents/{doc_id}/stream", tags=["Documents"])
def stream_employee_document(
    doc_id: int,
    download: bool = Query(False),
    current_user: dict = Depends(get_current_user),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    doc = employee_repo.get_document_by_id(doc_id)
    if not doc:
        logger.warning("Document stream rejected: doc_id=%s not found", doc_id)
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_access(current_user, doc["employee_id"])

    drive = drive_client.get_drive_client()
    try:
        raw_bytes, mime, drive_name = drive.download_file(doc.get("drive_file_id"))
    except Exception as exc:
        logger.exception("Failed to stream document doc_id=%s (drive_file_id=%s)", doc_id, doc.get("drive_file_id"))
        raise HTTPException(status_code=502, detail=f"Could not fetch document from Google Drive: {exc}")

    file_name = safe_content_disposition_filename(str(doc.get("name") or drive_name))
    disposition = "attachment" if download else "inline"
    headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{file_name}"}
    logger.info("Streaming doc_id=%s to %s (disposition=%s, %d bytes)", doc_id, current_user.get("email"), disposition, len(raw_bytes))
    return StreamingResponse(iter([raw_bytes]), media_type=mime, headers=headers)


@router.delete("/documents/{doc_id}", tags=["Documents"])
def delete_employee_document(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    doc = employee_repo.get_document_by_id(doc_id)
    if not doc:
        logger.warning("Document delete rejected: doc_id=%s not found", doc_id)
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_access(current_user, doc["employee_id"])
    logger.info("Deleting document doc_id=%s (drive_file_id=%s) requested by %s", doc_id, doc.get("drive_file_id"), current_user.get("email"))
    drive = drive_client.get_drive_client()
    drive_deleted = drive.delete_file(doc.get("drive_file_id"))
    if not drive_deleted:
        logger.warning("Drive file deletion returned False for drive_file_id=%s (doc_id=%s) - continuing to remove repository record", doc.get("drive_file_id"), doc_id)
    employee_repo.delete_document(doc_id)
    logger.info("Document delete complete: doc_id=%s", doc_id)
    audit_log(audit_repo, "document.delete", current_user.get("email"), "employee_document", doc_id, f"employee_id={doc['employee_id']}")
    return {"message": "Document deleted"}
