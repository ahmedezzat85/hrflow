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
    """Creates all tables defined in Base metadata (useful for quick local dev/testing)."""
    import models_db  # noqa: F401 - ensure all models are registered with Base
    engine = get_engine()
    Base.metadata.create_all(bind=engine)


def reset_engine_for_testing(custom_url: str = None):
    """Utility for test fixtures to bind a fresh in-memory or temporary database."""
    global _engine, _SessionFactory
    if custom_url:
        connect_args = {"check_same_thread": False} if custom_url.startswith("sqlite") else {}
        _engine = create_engine(custom_url, connect_args=connect_args, pool_pre_ping=True)
    else:
        _engine = None
    _SessionFactory = None
