"""
be/scripts/schema_drift.py
Compares the schema Alembic builds (upgrade head on an empty database) with the SQLAlchemy models, the schema a
fresh `create_all` would build. Differences mean the models and migrations disagree, so a database built from
migrations (staging, production) is not the schema the code assumes.

tests/test_schema_drift.py ratchets against tests/data/schema_drift_baseline.txt: new drift fails the test, and a
baseline entry that has been fixed must be removed. Each redesign stage shrinks the baseline.

Usage (from be/):
    python scripts/schema_drift.py                   # print current drift
    python scripts/schema_drift.py --write-baseline  # overwrite the baseline file
"""
import os
import subprocess
import sys
import tempfile
from typing import Iterable, List

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BE_DIR)

BASELINE_PATH = os.path.join(BE_DIR, "tests", "data", "schema_drift_baseline.txt")


def _flatten(diffs: Iterable) -> Iterable[tuple]:
    for item in diffs:
        if isinstance(item, list):
            yield from _flatten(item)
        else:
            yield item


def describe(diff: tuple) -> str:
    """A stable one-line name for an Alembic autogenerate diff."""
    op = diff[0]
    if op in ("add_index", "remove_index"):
        return f"{op}:{diff[1].table.name}.{diff[1].name}"
    if op in ("add_fk", "remove_fk"):
        fk = diff[1]
        return f"{op}:{fk.table.name}({','.join(fk.column_keys)})"
    if op == "modify_nullable":
        return f"{op}:{diff[2]}.{diff[3]}:{diff[5]}->{diff[6]}"
    if op in ("add_column", "remove_column"):
        return f"{op}:{diff[2]}.{diff[3].name}"
    if op in ("add_table", "remove_table"):
        return f"{op}:{diff[1].name}"
    if op == "modify_type":
        return f"{op}:{diff[2]}.{diff[3]}:{diff[5]}->{diff[6]}"
    return f"{op}:{diff[1]!r}"[:200]


def migrated_schema_drift() -> List[str]:
    """Sorted drift descriptions between `alembic upgrade head` on a fresh SQLite file and the models."""
    import sqlalchemy as sa
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    with tempfile.TemporaryDirectory() as tmp:
        url = f"sqlite:///{os.path.join(tmp, 'drift.db').replace(os.sep, '/')}"
        env = dict(os.environ, DATABASE_URL=url)
        done = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BE_DIR, env=env,
                              capture_output=True, text=True)
        if done.returncode != 0:
            raise RuntimeError(f"alembic upgrade head failed:\n{done.stderr[-2000:]}")
        from db import Base
        import models_db  # noqa: F401
        import finance.models  # noqa: F401
        engine = sa.create_engine(url)
        try:
            with engine.connect() as conn:
                ctx = MigrationContext.configure(conn, opts={"compare_type": True})
                diffs = compare_metadata(ctx, Base.metadata)
        finally:
            engine.dispose()
    return sorted({describe(d) for d in _flatten(diffs)})


def read_baseline() -> List[str]:
    with open(BASELINE_PATH, encoding="utf-8") as fh:
        return sorted(line.strip() for line in fh if line.strip() and not line.startswith("#"))


def main(argv: List[str]) -> int:
    drift = migrated_schema_drift()
    if "--write-baseline" in argv:
        os.makedirs(os.path.dirname(BASELINE_PATH), exist_ok=True)
        with open(BASELINE_PATH, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("# Known drift between `alembic upgrade head` and the models. Regenerate with\n"
                     "# `python scripts/schema_drift.py --write-baseline`; later stages must only shrink this file.\n")
            fh.write("\n".join(drift) + "\n")
        print(f"Wrote {len(drift)} entries to {BASELINE_PATH}")
    else:
        print("\n".join(drift) or "No drift.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
