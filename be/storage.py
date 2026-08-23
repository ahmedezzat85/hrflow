"""
storage.py
Storage destination abstraction layer for HRFlow.
Supports:
- "drive": Google Drive (Shared Drive via Service Account)
- "local": Local filesystem directory (ideal for local development/deployment)

Controlled via Config.FILE_STORAGE_BACKEND and Config.LOCAL_STORAGE_PATH.
"""
import base64
import mimetypes
import os
import re
from abc import ABC, abstractmethod
from threading import Lock
from typing import Tuple, Optional, Dict, Any

from config import Config
from logging_config import get_logger

logger = get_logger("storage")

_storage_lock = Lock()
_storage_instance = None


def parse_data_url(data_url: str) -> Tuple[str, bytes]:
    """Splits a `data:<mime>;base64,<payload>` string into (mime, raw_bytes)."""
    match = re.match(r"^data:([^;]+);base64,(.+)$", data_url, re.DOTALL)
    if not match:
        logger.error("Rejected upload: data_url does not match expected 'data:<mime>;base64,<payload>' format (len=%d)", len(data_url or ""))
        raise ValueError("Invalid data URL")
    mime, payload = match.group(1), match.group(2)
    try:
        raw_bytes = base64.b64decode(payload)
    except Exception:
        logger.error("Rejected upload: base64 payload could not be decoded (mime=%s)", mime)
        raise
    logger.debug("Parsed data URL: mime=%s, decoded_size=%d bytes", mime, len(raw_bytes))
    return mime, raw_bytes


def sanitize_filename(filename: str) -> str:
    """Sanitizes a filename to avoid path traversal characters."""
    clean = os.path.basename(filename or "document")
    clean = re.sub(r"[\\/:*?\"<>|]", "_", clean).strip()
    return clean or "document"


def safe_employee_folder_name(employee_id, employee_name: str) -> str:
    clean_name = re.sub(r"[\\/:*?\"<>|]", "-", employee_name or "Unknown").strip()
    return f"{employee_id} - {clean_name}"


class StorageClient(ABC):
    """Abstract interface for HRFlow file and document storage."""

    @abstractmethod
    def upload_file(self, employee_id, employee_name: str, file_name: str, data_url: str) -> Dict[str, str]:
        """Uploads an employee document and returns {'file_id': ..., 'view_url': ..., 'download_url': ...}."""
        pass

    @abstractmethod
    def upload_company_file(self, file_name: str, data_url: str) -> Dict[str, str]:
        """Uploads a company document and returns {'file_id': ..., 'view_url': ..., 'download_url': ...}."""
        pass

    @abstractmethod
    def upload_invoice_file(
        self, payment_year: int, payment_month: int, file_name: str, file_bytes: bytes,
        employee_id=None, employee_name: str = "",
    ) -> Dict[str, str]:
        """Uploads an invoice document and returns {'file_id': ..., 'view_url': ..., 'download_url': ...}."""
        pass

    @abstractmethod
    def download_file(self, file_id: str) -> Tuple[bytes, str, str]:
        """Downloads a file and returns (raw_bytes, mime_type, file_name)."""
        pass

    @abstractmethod
    def delete_file(self, file_id: str) -> bool:
        """Deletes a file by its file_id. Returns True if deleted, False otherwise."""
        pass


