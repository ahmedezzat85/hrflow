"""
drive_client.py
Thin data-access layer over Google Drive using the Google API Python client.
Stores each employee's documents in their own sub-folder under a root folder
(DRIVE_ROOT_FOLDER_ID) that must live inside a Shared Drive the service
account is a Content Manager member of (service accounts have no personal
storage quota, so a Shared Drive is required for uploads to succeed).

Documents are private by default: no public "anyone with the link" sharing
is set on uploaded files. Access is controlled entirely via the Shared
Drive's membership and any explicit per-folder sharing you configure in
Google Drive (e.g. sharing a single employee's sub-folder with just that
employee). The app's own view_url/download_url only work for accounts that
Google Drive already grants access to.
"""
import base64
import io
import re
from threading import Lock

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseUpload

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

_lock = Lock()


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

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._connect()
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
        logger.info("Google Drive client initialized (root_folder_id=%s)", self.root_folder_id or "<empty>")

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
            self._folder_cache[cache_key] = folder_id
            return folder_id

    def upload_file(self, employee_id, employee_name: str, file_name: str, data_url: str) -> dict:
        """
        Uploads a base64 data URL to the employee's Drive sub-folder inside
        the Shared Drive. Returns dict with file_id, view_url (webViewLink),
        and download_url. Files are NOT made public - visibility is fully
        governed by the Shared Drive's membership / folder-level sharing
        configured directly in Google Drive.
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

        # NOTE: We intentionally do NOT grant "anyone with the link" access
        # here. These documents hold private employee data - visibility is
        # controlled solely by Shared Drive membership and any explicit
        # per-folder sharing you configure directly in Google Drive (e.g.
        # sharing one employee's sub-folder with just that employee).
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
