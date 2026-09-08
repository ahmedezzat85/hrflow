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

    # ---- Database & Storage Engine settings ----
    # Storage engine mode: "sql" (default, SQL as primary system of record), "dual", or "sheets" (legacy)
    STORAGE_ENGINE = os.getenv("STORAGE_ENGINE", "sql").lower()

    # Read source when in "dual" mode: "sql" (default, reads from SQL) or "sheets" (legacy)
    DUAL_READ_SOURCE = os.getenv("DUAL_READ_SOURCE", "sql").lower()

    # Relational Database engine type: "sqlite" (default) or "postgres" / "postgresql"
    DB_TYPE = os.getenv("DB_TYPE", "sqlite").lower()

    # Discrete PostgreSQL connection parameters (used if DATABASE_URL is not explicitly set)
    POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
    POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")
    POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
    POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
    POSTGRES_DB = os.getenv("POSTGRES_DB", "hrflow")

    # SQLite file path when DB_TYPE="sqlite"
    SQLITE_PATH = os.getenv("SQLITE_PATH", "./hrflow.db")

    # Database connection pool tuning (PostgreSQL)
    DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "10"))
    DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "20"))
    DB_POOL_RECYCLE = int(os.getenv("DB_POOL_RECYCLE", "1800"))

    # Relational database connection URL.
    # If explicitly set in the environment, takes precedence. Otherwise resolved from DB_TYPE.
    _raw_db_url = os.getenv("DATABASE_URL")
    if _raw_db_url and _raw_db_url.strip():
        DATABASE_URL = _raw_db_url.strip()
    elif DB_TYPE in ("postgres", "postgresql"):
        if POSTGRES_PASSWORD:
            DATABASE_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
        else:
            DATABASE_URL = f"postgresql://{POSTGRES_USER}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
    else:
        DATABASE_URL = f"sqlite:///{SQLITE_PATH}"

    # ---- File & Document Storage Destination settings ----
    # Storage backend: "drive" (default, Google Drive) or "local" (local filesystem)
    FILE_STORAGE_BACKEND = os.getenv("FILE_STORAGE_BACKEND", "drive").lower()

    # Local storage base directory when FILE_STORAGE_BACKEND="local"
    LOCAL_STORAGE_PATH = os.getenv(
        "LOCAL_STORAGE_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "storage")
    )


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

        if cls.FILE_STORAGE_BACKEND not in ("drive", "local"):
            errors.append(
                f"FILE_STORAGE_BACKEND must be 'drive' or 'local', got '{cls.FILE_STORAGE_BACKEND}'"
            )

        if cls.FILE_STORAGE_BACKEND == "local":
            try:
                os.makedirs(cls.LOCAL_STORAGE_PATH, exist_ok=True)
            except Exception as e:
                errors.append(
                    f"LOCAL_STORAGE_PATH '{cls.LOCAL_STORAGE_PATH}' cannot be created or accessed: {e}"
                )

        if cls.STORAGE_ENGINE != "sql":
            errors.append(
                f"STORAGE_ENGINE '{cls.STORAGE_ENGINE}' is not supported. HRFlow operates exclusively on SQL ('sql') as its database engine. Google Sheets is only supported as an export destination."
            )

        if cls.DB_TYPE not in ("sqlite", "postgres", "postgresql"):
            errors.append(
                f"DB_TYPE must be 'sqlite', 'postgres', or 'postgresql', got '{cls.DB_TYPE}'"
            )

        if cls.DB_TYPE in ("postgres", "postgresql") and not cls.DATABASE_URL.startswith(("postgresql://", "postgres://")):
            errors.append(
                f"DB_TYPE is '{cls.DB_TYPE}' but DATABASE_URL '{cls.DATABASE_URL}' does not start with postgresql://"
            )
        elif cls.DB_TYPE == "sqlite" and not cls.DATABASE_URL.startswith("sqlite"):
            errors.append(
                f"DB_TYPE is 'sqlite' but DATABASE_URL '{cls.DATABASE_URL}' does not start with sqlite"
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
