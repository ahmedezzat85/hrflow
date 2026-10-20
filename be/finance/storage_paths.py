"""
be/finance/storage_paths.py
Where Finance stores uploaded documents (bill PDFs, cheque scans, statement files, subscription proofs, imported scans).

Development keeps the historical default under be/uploads. Production runs the app in a read-only container whose only
writable locations are the mounted data volume and /tmp, so the folders are set by environment variables
(BILL_UPLOADS_DIR, FINANCE_UPLOADS_DIR) that point into the volume (see deploy/prod/docker-compose.yml).
"""
import logging
import os

logger = logging.getLogger(__name__)

_BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def resolve_uploads_dir(env_name: str, default_leaf: str) -> str:
    configured = (os.environ.get(env_name) or "").strip()
    return configured or os.path.join(_BE_DIR, "uploads", default_leaf)


def ensure_dir(path: str) -> bool:
    """Create the folder if possible. Never raises: a service must be constructible (and read endpoints must work)
    even when the folder cannot be created; the write that needs it creates it again and reports the real error."""
    try:
        os.makedirs(path, exist_ok=True)
        return True
    except OSError as e:
        logger.warning("Upload folder %s is not writable: %s", path, e)
        return False
