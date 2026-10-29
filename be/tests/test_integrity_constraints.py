"""
be/tests/test_integrity_constraints.py
Database redesign Stage 4a: rules the application enforces are also database constraints, and migration 0056 adds them
to existing databases, stopping with a list when existing rows break a rule.
"""
import os
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from db import get_db_context

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _vendor(db, name):
    db.execute(text("INSERT INTO finance_vendors (name, onboarding_status, is_active) VALUES (:n, 'active', 1)"), {"n": name})
    return db.execute(text("SELECT id FROM finance_vendors WHERE name = :n"), {"n": name}).scalar()


def _bill(db, vendor_id, number, status="approved", override=0):
    db.execute(text(
        "INSERT INTO finance_bills (vendor_id, bill_number, status, currency, is_reviewed, is_duplicate_override, requires_approval, "
        "capture_source, vendor_to_confirm) VALUES (:v, :n, :s, 'USD', 1, :o, 0, 'manual', 0)"),
        {"v": vendor_id, "n": number, "s": status, "o": override})


def test_bill_numbers_are_unique_except_drafts_and_overrides(app_client):
    with get_db_context() as db:
        vid = _vendor(db, "Constraint Vendor")
        _bill(db, vid, "UQ-1")
        _bill(db, vid, "UQ-1", status="draft")                 # a Draft may hold any number (D-019)
        _bill(db, vid, "UQ-1", status="approved", override=1)  # the explicit duplicate override
        db.commit()
        with pytest.raises(IntegrityError):
            _bill(db, vid, "UQ-1")
            db.commit()
        db.rollback()


def test_one_active_payroll_run_per_period(app_client):
    with get_db_context() as db:
        for status in ("cancelled", "cancelled", "draft"):
            db.execute(text("INSERT INTO finance_payroll_runs (period_label, period_start, period_end, status) "
                            "VALUES ('2031-01', '2031-01-01', '2031-01-31', :s)"), {"s": status})
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(text("INSERT INTO finance_payroll_runs (period_label, period_start, period_end, status) "
                            "VALUES ('2031-01', '2031-01-01', '2031-01-31', 'approved')"))
            db.commit()
        db.rollback()


def test_one_open_ended_row_per_employee_in_effective_dated_tables(app_client):
    with get_db_context() as db:
        db.execute(text("INSERT INTO employees (id, name, email) VALUES (9001, 'C', 'c9001@hrflow.test')"))
        plan = ("INSERT INTO finance_employee_compensation_plans (employee_id, component_type, amount, currency, salary_basis, "
                "effective_start_date, effective_end_date, notes) VALUES (9001, :c, 100, 'USD', 'NET', :s, :e, '')")
        db.execute(text(plan), {"c": "internal_usd_cash", "s": "2026-01-01", "e": "2026-06-30"})
        db.execute(text(plan), {"c": "internal_usd_cash", "s": "2026-07-01", "e": None})
        db.execute(text(plan), {"c": "external_usd", "s": "2026-07-01", "e": None})   # other component is fine
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(text(plan), {"c": "internal_usd_cash", "s": "2026-09-01", "e": None})
            db.commit()
        db.rollback()
        db.execute(text("INSERT INTO employee_tax_method (employee_id, method, effective_start_date, notes) VALUES (9001, 'progressive', '2026-01-01', '')"))
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(text("INSERT INTO employee_tax_method (employee_id, method, effective_start_date, notes) VALUES (9001, 'flat', '2026-02-01', '')"))
            db.commit()
        db.rollback()
        db.execute(text("INSERT INTO employee_social_insurance (employee_id, insured_flag, currency, effective_start_date, notes) VALUES (9001, 1, 'EGP', '2026-01-01', '')"))
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(text("INSERT INTO employee_social_insurance (employee_id, insured_flag, currency, effective_start_date, notes) VALUES (9001, 0, 'EGP', '2026-03-01', '')"))
            db.commit()
        db.rollback()


