"""
be/tests/test_audit_db_integrity.py
The Stage 0 audit script reports bad data and stays silent on clean data. It only reads.
"""
import pytest
from sqlalchemy import create_engine, text

from db import Base
import models_db  # noqa: F401
import finance.models  # noqa: F401
from scripts.audit_db_integrity import INFORMATIONAL, run_audit


@pytest.fixture
def conn(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'audit.db'}")
    Base.metadata.create_all(bind=engine)
    with engine.connect() as c:
        yield c
    engine.dispose()


def _by_key(conn):
    return {s["key"]: s for s in run_audit(conn)}


def _real_findings(conn):
    return {k: s for k, s in _by_key(conn).items() if s["count"] and k not in INFORMATIONAL}


def _plan(conn, emp, start, end, comp="internal_usd_cash"):
    conn.execute(text(
        "INSERT INTO finance_employee_compensation_plans (employee_id, component_type, amount, currency, salary_basis, "
        "effective_start_date, effective_end_date, notes) VALUES (:e, :c, 100, 'USD', 'NET', :s, :en, '')"),
        {"e": emp, "c": comp, "s": start, "en": end})


def test_clean_database_has_no_findings(conn):
    conn.execute(text("INSERT INTO employees (id, name, email) VALUES (1, 'A', 'a@hrflow.test')"))
    _plan(conn, 1, "2026-01-01", "2026-06-30")
    _plan(conn, 1, "2026-07-01", None)
    _plan(conn, 1, "2026-01-01", None, comp="external_usd")  # other component never overlaps
    conn.commit()
    assert _real_findings(conn) == {}


def test_overlapping_plan_rows_are_reported(conn):
    conn.execute(text("INSERT INTO employees (id, name, email) VALUES (1, 'A', 'a@hrflow.test')"))
    _plan(conn, 1, "2026-01-01", None)
    _plan(conn, 1, "2026-03-01", None)
    conn.commit()
    found = _real_findings(conn)
    assert found["overlap:finance_employee_compensation_plans"]["count"] == 1


def test_bad_date_and_duplicate_bill_and_stale_vac_used(conn):
    # vac_used was dropped in Stage 1; the audit still checks databases that have not been upgraded yet
    conn.execute(text("ALTER TABLE employees ADD COLUMN vac_used INTEGER DEFAULT 0"))
    conn.execute(text("INSERT INTO employees (id, name, email, vac_used) VALUES (1, 'A', 'a@hrflow.test', 5)"))
    conn.execute(text("INSERT INTO salary_history (employee_id, date) VALUES (1, '01/02/2026')"))
    conn.execute(text("INSERT INTO finance_vendors (id, name, onboarding_status, is_active) VALUES (1, 'V', 'active', 1)"))
    for _ in range(2):
        conn.execute(text(
            "INSERT INTO finance_bills (vendor_id, bill_number, status, currency, capture_source, is_reviewed, "
            "is_duplicate_override, requires_approval, amount_paid, vendor_to_confirm) "
            "VALUES (1, 'B-1', 'approved', 'USD', 'manual', 1, 0, 0, 0, 0)"))
    conn.commit()
    found = _real_findings(conn)
    assert found["date:salary_history.date"]["count"] == 1
    assert found["dup:bills"]["count"] == 1
    assert found["cache:vac_used"]["count"] == 1  # vac_used 5, no approved vacation days


def test_audit_does_not_write(conn):
    conn.execute(text("INSERT INTO employees (id, name, email) VALUES (1, 'A', 'a@hrflow.test')"))
    conn.commit()
    before = conn.execute(text("SELECT COUNT(*) FROM employees")).scalar()
    run_audit(conn)
    assert conn.execute(text("SELECT COUNT(*) FROM employees")).scalar() == before
