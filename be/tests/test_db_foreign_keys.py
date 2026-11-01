"""
be/tests/test_db_foreign_keys.py
Foreign keys are enforced on SQLite as they are on PostgreSQL (Stage 0 of the database redesign), so dev and tests
cannot hide an orphan row or a missing cascade.
"""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from db import enable_sqlite_foreign_keys, get_engine, reset_engine_for_testing


@pytest.fixture
def engine(tmp_path):
    reset_engine_for_testing(f"sqlite:///{tmp_path / 'fk.db'}")
    from db import Base
    import models_db  # noqa: F401
    eng = get_engine()
    Base.metadata.create_all(bind=eng)
    yield eng
    eng.dispose()
    reset_engine_for_testing(None)


def test_pragma_is_on_for_every_connection(engine):
    for _ in range(3):
        with engine.connect() as conn:
            assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_child_row_without_parent_is_rejected(engine):
    with engine.begin() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(text("INSERT INTO salary_history (employee_id, date) VALUES (999, '2026-01-01')"))


def test_delete_cascades_from_employee_to_children(engine):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO employees (id, name, email) VALUES (1, 'A', 'a@hrflow.test')"))
        conn.execute(text("INSERT INTO employee_notes (employee_id, date) VALUES (1, '2026-01-01')"))
        conn.execute(text("DELETE FROM employees WHERE id = 1"))
        assert conn.execute(text("SELECT COUNT(*) FROM employee_notes")).scalar() == 0


def test_restrict_blocks_deleting_an_employee_with_payroll_history(engine):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO employees (id, name, email) VALUES (1, 'A', 'a@hrflow.test')"))
        conn.execute(text(
            "INSERT INTO finance_employee_compensation_plans (employee_id, component_type, amount, currency, salary_basis, "
            "effective_start_date, notes) VALUES (1, 'internal_usd_cash', 100, 'USD', 'NET', '2026-01-01', '')"))
    with engine.begin() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(text("DELETE FROM employees WHERE id = 1"))


def test_helper_ignores_other_dialects():
    class Fake:
        class dialect:  # noqa: N801 - mimics sqlalchemy's engine.dialect
            name = "postgresql"
    enable_sqlite_foreign_keys(Fake())  # must not try to register a listener on a non-engine
