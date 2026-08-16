"""
services/uploads.py
File-content validation and filename sanitization used by both the
employee-document and company-document upload/streaming endpoints. Moved
out of main.py during the router-decomposition refactor - pure structural
move, no behavior change.
"""
import base64
import re
from urllib.parse import quote

from fastapi import HTTPException


def detect_file_signature(data_url: str) -> str:
    """
    Decodes the base64 payload from a data URL and inspects the first
    bytes against known magic-byte signatures, returning "pdf", "image",
    or "unknown".
    """
    match = re.match(r"^data:([^;]+);base64,(.+)$", data_url, re.DOTALL)
    b64_payload = match.group(2) if match else data_url
    try:
        header_bytes = base64.b64decode(b64_payload[:64] + "==", validate=False)[:12]
    except Exception:
        return "unknown"

    if header_bytes.startswith(b"%PDF-"):
        return "pdf"
    if header_bytes.startswith(b"\xff\xd8\xff"):
        return "image"
    if header_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image"
    if header_bytes[:6] in (b"GIF87a", b"GIF89a"):
        return "image"
    if header_bytes[:4] == b"RIFF" and len(header_bytes) >= 12 and header_bytes[8:12] == b"WEBP":
        return "image"
    return "unknown"


def validate_upload_content(payload_file_type: str, data_url: str):
    """
    Raises HTTPException(400) if the actual file bytes don't match a
    supported type, or don't match what the client declared.
    """
    detected = detect_file_signature(data_url)
    if detected == "unknown":
        raise HTTPException(
            status_code=400,
            detail="File content doesn't match a supported format (PDF, JPEG, PNG, GIF, WEBP).",
        )
    if detected != payload_file_type:
        raise HTTPException(
            status_code=400,
            detail=f"File content looks like '{detected}' but was declared as '{payload_file_type}'.",
        )


def safe_content_disposition_filename(name: str) -> str:
    """
    Strips characters that could break or inject into the
    Content-Disposition header and percent-encodes the remainder for the
    RFC 5987 filename*=UTF-8''... form.
    """
    cleaned = re.sub(r'[\r\n\"\\/\x00-\x1f]', "", name).strip() or "document"
    return quote(cleaned)
