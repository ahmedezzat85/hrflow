"""
be/tests/test_schema_drift.py
Ratchet on the difference between `alembic upgrade head` and the SQLAlchemy models (scripts/schema_drift.py).
New drift fails; fixing drift requires removing the entry from tests/data/schema_drift_baseline.txt, so the file
only ever shrinks.
"""
import pytest

from scripts.schema_drift import migrated_schema_drift, read_baseline


@pytest.fixture(scope="module")
def drift():
    return migrated_schema_drift()


def test_no_new_drift_between_migrations_and_models(drift):
    new = sorted(set(drift) - set(read_baseline()))
    assert not new, (
        "The models and the migrations disagree in ways not in the baseline. Add a migration for the model change "
        "(or fix the model):\n  " + "\n  ".join(new)
    )


def test_baseline_has_no_fixed_entries(drift):
    fixed = sorted(set(read_baseline()) - set(drift))
    assert not fixed, (
        "These baseline entries no longer drift: remove them from tests/data/schema_drift_baseline.txt "
        "(python scripts/schema_drift.py --write-baseline):\n  " + "\n  ".join(fixed)
    )
