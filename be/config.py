"""
Configuration for HRFlow backend.
Loads secrets from environment variables (.env file supported via python-dotenv).
"""
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Path to the downloaded Google Service Account JSON key file (Sheets + Drive access)
    GOOGLE_CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")

    # The ID of your Google Sheet (found in its URL between /d/ and /edit)
    SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "")

    # The ID of the Google Drive folder (in your own Drive) that the service
    # account has been shared on as Editor. All employee document sub-folders
    # are created inside this root folder. Found in the folder's URL after /folders/.
    DRIVE_ROOT_FOLDER_ID = os.getenv("DRIVE_ROOT_FOLDER_ID", "")

    # Secret key used to sign our own session tokens (issued after Google verifies the user)
    SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret-in-production")

    # Token lifetime in hours
    TOKEN_EXPIRY_HOURS = int(os.getenv("TOKEN_EXPIRY_HOURS", "12"))

    # CORS allowed origins (comma separated). Use "*" for local prototyping only.
    ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")

    # ---- Google Sign-In (Sign In With Google) settings ----
    # OAuth 2.0 Web Client ID from Google Cloud Console (Credentials page)
    GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")

    # Your Google Workspace domain, e.g. "hrflow.com". Only accounts with this
    # domain (checked via the token's "hd" claim) will be allowed to log in.
    # Leave blank to allow any Google account (NOT recommended for production).
    ALLOWED_WORKSPACE_DOMAIN = os.getenv("ALLOWED_WORKSPACE_DOMAIN", "")

    # ---- Logging settings ----
    # Minimum severity written to both console and file:
    # DEBUG | INFO | WARNING | ERROR | CRITICAL
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

    # Path to the log file. Directory is created automatically if missing.
    # Point this at a persistent/mounted path in production so logs survive restarts.
    LOG_FILE_PATH = os.getenv("LOG_FILE_PATH", "logs/hrflow.log")

    # Rotating file handler settings
    LOG_MAX_BYTES = int(os.getenv("LOG_MAX_BYTES", str(5 * 1024 * 1024)))  # 5MB default
    LOG_BACKUP_COUNT = int(os.getenv("LOG_BACKUP_COUNT", "5"))
