"""
drive_client.py
Thin data-access layer over Google Drive using the Google API Python client.
Stores each employee's documents in their own sub-folder under a root folder
(DRIVE_ROOT_FOLDER_ID) that must live inside a Shared Drive the service
account is a Content Manager member of (service accounts have no personal
storage quota, so a Shared Drive is required for uploads to succeed).

Company-wide documents/policies (not tied to an employee) are stored in a
single shared "Company Documents" sub-folder under the same root, created
on first use.

External-salary invoice generation (docs/analysis/invoice-autopay-plan.md)
stores every generated invoice in a global "Invoices" sub-folder under the
same root, organized by year and year-month, separate from per-employee
folders.

Documents are private by default: no public "anyone with the link" sharing
is set on uploaded files. Access is controlled entirely via the Shared
Drive's membership and any explicit per-folder sharing you configure in
Google Drive. The app streams file bytes to authorized users through its own
streaming endpoints (using the service account's Drive access), so end
users never need their own Drive permissions to preview or download a
document - the backend enforces the same admin/owner access rules as the
rest of the API.
"""
import base64
import io
import re
from threading import Lock

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload

from config import Config
from logging_config import get_logger

logger = get_logger("drive_client")

SCOPES = [
    "https://www.googleapis.com/auth/drive",
]

MIME_BY_TYPE = {
    "pdf": "application/pdf",
    "image": "image/png",
}

COMPANY_DOCS_FOLDER_NAME = "Company Documents"
_COMPANY_DOCS_CACHE_KEY = "__company_documents__"

_lock = Lock()
# Guards singleton CREATION only (see DriveClient.__new__). Same rationale
# as sheets_client.py's _instance_lock: concurrent first-time calls to
# get_drive_client() from parallel requests could otherwise race and hand
# a half-built instance (self.service not yet set) to a second thread.
_instance_lock = Lock()


def _parse_data_url(data_url: str):
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


def _safe_folder_name(employee_id, employee_name: str) -> str:
    clean_name = re.sub(r"[\\/:*?\"<>|]", "-", employee_name or "Unknown").strip()
    return f"{employee_id} - {clean_name}"


