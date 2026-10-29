"""
be/db.py
Database connection setup and session management for HRFlow.
Supports PostgreSQL (production) and SQLite (testing/local fallback).
"""
import os
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker, Session

import config

Base = declarative_base()

_engine = None
_SessionFactory = None


def enable_sqlite_foreign_keys(engine) -> None:
    """SQLite ignores foreign keys unless every connection turns them on, so dev and tests would not enforce the
    RESTRICT / CASCADE / SET NULL rules that PostgreSQL enforces."""
    if engine.dialect.name != "sqlite":
        return

    @event.listens_for(engine, "connect")
    def _foreign_keys_on(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def get_engine():
    global _engine
    if _engine is None:
        db_url = config.Config.DATABASE_URL
        engine_kwargs = {
            "pool_pre_ping": True,
        }
        if db_url.startswith("sqlite"):
            engine_kwargs["connect_args"] = {"check_same_thread": False}
        else:
            engine_kwargs["pool_size"] = config.Config.DB_POOL_SIZE
            engine_kwargs["max_overflow"] = config.Config.DB_MAX_OVERFLOW
            engine_kwargs["pool_recycle"] = config.Config.DB_POOL_RECYCLE

        _engine = create_engine(
            db_url,
            **engine_kwargs,
        )
        enable_sqlite_foreign_keys(_engine)
    return _engine


def get_session_factory():
    global _SessionFactory
    if _SessionFactory is None:
        engine = get_engine()
        _SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return _SessionFactory


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency for obtaining a database session."""
    session_factory = get_session_factory()
    db = session_factory()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_context() -> Generator[Session, None, None]:
    """Context manager for obtaining a database session outside FastAPI requests (e.g. scripts/tests)."""
    session_factory = get_session_factory()
    db = session_factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def alembic_head_revision():
    """The newest Alembic revision in migrations/versions, or None when it cannot be read."""
    try:
        from alembic.config import Config as AlembicConfig
        from alembic.script import ScriptDirectory
        cfg = AlembicConfig(os.path.join(os.path.dirname(os.path.abspath(__file__)), "alembic.ini"))
        cfg.set_main_option("script_location", os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations"))
        return ScriptDirectory.from_config(cfg).get_current_head()
    except Exception:  # noqa: BLE001 - a version check must never stop the app from starting
        return None


def check_schema_version(engine) -> str:
    """'ok', 'behind' (database revision differs from the code's head), 'unstamped' (no alembic_version row) or 'unknown'.
    Logs an error for the first two: the schema is changed only by `alembic upgrade head`, never by the app."""
    import logging
    from sqlalchemy import inspect, text
    log = logging.getLogger(__name__)
    head = alembic_head_revision()
    if head is None:
        return "unknown"
    try:
        if "alembic_version" not in inspect(engine).get_table_names():
            log.error("The database has no alembic_version table. Run `alembic upgrade head` (or `alembic stamp head` if its schema is already current).")
            return "unstamped"
        with engine.connect() as conn:
            current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:  # noqa: BLE001
        return "unknown"
    if current != head:
        log.error("The database schema is at revision %s but the code expects %s. Run `alembic upgrade head`.", current, head)
        return "behind"
    return "ok"


def init_db():
    """Prepares the database for the app. The schema is changed only by Alembic migrations (`alembic upgrade head`,
    which the production container runs on every start): this function never alters an existing table.
    A brand-new SQLite file (local development and tests) gets its tables from the models so it works without a
    migration run; every other database is only checked against the Alembic head and an error is logged when behind."""
    import models_db  # noqa: F401 - ensure all models are registered with Base
    import finance.models  # noqa: F401 - ensure finance models are registered with Base
    from sqlalchemy import inspect, text
    engine = get_engine()
    if engine.dialect.name == "sqlite" and not inspect(engine).get_table_names():
        Base.metadata.create_all(bind=engine)
    else:
        check_schema_version(engine)

    # Books (D-028): seed Local/Overseas and put every account without a book in the default one
    try:
        from finance import books as _books
        with get_db_context() as db:
            default_id = _books.default_book_id(db)
            db.execute(text("UPDATE finance_bank_accounts SET book_id = :b WHERE book_id IS NULL"), {"b": default_id})
            db.execute(text("UPDATE finance_bank_accounts SET visibility = 'full' WHERE visibility IS NULL"))
            db.execute(text("UPDATE finance_customers SET is_intercompany = :f WHERE is_intercompany IS NULL"), {"f": False})
            db.commit()
    except Exception:
        import logging
        logging.getLogger(__name__).error("Book seeding failed", exc_info=True)

    # Revenue sources (D-029)
    try:
        from finance import revenue as _revenue
        with get_db_context() as db:
            _revenue.ensure_sources(db)
    except Exception:
        import logging
        logging.getLogger(__name__).error("Revenue source seeding failed", exc_info=True)

    # Idempotently synchronize RBAC catalog permissions and Super-Admin grants
    try:
        from core.role_seed import sync_catalog
        with get_db_context() as db:
            sync_catalog(db)
    except Exception as _rbac_err:
        import logging
        logging.getLogger(__name__).error("Fatal error synchronizing RBAC catalog: %s", _rbac_err, exc_info=True)
        raise

    # Idempotently seed default finance lookup categories and payment types (FUX-409)
    try:
        from finance.seed_data import seed_finance_lookups
        with get_db_context() as db:
            seed_finance_lookups(db)
    except Exception:
        pass

    # Idempotently seed default payroll tax settings (2026-01-01) if none exist
    try:
        import json
        from finance.models import PayrollTaxSettingsDB
        from finance.services.payroll_calculation_helper import DEFAULT_TAX_BRACKETS, DEFAULT_TAX_LIMIT_P
        with get_db_context() as db:
            if db.query(PayrollTaxSettingsDB).count() == 0:
                default_tax = PayrollTaxSettingsDB(
                    effective_from="2026-01-01",
                    tax_limit_p_egp=DEFAULT_TAX_LIMIT_P,
                    brackets_json=json.dumps(DEFAULT_TAX_BRACKETS),
                    created_by="system_seed",
                )
                db.add(default_tax)
                db.commit()
    except Exception:
        pass


def reset_engine_for_testing(custom_url: str = None):
    """Utility for test fixtures to bind a fresh in-memory or temporary database."""
    global _engine, _SessionFactory
    if custom_url:
        connect_args = {"check_same_thread": False} if custom_url.startswith("sqlite") else {}
        _engine = create_engine(custom_url, connect_args=connect_args, pool_pre_ping=True)
        enable_sqlite_foreign_keys(_engine)
    else:
        _engine = None
    _SessionFactory = None
