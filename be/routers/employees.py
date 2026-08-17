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

import sheets_client
import drive_client
from logging_config import get_logger
from auth import get_current_user, require_admin
from deps import audit_log, current_user_employee_scope
from services.uploads import validate_upload_content, safe_content_disposition_filename
from models import EmployeeCreate, EmployeeUpdate, EmployeeNoteCreate, EmployeeDocumentCreate

logger = get_logger("main")
router = APIRouter(prefix="/api/employees", tags=["Employees"])

@router.get("")
def get_employees(scoped_employee_id: Optional[int] = Depends(current_user_employee_scope)):
    """Employee ownership is resolved by current_user_employee_scope
    before this route executes."""
    client = sheets_client.get_client()
    employees = client.get_all_records("Employees")
    if scoped_employee_id is not None:
        employees = [e for e in employees if str(e["id"]) == str(scoped_employee_id)]
    return employees

@router.get("/{emp_id}")
def get_employee(emp_id: int, current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    if current_user["role"] != "admin" and str(current_user["employee_id"]) != str(emp_id):
        raise HTTPException(status_code=403, detail="You can only view your own profile")
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(emp_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return emp

@router.post("", status_code=201)
def create_employee(payload: EmployeeCreate, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
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
    audit_log(client, "employee.create", current_user.get("email"), "employee", new_id, f"name={payload.name}, email={payload.email}")
    return {"message": "Employee created. They can now sign in with their Google Workspace account.", "id": new_id}

@router.put("/{emp_id}")
def update_employee(emp_id: int, payload: EmployeeUpdate, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    ok = client.update_row_by_match("Employees", "id", emp_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    audit_log(client, "employee.update", current_user.get("email"), "employee", emp_id, f"fields={list(updates.keys())}")
    return {"message": "Employee updated"}

@router.delete("/{emp_id}")
def delete_employee(emp_id: int, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    ok = client.delete_row_by_match("Employees", "id", emp_id)
    client.delete_row_by_match("Users", "employee_id", emp_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    audit_log(client, "employee.delete", current_user.get("email"), "employee", emp_id)
    return {"message": "Employee deleted"}

@router.get("/{emp_id}/notes")
def get_employee_notes(emp_id: int, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    notes = client.get_all_records("EmployeeNotes")
    notes = [n for n in notes if str(n["employee_id"]) == str(emp_id)]
    notes.sort(key=lambda n: str(n.get("date", "")), reverse=True)
    return notes

@router.post("/{emp_id}/notes", status_code=201)
def create_employee_note(emp_id: int, payload: EmployeeNoteCreate, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
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

@router.delete("/notes/{note_id}")
def delete_employee_note(note_id: int, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    ok = client.delete_row_by_match("EmployeeNotes", "id", note_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}

def _check_document_access(current_user, emp_id):
    if current_user["role"] != "admin" and str(current_user["employee_id"]) != str(emp_id):
        logger.warning("User %s attempted to access documents for employee_id=%s without permission", current_user.get("email"), emp_id)
        raise HTTPException(status_code=403, detail="You can only access your own documents")

def _normalize_document_record(d: dict) -> dict:
    normalized = dict(d)
    for field in ("id", "employee_id", "name", "file_type", "drive_file_id",
                  "view_url", "download_url", "uploaded_by", "uploaded_at"):
        if field in normalized and normalized[field] is not None:
            normalized[field] = str(normalized[field])
        elif field in normalized:
            normalized[field] = ""
    return normalized

@router.get("/{emp_id}/documents", tags=["Documents"])
def get_employee_documents(emp_id: int, current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    _check_document_access(current_user, emp_id)
    docs = client.get_all_records("EmployeeDocuments")
    docs = [d for d in docs if str(d["employee_id"]) == str(emp_id)]
    docs.sort(key=lambda d: str(d.get("uploaded_at", "")), reverse=True)
    docs = [_normalize_document_record(d) for d in docs]
    logger.debug("Listed %d documents for employee_id=%s", len(docs), emp_id)
    return docs

@router.post("/{emp_id}/documents", status_code=201, tags=["Documents"])
def upload_employee_document(emp_id: int, payload: EmployeeDocumentCreate, current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
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

    validate_upload_content(payload.file_type, payload.data_url)

    drive = drive_client.get_drive_client()
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

@router.get("/documents/{doc_id}/stream", tags=["Documents"])
def stream_employee_document(doc_id: int, download: bool = Query(False), current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    docs = client.get_all_records("EmployeeDocuments")
    doc = next((d for d in docs if str(d["id"]) == str(doc_id)), None)
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
def delete_employee_document(doc_id: int, current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    docs = client.get_all_records("EmployeeDocuments")
    doc = next((d for d in docs if str(d["id"]) == str(doc_id)), None)
    if not doc:
        logger.warning("Document delete rejected: doc_id=%s not found", doc_id)
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_access(current_user, doc["employee_id"])
    logger.info("Deleting document doc_id=%s (drive_file_id=%s) requested by %s", doc_id, doc.get("drive_file_id"), current_user.get("email"))
    drive = drive_client.get_drive_client()
    drive_deleted = drive.delete_file(doc.get("drive_file_id"))
    if not drive_deleted:
        logger.warning("Drive file deletion returned False for drive_file_id=%s (doc_id=%s) - continuing to remove sheet row", doc.get("drive_file_id"), doc_id)
    client.delete_row_by_match("EmployeeDocuments", "id", doc_id)
    logger.info("Document delete complete: doc_id=%s", doc_id)
    audit_log(client, "document.delete", current_user.get("email"), "employee_document", doc_id, f"employee_id={doc['employee_id']}")
    return {"message": "Document deleted"}
