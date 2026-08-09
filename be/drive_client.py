"""
drive_client.py
Thin data-access layer over Google Drive using the Google API Python client.
Stores each employee's documents in their own sub-folder under a root folder
(DRIVE_ROOT_FOLDER_ID) that must be shared with the service account as Editor.
"""
import base64
import io
import re
from threading import Lock

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from config import Config

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
        raise ValueError("Invalid data URL")
    mime, payload = match.group(1), match.group(2)
    return mime, base64.b64decode(payload)


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
        creds = Credentials.from_service_account_file(
            Config.GOOGLE_CREDENTIALS_FILE, scopes=SCOPES
        )
        self.service = build("drive", "v3", credentials=creds, cache_discovery=False)
        self.root_folder_id = Config.DRIVE_ROOT_FOLDER_ID
        self._folder_cache = {}

    def _find_folder(self, name: str, parent_id: str):
        safe_name = name.replace("'", "\\'")
        query = (
            f"name = '{safe_name}' and mimeType = 'application/vnd.google-apps.folder' "
            f"and '{parent_id}' in parents and trashed = false"
        )
        res = self.service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
        files = res.get("files", [])
        return files[0]["id"] if files else None

    def _create_folder(self, name: str, parent_id: str) -> str:
        metadata = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        folder = self.service.files().create(body=metadata, fields="id").execute()
        return folder["id"]

    def get_or_create_employee_folder(self, employee_id, employee_name: str) -> str:
        """Returns the Drive folder ID for this employee, creating it if needed."""
        if not self.root_folder_id:
            raise RuntimeError("DRIVE_ROOT_FOLDER_ID is not configured")
        cache_key = str(employee_id)
        with _lock:
            if cache_key in self._folder_cache:
                return self._folder_cache[cache_key]
            folder_name = _safe_folder_name(employee_id, employee_name)
            folder_id = self._find_folder(folder_name, self.root_folder_id)
            if not folder_id:
                folder_id = self._create_folder(folder_name, self.root_folder_id)
            self._folder_cache[cache_key] = folder_id
            return folder_id

    def upload_file(self, employee_id, employee_name: str, file_name: str, data_url: str) -> dict:
        """
        Uploads a base64 data URL to the employee's Drive sub-folder.
        Returns dict with file_id, view_url (webViewLink), and download_url.
        """
        mime, raw_bytes = _parse_data_url(data_url)
        folder_id = self.get_or_create_employee_folder(employee_id, employee_name)

        media = MediaIoBaseUpload(io.BytesIO(raw_bytes), mimetype=mime, resumable=False)
        metadata = {"name": file_name, "parents": [folder_id]}
        created = self.service.files().create(
            body=metadata, media_body=media, fields="id, webViewLink, webContentLink"
        ).execute()

        file_id = created["id"]
        # Allow anyone with the link (within the org, via service account sharing)
        # to view/download without needing their own Drive permissions on the file.
        self.service.permissions().create(
            fileId=file_id, body={"role": "reader", "type": "anyone"}
        ).execute()
        refreshed = self.service.files().get(
            fileId=file_id, fields="webViewLink, webContentLink"
        ).execute()

        return {
            "file_id": file_id,
            "view_url": refreshed.get("webViewLink", ""),
            "download_url": refreshed.get("webContentLink", ""),
        }

    def delete_file(self, file_id: str) -> bool:
        if not file_id:
            return False
        try:
            self.service.files().delete(fileId=file_id).execute()
            return True
        except Exception:
            return False


def get_drive_client() -> DriveClient:
    return DriveClient()
