"""
be/migrations/money_support.py
Shared by the Stage 5b migrations that turn float money columns into exact NUMERIC columns (see finance/money.py).

convert(): checks first that no stored value would be rounded by the new scale (a value with more decimals than the column
keeps cannot be converted without changing it, so the upgrade stops and lists them), then changes the column types.
revert(): back to float.
The allowed precision is copied into each migration on purpose; this module only knows how to apply it.
"""
from typing import Dict, Tuple

import sqlalchemy as sa
from alembic import op

NOISE = 1e-9  # float representation noise is not a rounding problem


def _numeric(precision: int, scale: int):
    return sa.Numeric(precision, scale)


def _present(inspector, table: str, wanted: Dict[str, Tuple[int, int]]):
    if table not in inspector.get_table_names():
        return {}
    cols = {c["name"]: c for c in inspector.get_columns(table)}
    return {name: (cols[name], spec) for name, spec in wanted.items() if name in cols}


def check_scales(bind, tables: Dict[str, Dict[str, Tuple[int, int]]]) -> None:
    """Raise one RuntimeError listing every column value that has more decimals than its new scale."""
    inspector = sa.inspect(bind)
    problems = []
    for table, wanted in tables.items():
        for name, (col, (_precision, scale)) in _present(inspector, table, wanted).items():
            if isinstance(col["type"], sa.Numeric) and not isinstance(col["type"], sa.Float):
                continue  # already converted
            rows = bind.execute(sa.text(
                f"SELECT id, {name} FROM {table} WHERE {name} IS NOT NULL AND "
                f"ABS(CAST({name} AS NUMERIC) - ROUND(CAST({name} AS NUMERIC), {scale})) > {NOISE} ORDER BY id")).fetchall()
            if rows:
                shown = ", ".join(f"id {r[0]} = {r[1]!r}" for r in rows[:5])
                problems.append(f"{table}.{name}: {len(rows)} value(s) have more than {scale} decimals, e.g. {shown}")
    if problems:
        raise RuntimeError(
            "These money values would be rounded by the new column scale; correct them (or tell the owner), then upgrade again:\n  "
            + "\n  ".join(problems)
        )


def convert(tables: Dict[str, Dict[str, Tuple[int, int]]]) -> None:
    bind = op.get_bind()
    check_scales(bind, tables)
    inspector = sa.inspect(bind)
    for table, wanted in tables.items():
        todo = {n: v for n, v in _present(inspector, table, wanted).items()
                if not (isinstance(v[0]["type"], sa.Numeric) and not isinstance(v[0]["type"], sa.Float))}
        if not todo:
            continue
        with op.batch_alter_table(table) as batch_op:
            for name, (col, (precision, scale)) in todo.items():
                batch_op.alter_column(
                    name, type_=_numeric(precision, scale), existing_type=col["type"], existing_nullable=col["nullable"],
                    postgresql_using=f"{name}::numeric({precision},{scale})",
                )


def revert(tables: Dict[str, Dict[str, Tuple[int, int]]]) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table, wanted in tables.items():
        todo = {n: v for n, v in _present(inspector, table, wanted).items()
                if isinstance(v[0]["type"], sa.Numeric) and not isinstance(v[0]["type"], sa.Float)}
        if not todo:
            continue
        with op.batch_alter_table(table) as batch_op:
            for name, (col, _spec) in todo.items():
                batch_op.alter_column(name, type_=sa.Float(), existing_type=col["type"], existing_nullable=col["nullable"],
                                      postgresql_using=f"{name}::double precision")