def test_one_generated_salary_document_per_employee_and_month(app_client):
    with get_db_context() as db:
        db.execute(text("INSERT INTO employees (id, name, email) VALUES (9002, 'D', 'd9002@hrflow.test')"))
        doc = ("INSERT INTO salary_payment_docs (employee_id, invoice_number, payment_year, payment_month, status) "
               "VALUES (9002, 'N', 2031, 5, :s)")
        db.execute(text(doc), {"s": "failed"})
        db.execute(text(doc), {"s": "failed"})
        db.execute(text(doc), {"s": "generated"})
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(text(doc), {"s": "generated"})
            db.commit()
        db.rollback()


def test_an_attachment_has_exactly_one_parent(app_client):
    with get_db_context() as db:
        db.execute(text("INSERT INTO employees (id, name, email) VALUES (9003, 'E', 'e9003@hrflow.test')"))
        vid = _vendor(db, "Attach Vendor")
        db.execute(text("INSERT INTO finance_customers (name, is_active) VALUES ('Cust', 1)"))
        cust = db.execute(text("SELECT id FROM finance_customers WHERE name = 'Cust'")).scalar()
        db.execute(text("INSERT INTO finance_sales_invoices (customer_id, invoice_number, issue_date, due_date, status, currency) "
                        "VALUES (:c, 'ATT-1', '2026-01-01', '2026-02-01', 'draft', 'USD')"), {"c": cust})
        inv = db.execute(text("SELECT id FROM finance_sales_invoices WHERE invoice_number = 'ATT-1'")).scalar()
        base = "INSERT INTO finance_attachments (file_name, file_size, mime_type, storage_ref, {cols}) VALUES ('f', 1, 'x', 'ref', {vals})"
        db.execute(text(base.format(cols="sales_invoice_id", vals=str(inv))))   # one parent: fine
        db.commit()
        for sql in (base.format(cols="uploaded_by", vals="'nobody'"),                      # no parent
                    base.format(cols="sales_invoice_id, cheque_id", vals=f"{inv}, 1")):    # two parents
            with pytest.raises(IntegrityError):
                db.execute(text(sql))
                db.commit()
            db.rollback()
        assert vid  # vendor row is only here to exercise a second table


# --- migration 0056 ---------------------------------------------------------------------------------------------

def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _indexes(path):
    with sqlite3.connect(path) as conn:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'uq%'")}


def _legacy(path):
    """Drop the new unique indexes, as a database from before Stage 4 does not have them."""
    with sqlite3.connect(path) as conn:
        for name in _indexes(path):
            if name != "uq_subscription_expected_charge" and name != "uq_finance_payments_ledger_transaction_id":
                conn.execute(f"DROP INDEX {name}")
        conn.commit()


def test_migration_0056_adds_the_constraints_and_downgrade_drops_them(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0055_payroll_line_cleanup")
    _legacy(path)
    _alembic(url, "upgrade", "head")
    got = _indexes(path)
    assert {"uq_bills_number", "uq_payroll_runs_period_active", "uq_emp_comp_plan_open", "uq_emp_social_ins_open",
            "uq_emp_tax_method_open", "uq_salary_payment_docs_generated"} <= got
    _alembic(url, "downgrade", "0055_payroll_line_cleanup")
    assert not {"uq_bills_number", "uq_payroll_runs_period_active", "uq_emp_comp_plan_open"} & _indexes(path)


def test_migration_0056_stops_and_lists_every_violation(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0055_payroll_line_cleanup")
    _legacy(path)
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO employees (id, name, email) VALUES (1, 'E', 'e@hrflow.test')")
        for status in ("draft", "approved"):
            conn.execute("INSERT INTO finance_payroll_runs (period_label, period_start, period_end, status) "
                         "VALUES ('2030-01', '2030-01-01', '2030-01-31', ?)", (status,))
        for start in ("2026-01-01", "2026-02-01"):
            conn.execute("INSERT INTO employee_tax_method (employee_id, method, effective_start_date, notes) VALUES (1, 'progressive', ?, '')", (start,))
        conn.commit()
    done = _alembic(url, "upgrade", "head", expect_ok=False)
    assert done.returncode != 0
    assert "2030-01" in done.stderr and "tax method" in done.stderr
    assert "uq_payroll_runs_period_active" not in _indexes(path)  # nothing was half-applied
