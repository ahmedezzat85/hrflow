"""
be/tests/test_migrations_postgres_safe.py
CI runs on SQLite, production runs on PostgreSQL. The migrations of the database redesign (0048 and later) run SQL on both, so
they must not use SQL that only SQLite accepts. A migration once used ROUND(double, 2) in a downgrade: PostgreSQL has no such
function (ROUND with a scale needs NUMERIC), and only a run against PostgreSQL showed it. This test keeps the known cases out;
when a migration needs dialect-specific SQL it must branch on `bind.dialect.name`.
"""
import glob
import os
import re

VERSIONS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations", "versions")

FORBIDDEN = (
    (re.compile(r"\bROUND\((?!\s*CAST)"), "ROUND(...) on a float: wrap the value in CAST(... AS NUMERIC)"),
    (re.compile(r"\bstrftime\s*\(", re.I), "strftime() exists only in SQLite"),
    (re.compile(r"INSERT\s+OR\s+(IGNORE|REPLACE)", re.I), "INSERT OR IGNORE / REPLACE exists only in SQLite"),
    (re.compile(r"\bPRAGMA\b", re.I), "PRAGMA exists only in SQLite"),
    (re.compile(r"\bAUTOINCREMENT\b", re.I), "AUTOINCREMENT exists only in SQLite"),
)


def _redesign_migrations():
    for path in sorted(glob.glob(os.path.join(VERSIONS, "*.py"))):
        number = os.path.basename(path).split("_", 1)[0]
        if number.isdigit() and int(number) >= 48:
            yield path


def test_redesign_migrations_avoid_sqlite_only_sql():
    offenders = []
    for path in _redesign_migrations():
        for number, line in enumerate(open(path, encoding="utf-8"), 1):
            code = line.split("#", 1)[0]
            for pattern, reason in FORBIDDEN:
                if pattern.search(code) and "dialect" not in code:
                    offenders.append(f"{os.path.basename(path)}:{number}: {reason}: {line.strip()}")
    assert not offenders, "\n  ".join(["SQL that PostgreSQL rejects:"] + offenders)
