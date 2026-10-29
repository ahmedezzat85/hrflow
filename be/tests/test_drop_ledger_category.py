"""
be/tests/test_drop_ledger_category.py
Stage 6b: migration 0069 drops the legacy finance_ledger_transactions.category text column that production still has.
"""
import os
import sqlite3
import subprocess
import sys

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(url, *args):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-1500:]


def _columns(path):
    with sqlite3.connect(path) as conn:
        return {r[1] for r in conn.execute("PRAGMA table_info(finance_ledger_transactions)")}


def test_the_legacy_column_is_dropped_and_comes_back_on_downgrade(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    assert "category" not in _columns(path) and "category_id" in _columns(path)
    _alembic(url, "downgrade", "0068_bill_scans")
    assert "category" in _columns(path)
    _alembic(url, "upgrade", "head")
    assert "category" not in _columns(path)