class DriveClient:
    _instance = None

    INVOICES_FOLDER_NAME = "Invoices"

    def __new__(cls):
        # Fast path: already fully connected, no locking needed.
        if cls._instance is not None:
            return cls._instance
        with _instance_lock:
            # Re-check inside the lock in case another thread finished
            # connecting while we were waiting for the lock.
            if cls._instance is None:
                instance = super().__new__(cls)
                instance._connect()
                cls._instance = instance
        return cls._instance

    def _connect(self):
        logger.info("Initializing Google Drive client (credentials_file=%s)", Config.GOOGLE_CREDENTIALS_FILE)
        try:
            creds = Credentials.from_service_account_file(
                Config.GOOGLE_CREDENTIALS_FILE, scopes=SCOPES
            )
            self.service = build("drive", "v3", credentials=creds, cache_discovery=False)
        except Exception:
            logger.exception("Failed to initialize Google Drive client. Check GOOGLE_CREDENTIALS_FILE path/content and Drive API is enabled.")
            raise
        self.root_folder_id = Config.DRIVE_ROOT_FOLDER_ID
        if not self.root_folder_id:
            logger.warning("DRIVE_ROOT_FOLDER_ID is not set. Document uploads will fail until it is configured.")
        self._folder_cache = {}
        logger.info("Google Drive client initialized (root_folder_id=%s)", self.root_folder_id or "")

    def _find_folder(self, name: str, parent_id: str):
        safe_name = name.replace("'", "\\'")
        query = (
            f"name = '{safe_name}' and mimeType = 'application/vnd.google-apps.folder' "
            f"and '{parent_id}' in parents and trashed = false"
        )
        logger.debug("Searching for Drive folder: name='%s', parent_id=%s", name, parent_id)
        try:
            res = self.service.files().list(
                q=query, spaces="drive", fields="files(id, name)",
                supportsAllDrives=True, includeItemsFromAllDrives=True,
                corpora="allDrives",
            ).execute()
        except HttpError:
            logger.exception("Drive API error while searching for folder '%s' under parent %s", name, parent_id)
            raise
        files = res.get("files", [])
        found_id = files[0]["id"] if files else None
        logger.debug("Folder search result for '%s': %s", name, found_id or "not found")
        return found_id

    def _create_folder(self, name: str, parent_id: str) -> str:
        metadata = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        logger.info("Creating Drive folder '%s' under parent %s", name, parent_id)
        try:
            folder = self.service.files().create(
                body=metadata, fields="id", supportsAllDrives=True,
            ).execute()
        except HttpError:
            logger.exception("Drive API error while creating folder '%s' under parent %s. Verify the service account is a Content Manager (or higher) member of the Shared Drive containing DRIVE_ROOT_FOLDER_ID.", name, parent_id)
            raise
        logger.info("Created Drive folder '%s' -> id=%s", name, folder["id"])
        return folder["id"]

    def get_or_create_employee_folder(self, employee_id, employee_name: str) -> str:
        """Returns the Drive folder ID for this employee, creating it if needed."""
        if not self.root_folder_id:
            logger.error("Cannot resolve employee folder: DRIVE_ROOT_FOLDER_ID is not configured")
            raise RuntimeError("DRIVE_ROOT_FOLDER_ID is not configured")
        cache_key = str(employee_id)
        with _lock:
            if cache_key in self._folder_cache:
                logger.debug("Using cached Drive folder for employee_id=%s -> %s", employee_id, self._folder_cache[cache_key])
                return self._folder_cache[cache_key]
        folder_name = _safe_folder_name(employee_id, employee_name)
        folder_id = self._find_folder(folder_name, self.root_folder_id)
        if not folder_id:
            folder_id = self._create_folder(folder_name, self.root_folder_id)
        with _lock:
            self._folder_cache[cache_key] = folder_id
        return folder_id

    def get_or_create_company_docs_folder(self) -> str:
        """
        Returns the Drive folder ID for company-wide documents/policies
        (general documents visible to every employee, not tied to one
        person), creating a single shared "Company Documents" sub-folder
        under the root folder the first time it's needed.
        """
        if not self.root_folder_id:
            logger.error("Cannot resolve company documents folder: DRIVE_ROOT_FOLDER_ID is not configured")
            raise RuntimeError("DRIVE_ROOT_FOLDER_ID is not configured")
        with _lock:
            if _COMPANY_DOCS_CACHE_KEY in self._folder_cache:
                logger.debug("Using cached company documents folder -> %s", self._folder_cache[_COMPANY_DOCS_CACHE_KEY])
                return self._folder_cache[_COMPANY_DOCS_CACHE_KEY]
        folder_id = self._find_folder(COMPANY_DOCS_FOLDER_NAME, self.root_folder_id)
        if not folder_id:
            folder_id = self._create_folder(COMPANY_DOCS_FOLDER_NAME, self.root_folder_id)
        with _lock:
            self._folder_cache[_COMPANY_DOCS_CACHE_KEY] = folder_id
        return folder_id

    def upload_file(self, employee_id, employee_name: str, file_name: str, data_url: str) -> dict:
        """
        Uploads a base64 data URL to the employee's Drive sub-folder inside
        the Shared Drive. Returns dict with file_id, view_url (webViewLink),
        and download_url. Files are NOT made public - visibility is fully
        governed by the Shared Drive's membership / folder-level sharing
        configured directly in Google Drive, plus the app's own
        `/api/employees/documents/{doc_id}/stream` endpoint which enforces
        the same access rules as the rest of the API.
        """
        logger.info("Starting document upload: employee_id=%s, file_name='%s'", employee_id, file_name)
        mime, raw_bytes = _parse_data_url(data_url)

        try:
            folder_id = self.get_or_create_employee_folder(employee_id, employee_name)
        except Exception:
            logger.exception("Failed to resolve/create Drive folder for employee_id=%s ('%s')", employee_id, employee_name)
            raise

        media = MediaIoBaseUpload(io.BytesIO(raw_bytes), mimetype=mime, resumable=False)
        metadata = {"name": file_name, "parents": [folder_id]}
        logger.debug("Uploading file to Drive: folder_id=%s, mime=%s, size=%d bytes", folder_id, mime, len(raw_bytes))
        try:
            created = self.service.files().create(
                body=metadata, media_body=media, fields="id, webViewLink, webContentLink",
                supportsAllDrives=True,
            ).execute()
        except HttpError as exc:
            logger.exception("Drive API error while uploading file '%s' for employee_id=%s (folder_id=%s): status=%s", file_name, employee_id, folder_id, getattr(exc, "status_code", "?"))
            raise
        except Exception:
            logger.exception("Unexpected error while uploading file '%s' for employee_id=%s", file_name, employee_id)
            raise

        file_id = created["id"]
        logger.info("File uploaded to Drive: file_id=%s, name='%s', employee_id=%s", file_id, file_name, employee_id)

        try:
            refreshed = self.service.files().get(
                fileId=file_id, fields="webViewLink, webContentLink",
                supportsAllDrives=True,
            ).execute()
        except HttpError:
            logger.exception("Drive API error while fetching links for file_id=%s", file_id)
            raise

        logger.info("Upload complete: file_id=%s, employee_id=%s, file_name='%s'", file_id, employee_id, file_name)
        return {
            "file_id": file_id,
            "view_url": refreshed.get("webViewLink", ""),
            "download_url": refreshed.get("webContentLink", ""),
        }

    def upload_company_file(self, file_name: str, data_url: str) -> dict:
        """
        Uploads a base64 data URL to the shared "Company Documents"
        sub-folder (general policies/documents visible to every employee,
        not tied to a specific person). Same return shape as upload_file().
        """
        logger.info("Starting company document upload: file_name='%s'", file_name)
        mime, raw_bytes = _parse_data_url(data_url)

        try:
            folder_id = self.get_or_create_company_docs_folder()
        except Exception:
            logger.exception("Failed to resolve/create company documents folder")
            raise

        media = MediaIoBaseUpload(io.BytesIO(raw_bytes), mimetype=mime, resumable=False)
        metadata = {"name": file_name, "parents": [folder_id]}
        logger.debug("Uploading company document to Drive: folder_id=%s, mime=%s, size=%d bytes", folder_id, mime, len(raw_bytes))
        try:
            created = self.service.files().create(
                body=metadata, media_body=media, fields="id, webViewLink, webContentLink",
                supportsAllDrives=True,
            ).execute()
        except HttpError as exc:
            logger.exception("Drive API error while uploading company document '%s' (folder_id=%s): status=%s", file_name, folder_id, getattr(exc, "status_code", "?"))
            raise
        except Exception:
            logger.exception("Unexpected error while uploading company document '%s'", file_name)
            raise

        file_id = created["id"]
        logger.info("Company document uploaded to Drive: file_id=%s, name='%s'", file_id, file_name)

        try:
            refreshed = self.service.files().get(
                fileId=file_id, fields="webViewLink, webContentLink",
                supportsAllDrives=True,
            ).execute()
        except HttpError:
            logger.exception("Drive API error while fetching links for file_id=%s", file_id)
            raise

        logger.info("Company document upload complete: file_id=%s, file_name='%s'", file_id, file_name)
        return {
            "file_id": file_id,
            "view_url": refreshed.get("webViewLink", ""),
            "download_url": refreshed.get("webContentLink", ""),
        }

    def get_or_create_invoices_period_folder(self, payment_year: int, payment_month: int) -> str:
        """
        Returns the Drive folder ID for a given invoice payment period,
        creating the "Invoices/<year>/<year>-<month>/" folder chain under
        the root folder if needed (docs/analysis/invoice-autopay-plan.md).
        Kept separate from per-employee folders so all generated invoices
        live in one predictable, admin-browsable location.
        """
        if not self.root_folder_id:
            logger.error("Cannot resolve invoices folder: DRIVE_ROOT_FOLDER_ID is not configured")
            raise RuntimeError("DRIVE_ROOT_FOLDER_ID is not configured")

        year_str = str(payment_year)
        period_str = f"{payment_year}-{payment_month:02d}"
        cache_key = f"__invoices__{period_str}"
        with _lock:
            if cache_key in self._folder_cache:
                return self._folder_cache[cache_key]

        invoices_root_id = self._find_folder(self.INVOICES_FOLDER_NAME, self.root_folder_id)
        if not invoices_root_id:
            invoices_root_id = self._create_folder(self.INVOICES_FOLDER_NAME, self.root_folder_id)

        year_folder_id = self._find_folder(year_str, invoices_root_id)
        if not year_folder_id:
            year_folder_id = self._create_folder(year_str, invoices_root_id)

        period_folder_id = self._find_folder(period_str, year_folder_id)
        if not period_folder_id:
            period_folder_id = self._create_folder(period_str, year_folder_id)

        with _lock:
            self._folder_cache[cache_key] = period_folder_id
        return period_folder_id

    def upload_invoice_file(self, payment_year: int, payment_month: int, file_name: str, file_bytes: bytes) -> dict:
        """
        Uploads a rendered invoice .docx (raw bytes, not a data URL) into
        the global Invoices/<year>/<year>-<month>/ folder. Returns dict
        with file_id and view_url, matching the shape of upload_file()/
        upload_company_file() for consistency across the codebase.
        """
        logger.info("Starting invoice upload: period=%s-%02d, file_name='%s'", payment_year, payment_month, file_name)
        folder_id = self.get_or_create_invoices_period_folder(payment_year, payment_month)

        docx_mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=docx_mime, resumable=False)
        metadata = {"name": file_name, "parents": [folder_id]}
        try:
            created = self.service.files().create(
                body=metadata, media_body=media, fields="id, webViewLink, webContentLink",
                supportsAllDrives=True,
            ).execute()
        except HttpError:
            logger.exception("Drive API error while uploading invoice '%s' (folder_id=%s)", file_name, folder_id)
            raise

        file_id = created["id"]
        try:
            refreshed = self.service.files().get(
                fileId=file_id, fields="webViewLink, webContentLink", supportsAllDrives=True,
            ).execute()
        except HttpError:
            logger.exception("Drive API error while fetching links for invoice file_id=%s", file_id)
            raise

        logger.info("Invoice upload complete: file_id=%s, file_name='%s'", file_id, file_name)
        return {
            "file_id": file_id,
            "view_url": refreshed.get("webViewLink", ""),
            "download_url": refreshed.get("webContentLink", ""),
        }

    def download_file(self, file_id: str):
        """
        Downloads a file's raw bytes and metadata (name, mimeType) from
        Drive using the service account's own access. This is what powers
        in-app preview and download: the backend fetches the bytes here and
        streams them back to the browser, so the signed-in HRFlow user
        never needs Drive permissions of their own - the API's existing
        access checks are the only gate.
        Returns (raw_bytes, mime_type, file_name).
        """
        if not file_id:
            raise ValueError("file_id is required")
        try:
            meta = self.service.files().get(
                fileId=file_id, fields="name, mimeType", supportsAllDrives=True,
            ).execute()
        except HttpError:
            logger.exception("Drive API error while fetching metadata for file_id=%s", file_id)
            raise

        try:
            request = self.service.files().get_media(fileId=file_id, supportsAllDrives=True)
            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            raw_bytes = buffer.getvalue()
        except HttpError:
            logger.exception("Drive API error while downloading media for file_id=%s", file_id)
            raise

        mime = meta.get("mimeType", "application/octet-stream")
        name = meta.get("name", "document")
        logger.info("Downloaded file_id=%s from Drive (%d bytes, mime=%s)", file_id, len(raw_bytes), mime)
        return raw_bytes, mime, name

    def delete_file(self, file_id: str) -> bool:
        if not file_id:
            logger.warning("delete_file called with empty file_id - skipping Drive delete")
            return False
        try:
            self.service.files().delete(fileId=file_id, supportsAllDrives=True).execute()
            logger.info("Deleted Drive file_id=%s", file_id)
            return True
        except Exception:
            logger.exception("Failed to delete Drive file_id=%s", file_id)
            return False


def get_drive_client() -> DriveClient:
    return DriveClient()
