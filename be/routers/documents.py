"""
routers/documents.py
Company-wide documents (Document Hub) endpoints. Moved from main.py
during the router-decomposition refactor - pure structural move, no
behavior change.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

import sheets_client
import drive_client
from logging_config import get_logger
from auth import get_current_user, require_admin
from deps import audit_log
from services.uploads import validate_upload_content, safe_content_disposition_filename
from models import CompanyDocumentCreate

logger = get_logger("main")
router = APIRouter(prefix="/api/company-documents", tags=["Document Hub"])


def _normalize_company_document_record(d: dict) -> dict:
    normalized = dict(d)
    for field in ("id", "name", "file_type", "category", "drive_file_id",
                  "view_url", "download_url", "uploaded_by", "uploaded_at"):
        if field in normalized and normalized[field] is not None:
            normalized[field] = str(normalized[field])
        elif field in normalized:
            normalized[field] = ""
    return normalized


@router.get("")
def get_company_documents(current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    docs = client.get_all_records("CompanyDocuments")
    docs.sort(key=lambda d: str(d.get("uploaded_at", "")), reverse=True)
    docs = [_normalize_company_document_record(d) for d in docs]
    logger.debug("Listed %d company documents for %s", len(docs), current_user.get("email"))
    return docs


@router.post("", status_code=201)
def upload_company_document(payload: CompanyDocumentCreate, current_user: dict = Depends(require_admin)):
    logger.info("Company document upload requested: name='%s', file_type=%s, category=%s, by=%s",
                payload.name, payload.file_type, payload.category, current_user.get("email"))

    if payload.file_type not in ("pdf", "image"):
        raise HTTPException(status_code=400, detail="Only PDF and image files are supported")
    if not payload.data_url:
        raise HTTPException(status_code=400, detail="No file content received")
    if len(payload.data_url) > 6_000_000:
        raise HTTPException(status_code=400, detail="File is too large (max ~4MB)")

    validate_upload_content(payload.file_type, payload.data_url)

    drive = drive_client.get_drive_client()
    try:
        uploaded = drive.upload_company_file(payload.name, payload.data_url)
    except Exception as exc:
        logger.exception("Drive upload failed for company document '%s'. Returning 502 to client.", payload.name)
        raise HTTPException(status_code=502, detail=f"Could not upload document to Google Drive: {exc}")

    client = sheets_client.get_client()
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


@router.get("/{doc_id}/stream")
def stream_company_document(doc_id: int, download: bool = Query(False), current_user: dict = Depends(get_current_user)):
    client = sheets_client.get_client()
    docs = client.get_all_records("CompanyDocuments")
    doc = next((d for d in docs if str(d["id"]) == str(doc_id)), None)
    if not doc:
        logger.warning("Company document stream rejected: doc_id=%s not found", doc_id)
        raise HTTPException(status_code=404, detail="Document not found")

    drive = drive_client.get_drive_client()
    try:
        raw_bytes, mime, drive_name = drive.download_file(doc.get("drive_file_id"))
    except Exception as exc:
        logger.exception("Failed to stream company document doc_id=%s (drive_file_id=%s)", doc_id, doc.get("drive_file_id"))
        raise HTTPException(status_code=502, detail=f"Could not fetch document from Google Drive: {exc}")

    file_name = safe_content_disposition_filename(str(doc.get("name") or drive_name))
    disposition = "attachment" if download else "inline"
    headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{file_name}"}
    logger.info("Streaming company doc_id=%s to %s (disposition=%s, %d bytes)", doc_id, current_user.get("email"), disposition, len(raw_bytes))
    return StreamingResponse(iter([raw_bytes]), media_type=mime, headers=headers)


@router.delete("/{doc_id}")
def delete_company_document(doc_id: int, current_user: dict = Depends(require_admin)):
    client = sheets_client.get_client()
    docs = client.get_all_records("CompanyDocuments")
    doc = next((d for d in docs if str(d["id"]) == str(doc_id)), None)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    logger.info("Deleting company document doc_id=%s (drive_file_id=%s) requested by %s", doc_id, doc.get("drive_file_id"), current_user.get("email"))
    drive = drive_client.get_drive_client()
    drive_deleted = drive.delete_file(doc.get("drive_file_id"))
    if not drive_deleted:
        logger.warning("Drive file deletion returned False for drive_file_id=%s (doc_id=%s) - continuing to remove sheet row", doc.get("drive_file_id"), doc_id)
    client.delete_row_by_match("CompanyDocuments", "id", doc_id)
    logger.info("Company document delete complete: doc_id=%s", doc_id)
    audit_log(client, "company_document.delete", current_user.get("email"), "company_document", doc_id)
    return {"message": "Document deleted"}
