"""
be/tests/test_schema_parity.py
Database redesign Stage 4c: a database built by `alembic upgrade head` has every foreign key and index the models declare
(migration 0062); orphans on nullable references are set to NULL and logged, other problems stop the upgrade with a list.
"""
import os
import sqlite3
import subprocess
import sys

import pytest

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _fks(path, table):
    with sqlite3.connect(path) as conn:
        return {(r[3], r[2], r[6]) for r in conn.execute(f"PRAGMA foreign_key_list({table})")}


def _indexes(path, table):
    with sqlite3.connect(path) as conn:
        return {r[1]: bool(r[2]) for r in conn.execute(f"PRAGMA index_list({table})")}


def test_migrated_database_has_the_missing_foreign_keys_and_indexes(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0061_employee_archived")
    before_fks = _fks(path, "finance_ledger_transactions")
    _alembic(url, "upgrade", "head")
    after = _fks(path, "finance_ledger_transactions")
    assert ("category_id", "finance_transaction_categories", "SET NULL") in after
    assert ("payment_type_id", "finance_payment_types", "SET NULL") in after
    assert ("revenue_source_id", "finance_revenue_sources", "SET NULL") in after
    assert after >= before_fks
    assert ("book_id", "finance_books", "RESTRICT") in _fks(path, "finance_bank_accounts")
    assert ("cheque_id", "finance_cheques", "CASCADE") in _fks(path, "finance_attachments")
    idx = _indexes(path, "finance_ledger_transactions")
    assert "ix_finance_ledger_transactions_payee_id" in idx and "ix_finance_ledger_transactions_entry_type" in idx
    assert not [n for n in _indexes(path, "salary_payment_docs") if n.startswith("ix_invoices_")]
    assert "ix_salary_payment_docs_emp_period" in _indexes(path, "salary_payment_docs")


def test_orphan_references_on_nullable_columns_are_set_to_null(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0061_employee_archived")
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO finance_vendors (id, name, onboarding_status, is_active, default_category_id) VALUES (1, 'V', 'active', 1, 9999)")
        conn.execute("INSERT INTO finance_bills (id, vendor_id, bill_number, status, currency, category_id, is_reviewed, is_duplicate_override, "
                     "requires_approval, capture_source, vendor_to_confirm) VALUES (1, 1, 'B', 'draft', 'USD', 8888, 1, 0, 0, 'manual', 0)")
        conn.commit()
    if ("default_category_id", "finance_transaction_categories", "SET NULL") in _fks(path, "finance_vendors"):
        pytest.skip("this chain already builds finance_vendors with the foreign key, so an orphan cannot be planted")
    _alembic(url, "upgrade", "head")
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT default_category_id FROM finance_vendors WHERE id = 1").fetchone() == (None,)
        assert conn.execute("SELECT category_id FROM finance_bills WHERE id = 1").fetchone() == (None,)


def test_orphans_that_need_a_decision_stop_the_upgrade_with_a_list(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0061_employee_archived")
    if ("cheque_id", "finance_cheques", "CASCADE") in _fks(path, "finance_attachments"):
        pytest.skip("this chain already builds finance_attachments with the foreign key")
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO finance_attachments (file_name, file_size, mime_type, storage_ref, cheque_id) VALUES ('f', 1, 'x', 'ref', 777)")
        conn.commit()
    done = _alembic(url, "upgrade", "head", expect_ok=False)
    assert done.returncode != 0 and "finance_attachments.cheque_id" in done.stderr and "ON DELETE CASCADE" in done.stderr
    assert "0061_employee_archived" in _alembic(url, "current").stdout + _alembic(url, "current").stderr   # nothing half applied


def test_downgrade_drops_what_the_migration_added(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    _alembic(url, "downgrade", "0061_employee_archived")
    assert "ix_finance_ledger_transactions_payee_id" not in _indexes(path, "finance_ledger_transactions")
    _alembic(url, "upgrade", "head")
    assert "ix_finance_ledger_transactions_payee_id" in _indexes(path, "finance_ledger_transactions")
