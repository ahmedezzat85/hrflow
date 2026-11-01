"""
be/tests/test_init_db_schema_path.py
Database redesign Stage 5a: the schema is changed only by Alembic. init_db() builds a brand-new SQLite file from the models
(local development and tests), never alters an existing table, and logs an error when the database is behind the code.
"""
import logging
import os
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import create_engine

import db as db_module

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(url, *args):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-1500:]


def _cols(path, table):
    with sqlite3.connect(path) as conn:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


@pytest.fixture
def isolated_engine(tmp_path):
    path = tmp_path / "init.db"
    db_module.reset_engine_for_testing(f"sqlite:///{path.as_posix()}")
    yield path
    db_module.reset_engine_for_testing(None)


def test_a_brand_new_sqlite_file_gets_its_tables_from_the_models(isolated_engine):
    db_module.init_db()
    assert {"employees", "finance_bills", "finance_payments"} <= {
        r[0] for r in sqlite3.connect(isolated_engine).execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def test_init_db_never_alters_an_existing_table(isolated_engine):
    db_module.init_db()
    with sqlite3.connect(isolated_engine) as conn:
        conn.execute("ALTER TABLE employees DROP COLUMN address_line_2")
        conn.commit()
    db_module.init_db()   # the old sync would have added the column back
    assert "address_line_2" not in _cols(isolated_engine, "employees")


def test_the_schema_check_reports_ok_behind_and_unstamped(tmp_path, caplog):
    path = tmp_path / "ver.db"
    url = f"sqlite:///{path.as_posix()}"
    engine = create_engine(url)
    try:
        # no tables at all: nothing stamped
        sqlite3.connect(path).close()
        with caplog.at_level(logging.ERROR, logger="db"):
            assert db_module.check_schema_version(engine) == "unstamped"
        assert "alembic upgrade head" in caplog.text

        _alembic(url, "upgrade", "0058_value_checks")
        caplog.clear()
        with caplog.at_level(logging.ERROR, logger="db"):
            assert db_module.check_schema_version(engine) == "behind"
        assert "0058_value_checks" in caplog.text

        _alembic(url, "upgrade", "head")
        caplog.clear()
        assert db_module.check_schema_version(engine) == "ok"
        assert not caplog.records
    finally:
        engine.dispose()
