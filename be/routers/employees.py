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
from auth import get_current_user
from deps import audit_log, permission_scope, Scope
from services.uploads import validate_upload_content, safe_content_disposition_filename
from models import EmployeeCreate, EmployeeUpdate, EmployeePersonalUpdate, EmployeeNoteCreate, EmployeeDocumentCreate
from services.employee_personal import mask_id
from services.employee_delete_guard import pay_history_counts, delete_blocked_message
from services.employee_archive import archive_employee, unarchive_employee
from repositories.interfaces import EmployeeRepository, AuditRepository
from repositories.deps import get_employee_repo, get_audit_repo
from core.permissions import require_permission
from db import get_db
from sqlalchemy.orm import Session
from core.access_service import AccessService

logger = get_logger("main")
router = APIRouter(prefix="/api/employees", tags=["Employees"])


@router.get("")
def get_employees(
    scope: Scope = Depends(permission_scope("hr.employee.read", "self.profile.read")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    """Employee ownership is resolved by permission_scope before this route executes."""
    scoped_employee_id = None if scope.is_all else scope.employee_id
    return employee_repo.list_all(scoped_employee_id=scoped_employee_id)


@router.get("/{emp_id}")
def get_employee(
    emp_id: int,
    scope: Scope = Depends(permission_scope("hr.employee.read", "self.profile.read")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    if not scope.is_all and str(scope.employee_id) != str(emp_id):
        raise HTTPException(status_code=403, detail="You can only view your own profile")
    emp = employee_repo.get_by_id(emp_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return emp


@router.post("", status_code=201)
def create_employee(
    payload: EmployeeCreate,
    current_user: dict = Depends(require_permission("hr.employee.write")),
    _personal_writer: dict = Depends(require_permission("hr.employee_personal.write")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
    db: Session = Depends(get_db),
):
    # Enforce R12 validation before creating
    access_service = AccessService(db, audit_repo)
    access_service.validate_employee_provisioning(payload.email)

    new_id = employee_repo.create({
        "name": payload.name,
        "email": payload.email,
        "dept": payload.dept,
        "job_role": payload.job_role,
        "join_date": payload.join_date,
        "status": payload.status,
        "vac_total": payload.vac_total,
        "employment_state": payload.employment_state,
        "invoice_id": payload.invoice_id or "",
        "address_line_1": payload.address_line_1,
        "address_line_2": payload.address_line_2 or "",
        "legal_name": payload.legal_name,
        "phone": payload.phone,
        "id_type": payload.id_type,
        "id_number": payload.id_number,
    })
    logger.info("Admin %s created employee id=%s (%s)", current_user.get("email"), new_id, payload.email)
    audit_log(audit_repo, "employee.create", current_user.get("email"), "employee", new_id, f"name={payload.name}, email={payload.email}")
    return {"message": "Employee created. They can now sign in with their Google account.", "id": new_id}


@router.put("/{emp_id}")
def update_employee(
    emp_id: int,
    payload: EmployeeUpdate,
    current_user: dict = Depends(require_permission("hr.employee.write")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
    db: Session = Depends(get_db),
):
    if not employee_repo.get_by_id(emp_id):
        raise HTTPException(status_code=404, detail="Employee not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "email" in updates:
        access_service = AccessService(db, audit_repo)
        access_service.validate_employee_email_change(emp_id, updates["email"])
    ok = employee_repo.update(emp_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    audit_log(audit_repo, "employee.update", current_user.get("email"), "employee", emp_id, f"fields={list(updates.keys())}")
    return {"message": "Employee updated"}


def _personal_view(emp_id: int, details: dict, reveal: bool) -> dict:
    view = {
        "employee_id": emp_id,
        "legal_name": details["legal_name"],
        "phone": details["phone"],
        "address_line_1": details["address_line_1"],
        "address_line_2": details["address_line_2"],
        "id_type": details["id_type"],
        "has_id": bool(details["id_number"]),
        "id_number_masked": mask_id(details["id_number"]),
    }
    if reveal:
        view["id_number"] = details["id_number"]
    return view


@router.get("/{emp_id}/personal")
def get_employee_personal(
    emp_id: int,
    reveal_id: bool = Query(False),
    current_user: dict = Depends(require_permission("hr.employee_personal.read")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    """Personal details (HR-admin only). The ID number is masked unless reveal_id=true and the caller may reveal."""
    if reveal_id and "hr.employee_personal.reveal" not in set(current_user.get("permissions", [])):
        raise HTTPException(
            status_code=403,
            detail="Permission denied: 'hr.employee_personal.reveal' required to reveal the ID number",
        )
    details = employee_repo.get_personal(emp_id)
    if details is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if reveal_id and details["id_number"]:
        audit_log(audit_repo, "employee.personal.reveal_id", current_user.get("email"), "employee", emp_id)
    return _personal_view(emp_id, details, reveal_id)


@router.put("/{emp_id}/personal")
def update_employee_personal(
    emp_id: int,
    payload: EmployeePersonalUpdate,
    current_user: dict = Depends(require_permission("hr.employee_personal.write")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    if employee_repo.get_personal(emp_id) is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    sent = payload.model_fields_set
    updates = {k: getattr(payload, k) for k in sent}
    # Clearing the ID stores nothing (not empty strings); blank optional text is stored as empty.
    if "address_line_2" in updates and updates["address_line_2"] is None:
        updates["address_line_2"] = ""
    employee_repo.update_personal(emp_id, updates)
    # Field names only: personal values never go to the audit log.
    audit_log(audit_repo, "employee.personal.update", current_user.get("email"), "employee", emp_id, f"fields={sorted(updates.keys())}")
    return _personal_view(emp_id, employee_repo.get_personal(emp_id), False)


@router.delete("/{emp_id}")
def delete_employee(
    emp_id: int,
    current_user: dict = Depends(require_permission("hr.employee.write")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
    db: Session = Depends(get_db),
):
    emp = employee_repo.get_by_id(emp_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    # Enforce R1, R2, R4 before deleting; the repository removes the baseline-only user (R5) in the same transaction
    access_service = AccessService(db, audit_repo)
    access_service.validate_employee_delete(emp_id, current_user)
    # Pay and payroll history is finance data: it blocks the delete (database RESTRICT is the backstop)
    history = pay_history_counts(db, emp_id)
    if history:
        raise HTTPException(status_code=409, detail=delete_blocked_message(history))
    ok = employee_repo.delete(emp_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    audit_log(audit_repo, "employee.delete", current_user.get("email"), "employee", emp_id)
    return {"message": "Employee deleted"}


@router.post("/{emp_id}/archive")
def archive_employee_route(
    emp_id: int,
    current_user: dict = Depends(require_permission("hr.employee.write")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
    db: Session = Depends(get_db),
):
    """Archive an employee: they and their login are set aside, every record stays. Reversible with /unarchive."""
    archive_employee(db, emp_id, current_user, audit_repo)
    return employee_repo.get_by_id(emp_id)


@router.post("/{emp_id}/unarchive")
def unarchive_employee_route(
    emp_id: int,
    current_user: dict = Depends(require_permission("hr.employee.write")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
    db: Session = Depends(get_db),
):
    """Bring an archived employee back with the status they had. Their login stays archived (archived users are never
    restored); `login_archived` says whether there is one."""
    login_archived = unarchive_employee(db, emp_id, current_user, audit_repo)
    return {**employee_repo.get_by_id(emp_id), "login_archived": login_archived}


@router.get("/{emp_id}/notes")
def get_employee_notes(
    emp_id: int,
    current_user: dict = Depends(require_permission("hr.employee.read")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    return employee_repo.get_notes(emp_id)


@router.post("/{emp_id}/notes", status_code=201)
def create_employee_note(
    emp_id: int,
    payload: EmployeeNoteCreate,
    current_user: dict = Depends(require_permission("hr.employee.write")),
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
    current_user: dict = Depends(require_permission("hr.employee.write")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    ok = employee_repo.delete_note(note_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}


def _check_document_access(scope: Scope, emp_id: int):
    if not scope.is_all and str(scope.employee_id) != str(emp_id):
        logger.warning("Attempted to access documents for employee_id=%s without permission", emp_id)
        raise HTTPException(status_code=403, detail="You can only access your own documents")


@router.get("/{emp_id}/documents", tags=["Documents"])
def get_employee_documents(
    emp_id: int,
    scope: Scope = Depends(permission_scope("hr.employee_document.read", "self.document.read")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
):
    _check_document_access(scope, emp_id)
    docs = employee_repo.get_documents(emp_id)
    logger.debug("Listed %d documents for employee_id=%s", len(docs), emp_id)
    return docs


@router.post("/{emp_id}/documents", status_code=201, tags=["Documents"])
def upload_employee_document(
    emp_id: int,
    payload: EmployeeDocumentCreate,
    scope: Scope = Depends(permission_scope("hr.employee_document.write", "self.document.write")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    current_user: dict = Depends(get_current_user),
):
    _check_document_access(scope, emp_id)
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
    scope: Scope = Depends(permission_scope("hr.employee_document.read", "self.document.read")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    current_user: dict = Depends(get_current_user),
):
    doc = employee_repo.get_document_by_id(doc_id)
    if not doc:
        logger.warning("Document stream rejected: doc_id=%s not found", doc_id)
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_access(scope, doc["employee_id"])

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
    scope: Scope = Depends(permission_scope("hr.employee_document.write", "self.document.write")),
    employee_repo: EmployeeRepository = Depends(get_employee_repo),
    audit_repo: AuditRepository = Depends(get_audit_repo),
    current_user: dict = Depends(get_current_user),
):
    doc = employee_repo.get_document_by_id(doc_id)
    if not doc:
        logger.warning("Document delete rejected: doc_id=%s not found", doc_id)
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_access(scope, doc["employee_id"])
    logger.info("Deleting document doc_id=%s (drive_file_id=%s) requested by %s", doc_id, doc.get("drive_file_id"), current_user.get("email"))
    drive = drive_client.get_drive_client()
    drive_deleted = drive.delete_file(doc.get("drive_file_id"))
    if not drive_deleted:
        logger.warning("Drive file deletion returned False for drive_file_id=%s (doc_id=%s) - continuing to remove repository record", doc.get("drive_file_id"), doc_id)
    employee_repo.delete_document(doc_id)
    logger.info("Document delete complete: doc_id=%s", doc_id)
    audit_log(audit_repo, "document.delete", current_user.get("email"), "employee_document", doc_id, f"employee_id={doc['employee_id']}")
    return {"message": "Document deleted"}

