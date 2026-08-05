"""
Configuration for HRFlow backend.
Loads secrets from environment variables (.env file supported via python-dotenv).
"""
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Path to the downloaded Google Service Account JSON key file (Sheets access)
    GOOGLE_CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")

    # The ID of your Google Sheet (found in its URL between /d/ and /edit)
    SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "")

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