class LocalStorageClient(StorageClient):
    """
    Local filesystem implementation of StorageClient.
    Stores files in structured directories under Config.LOCAL_STORAGE_PATH:
    - Employees: {base_path}/employees/{employee_id} - {employee_name}/{file_name}
    - Company Documents: {base_path}/Company Documents/{file_name}
    - Invoices: {base_path}/Invoices/{year}/{year}-{month:02d}/{file_name}
    """

    COMPANY_DOCS_FOLDER_NAME = "Company Documents"
    INVOICES_FOLDER_NAME = "Invoices"

    def __init__(self, base_path: Optional[str] = None):
        self.base_path = os.path.abspath(base_path or Config.LOCAL_STORAGE_PATH)
        os.makedirs(self.base_path, exist_ok=True)
        logger.info("Initialized LocalStorageClient (base_path=%s)", self.base_path)

    def _resolve_secure_path(self, relative_path: str) -> str:
        """
        Resolves a relative path against base_path and prevents directory traversal attacks.
        """
        # Normalize relative path (replace backslashes with forward slashes for POSIX consistency)
        clean_rel = os.path.normpath(relative_path.replace("\\", "/")).lstrip("/\\")
        resolved = os.path.abspath(os.path.join(self.base_path, clean_rel))
        try:
            common = os.path.commonpath([self.base_path, resolved])
        except ValueError:
            raise ValueError(f"Security error: Invalid path traversal attempt '{relative_path}'")
        if common != self.base_path:
            raise ValueError(f"Security error: Invalid path traversal attempt '{relative_path}'")
        return resolved

    def _to_relative_file_id(self, absolute_path: str) -> str:
        """Converts an absolute path to a portable relative file_id with POSIX forward slashes."""
        rel = os.path.relpath(absolute_path, self.base_path)
        return rel.replace("\\", "/")

    def get_or_create_employee_folder(self, employee_id, employee_name: str) -> str:
        folder_name = safe_employee_folder_name(employee_id, employee_name)
        folder_path = os.path.join(self.base_path, "employees", folder_name)
        os.makedirs(folder_path, exist_ok=True)
        return folder_path

    def get_or_create_company_docs_folder(self) -> str:
        folder_path = os.path.join(self.base_path, self.COMPANY_DOCS_FOLDER_NAME)
        os.makedirs(folder_path, exist_ok=True)
        return folder_path

    def get_or_create_invoices_period_folder(self, payment_year: int, payment_month: int) -> str:
        folder_path = os.path.join(
            self.base_path,
            self.INVOICES_FOLDER_NAME,
            str(payment_year),
            f"{payment_year}-{payment_month:02d}",
        )
        os.makedirs(folder_path, exist_ok=True)
        return folder_path

    def get_or_create_employee_invoices_year_folder(self, employee_id, employee_name: str, payment_year: int) -> str:
        emp_folder = self.get_or_create_employee_folder(employee_id, employee_name)
        invoices_year_folder = os.path.join(emp_folder, "invoices", str(payment_year))
        os.makedirs(invoices_year_folder, exist_ok=True)
        return invoices_year_folder

    def upload_file(self, employee_id, employee_name: str, file_name: str, data_url: str) -> Dict[str, str]:
        mime, raw_bytes = parse_data_url(data_url)
        folder_path = self.get_or_create_employee_folder(employee_id, employee_name)
        safe_name = sanitize_filename(file_name)
        target_path = os.path.join(folder_path, safe_name)

        logger.info("Saving local employee document: employee_id=%s, target_path=%s (%d bytes)", employee_id, target_path, len(raw_bytes))
        with open(target_path, "wb") as f:
            f.write(raw_bytes)

        file_id = self._to_relative_file_id(target_path)
        return {
            "file_id": file_id,
            "view_url": "",
            "download_url": "",
        }

    def upload_company_file(self, file_name: str, data_url: str) -> Dict[str, str]:
        mime, raw_bytes = parse_data_url(data_url)
        folder_path = self.get_or_create_company_docs_folder()
        safe_name = sanitize_filename(file_name)
        target_path = os.path.join(folder_path, safe_name)

        logger.info("Saving local company document: target_path=%s (%d bytes)", target_path, len(raw_bytes))
        with open(target_path, "wb") as f:
            f.write(raw_bytes)

        file_id = self._to_relative_file_id(target_path)
        return {
            "file_id": file_id,
            "view_url": "",
            "download_url": "",
        }

    def upload_invoice_file(
        self, payment_year: int, payment_month: int, file_name: str, file_bytes: bytes,
        employee_id=None, employee_name: str = "",
    ) -> Dict[str, str]:
        folder_path = self.get_or_create_invoices_period_folder(payment_year, payment_month)
        safe_name = sanitize_filename(file_name)
        target_path = os.path.join(folder_path, safe_name)

        logger.info("Saving local invoice file: target_path=%s (%d bytes)", target_path, len(file_bytes))
        with open(target_path, "wb") as f:
            f.write(file_bytes)

        # Also store copy in employee's invoices directory if employee_id provided
        if employee_id is not None:
            try:
                emp_invoices_folder = self.get_or_create_employee_invoices_year_folder(
                    employee_id, employee_name, payment_year
                )
                emp_target_path = os.path.join(emp_invoices_folder, safe_name)
                with open(emp_target_path, "wb") as f:
                    f.write(file_bytes)
                logger.info("Saved local invoice copy to employee folder: %s", emp_target_path)
            except Exception:
                logger.exception("Warning: Failed to save second invoice copy to employee folder for employee_id=%s", employee_id)

        file_id = self._to_relative_file_id(target_path)
        return {
            "file_id": file_id,
            "view_url": "",
            "download_url": "",
        }

    def download_file(self, file_id: str) -> Tuple[bytes, str, str]:
        if not file_id:
            raise ValueError("file_id is required")

        full_path = self._resolve_secure_path(file_id)
        if not os.path.isfile(full_path):
            logger.error("Local file not found: file_id=%s, full_path=%s", file_id, full_path)
            raise FileNotFoundError(f"File not found: {file_id}")

        with open(full_path, "rb") as f:
            raw_bytes = f.read()

        guessed_mime, _ = mimetypes.guess_type(full_path)
        mime = guessed_mime or "application/octet-stream"
        file_name = os.path.basename(full_path)

        logger.info("Read local file: file_id=%s (%d bytes, mime=%s)", file_id, len(raw_bytes), mime)
        return raw_bytes, mime, file_name

    def delete_file(self, file_id: str) -> bool:
        if not file_id:
            logger.warning("delete_file called with empty file_id - skipping local delete")
            return False

        try:
            full_path = self._resolve_secure_path(file_id)
            if os.path.isfile(full_path):
                os.remove(full_path)
                logger.info("Deleted local file: file_id=%s (path=%s)", file_id, full_path)
                return True
            logger.warning("Local file to delete did not exist: file_id=%s (path=%s)", file_id, full_path)
            return False
        except Exception:
            logger.exception("Failed to delete local file_id=%s", file_id)
            return False


def get_storage_client() -> StorageClient:
    """
    Factory function returning the active StorageClient instance based on Config.FILE_STORAGE_BACKEND.
    """
    global _storage_instance
    if _storage_instance is not None:
        return _storage_instance

    with _storage_lock:
        if _storage_instance is None:
            backend = Config.FILE_STORAGE_BACKEND
            if backend == "local":
                logger.info("Using LocalStorageClient (LOCAL_STORAGE_PATH=%s)", Config.LOCAL_STORAGE_PATH)
                _storage_instance = LocalStorageClient()
            else:
                logger.info("Using Google Drive StorageClient (DRIVE_ROOT_FOLDER_ID=%s)", Config.DRIVE_ROOT_FOLDER_ID)
                import drive_client
                _storage_instance = drive_client.DriveClient()
    return _storage_instance


def reset_storage_client_for_testing():
    """Resets the singleton storage instance for testing purposes."""
    global _storage_instance
    with _storage_lock:
        _storage_instance = None
