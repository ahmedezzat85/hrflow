"""
Configuration for HRFlow backend.
Loads secrets from environment variables (.env file supported via python-dotenv).
"""
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # "development" (default, local work) or "production". Controls whether
    # the strict security checks in Config.validate() below are enforced.
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
    IS_PRODUCTION = ENVIRONMENT.lower() == "production"

    # Path to the downloaded Google Service Account JSON key file (Sheets + Drive access)
    GOOGLE_CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")

    # The ID of your Google Sheet (found in its URL between /d/ and /edit)
    SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "")

    # The ID of the Google Drive folder (in your own Drive) that the service
    # account has been shared on as Editor. All employee document sub-folders
    # are created inside this root folder. Found in the folder's URL after /folders/.
    DRIVE_ROOT_FOLDER_ID = os.getenv("DRIVE_ROOT_FOLDER_ID", "")

    # Secret key used to sign our own session tokens (issued after Google verifies
    # the user). MUST be set explicitly via env var - there is intentionally no
    # default value here. A missing/placeholder secret would let anyone forge
    # admin session cookies, so Config.validate() refuses to let the app start
    # without a real one.
    SECRET_KEY = os.getenv("SECRET_KEY", "")

    # Token lifetime in hours
    TOKEN_EXPIRY_HOURS = int(os.getenv("TOKEN_EXPIRY_HOURS", "12"))

    # ---- Session cookie settings ----
    # The session token lives in an HttpOnly cookie (never in localStorage and
    # never in a URL query string), so it cannot be read or exfiltrated by
    # JavaScript running on the page - even if an XSS bug exists elsewhere.
    SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "hrflow_session")

    # "Secure" (HTTPS-only) is forced on in production and left off in local
    # dev, since plain http://localhost cannot carry a Secure cookie.
    COOKIE_SECURE = IS_PRODUCTION

    # "Lax" is used intentionally instead of "Strict"/"None":
    # - A frontend on http://localhost:5173 and a backend on http://localhost:8000
    #   are different *origins* but the same *site* (both "localhost"), and
    #   SameSite is evaluated at the site level - so a "Lax" cookie is still
    #   sent on these cross-port fetch() calls, with no HTTPS needed in dev.
    # - In production, keep the frontend and API on the same registrable
    #   domain (e.g. app.example.com / api.example.com) so "Lax" keeps working
    #   with COOKIE_SECURE=True. If they ever end up on unrelated domains,
    #   this must become "None" (which then strictly requires Secure=True).
    COOKIE_SAMESITE = "lax"

    # CORS allowed origins (comma separated). Use "*" for local prototyping
    # only - Config.validate() refuses "*" when ENVIRONMENT=production.
    ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")

    # ---- Google Sign-In (Sign In With Google) settings ----
    # OAuth 2.0 Web Client ID from Google Cloud Console (Credentials page)
    GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")

    # Your Google Workspace domain, e.g. "hrflow.com". Only accounts with this
    # domain (checked via the token's "hd" claim) will be allowed to log in.
    # Leave blank to allow any Google account (NOT recommended for production;
    # Config.validate() requires this to be set when ENVIRONMENT=production).
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

    # ---- Invoice template settings ----
    INVOICE_TEMPLATE_PATH = os.getenv("INVOICE_TEMPLATE_PATH", "")
    INVOICE_TEMPLATE_VERSION = os.getenv("INVOICE_TEMPLATE_VERSION", "v1")

    # ---- Google Sheets caching & quota settings ----
    # In-memory TTL in seconds for get_all_records() reads per sheet tab.
    # Set to 0 to disable caching (not recommended; causes quota exhaustion).
    SHEETS_CACHE_TTL_SECONDS = int(os.getenv("SHEETS_CACHE_TTL_SECONDS", "30"))


    @classmethod
    def validate(cls):
        """
        Fails fast at startup if security-critical settings are missing or
        unsafe, instead of silently running insecurely. Called once from
        main.py before the app starts serving requests. Some checks only
        apply when ENVIRONMENT=production so local development stays
        low-friction (see docs/analysis/security-analysis-plan.md, Phase 1).
        """
        errors = []

        if not cls.SECRET_KEY or cls.SECRET_KEY == "change-this-secret-in-production":
            errors.append(
                "SECRET_KEY is not set. Generate one, e.g.:\n"
                "    python -c \"import secrets; print(secrets.token_hex(32))\"\n"
                "  and set it as the SECRET_KEY environment variable before starting the app."
            )

        if cls.IS_PRODUCTION:
            if cls.ALLOWED_ORIGINS == "*":
                errors.append(
                    "ALLOWED_ORIGINS is '*' while ENVIRONMENT=production. Set an "
                    "explicit comma-separated list of allowed frontend origins."
                )
            if not cls.ALLOWED_WORKSPACE_DOMAIN:
                errors.append(
                    "ALLOWED_WORKSPACE_DOMAIN is not set while ENVIRONMENT=production. "
                    "Without it, any Google account (not just your Workspace) can sign in."
                )

        if errors:
            raise RuntimeError(
                "HRFlow refused to start due to unsafe configuration:\n- "
                + "\n- ".join(errors)
            )
