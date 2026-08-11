"""
logging_config.py
Centralized logging setup for the HRFlow backend.

Logs are written both to the console and to a rotating log file. The log
file path and minimum severity level are configurable via environment
variables (see config.py -> LOG_FILE_PATH, LOG_LEVEL).

Usage in any module:
    import logging
    logger = logging.getLogger("hrflow.<module_name>")
    logger.info("...")
    logger.warning("...")
    logger.error("...")
    logger.debug("...")
"""
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

from config import Config

_LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_configured = False


def setup_logging():
    """
    Configures the root "hrflow" logger hierarchy once. Safe to call
    multiple times (e.g. on module reload) - it will only attach handlers
    the first time.

    Controlled via env vars:
      - LOG_LEVEL: DEBUG | INFO | WARNING | ERROR | CRITICAL (default INFO)
      - LOG_FILE_PATH: path to the log file (default "logs/hrflow.log")
      - LOG_MAX_BYTES: max size per log file before rotating (default 5MB)
      - LOG_BACKUP_COUNT: number of rotated backups to keep (default 5)
    """
    global _configured
    if _configured:
        return logging.getLogger("hrflow")

    level_name = (Config.LOG_LEVEL or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    logger = logging.getLogger("hrflow")
    logger.setLevel(level)
    logger.propagate = False

    formatter = logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT)

    # Console handler - always enabled, useful when tailing container logs.
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(level)
    logger.addHandler(console_handler)

    # Rotating file handler - path is configurable so it can point to a
    # persistent volume / mounted disk in production.
    log_file_path = Config.LOG_FILE_PATH
    try:
        log_dir = os.path.dirname(log_file_path)
        if log_dir and not os.path.isdir(log_dir):
            os.makedirs(log_dir, exist_ok=True)

        file_handler = RotatingFileHandler(
            log_file_path,
            maxBytes=Config.LOG_MAX_BYTES,
            backupCount=Config.LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        file_handler.setLevel(level)
        logger.addHandler(file_handler)
    except OSError as exc:
        # Don't crash the app if the log path is not writable - fall back
        # to console-only logging but make sure this is visible.
        logger.warning("Could not set up log file at '%s': %s. Falling back to console-only logging.", log_file_path, exc)

    # Tame noisy third-party loggers a bit (still visible at DEBUG level).
    for noisy in ("googleapiclient.discovery_cache", "urllib3", "google_auth_httplib2"):
        logging.getLogger(noisy).setLevel(max(level, logging.WARNING))

    _configured = True
    logger.info("Logging initialized (level=%s, file=%s)", level_name, log_file_path)
    return logger


def get_logger(name: str) -> logging.Logger:
    """Returns a child logger under the 'hrflow' namespace, e.g. 'hrflow.main'."""
    setup_logging()
    return logging.getLogger(f"hrflow.{name}")
