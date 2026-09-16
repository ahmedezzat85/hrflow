"""
be/db.py
Database connection setup and session management for HRFlow.
Supports PostgreSQL (production) and SQLite (testing/local fallback).
"""
import os
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

import config

Base = declarative_base()

_engine = None
_SessionFactory = None


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


def init_db():
    """Creates all tables defined in Base metadata and synchronizes missing columns."""
    import models_db  # noqa: F401 - ensure all models are registered with Base
    import finance.models  # noqa: F401 - ensure finance models are registered with Base
    from sqlalchemy import inspect, text
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    # Sync missing columns on existing tables for local SQLite / dev instances
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.connect() as conn:
        for t_name, table in Base.metadata.tables.items():
            if t_name in existing_tables:
                current_cols = {c['name'] for c in inspector.get_columns(t_name)}
                for col in table.columns:
                    if col.name not in current_cols:
                        type_str = col.type.compile(engine.dialect)
                        conn.execute(text(f"ALTER TABLE {t_name} ADD COLUMN {col.name} {type_str}"))
        conn.commit()

    # Idempotently seed RBAC roles, permissions, and initial user links
    try:
        from core.rbac_seed import seed_rbac
        with get_db_context() as db:
            seed_rbac(db)
    except Exception:
        pass

    # Idempotently seed default finance lookup categories and payment types (FUX-409)
    try:
        from finance.seed_data import seed_finance_lookups
        with get_db_context() as db:
            seed_finance_lookups(db)
    except Exception:
        pass


def reset_engine_for_testing(custom_url: str = None):
    """Utility for test fixtures to bind a fresh in-memory or temporary database."""
    global _engine, _SessionFactory
    if custom_url:
        connect_args = {"check_same_thread": False} if custom_url.startswith("sqlite") else {}
        _engine = create_engine(custom_url, connect_args=connect_args, pool_pre_ping=True)
    else:
        _engine = None
    _SessionFactory = None
