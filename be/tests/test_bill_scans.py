"""
be/tests/test_bill_scans.py
Stage 6a: a bill's scan is a row of finance_attachments (bill_id); the bill keeps attachment_url / attachment_name as read-write
views of it. Migration 0068 moves the old columns into rows and back.
"""
import os
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

import models_db  # noqa: F401
from db import get_db_context
from finance.models import BillDB, FinanceAttachmentDB

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _new_bill(db, number):
    bill = BillDB(bill_number=number, status="draft", currency="USD", capture_source="manual")
    db.add(bill)
    db.flush()
    return bill


def test_the_bill_properties_read_and_write_the_scan_row(app_client):
    with get_db_context() as db:
        bill = _new_bill(db, "SCAN-1")
        assert bill.attachment_url is None and bill.attachment_name is None and bill.scan is None
        bill.attachment_name = "scan.pdf"          # an upload being processed: a name and no reference yet
        assert bill.attachment_url == "" and bill.scan.storage_ref == ""
        bill.attachment_url = "bills/2026/scan.pdf"
        db.commit()
        row = db.query(FinanceAttachmentDB).filter(FinanceAttachmentDB.bill_id == bill.id).one()
        assert (row.file_name, row.storage_ref) == ("scan.pdf", "bills/2026/scan.pdf")
        bill.attachment_name = None
        bill.attachment_url = None
        db.commit()
        assert db.query(FinanceAttachmentDB).filter(FinanceAttachmentDB.bill_id == bill.id).count() == 0


def test_a_bill_has_at_most_one_scan_and_the_scan_goes_with_the_bill(app_client):
    with get_db_context() as db:
        bill = _new_bill(db, "SCAN-2")
        bill.attachment_name, bill.attachment_url = "a.pdf", "a.pdf"
        db.commit()
        db.add(FinanceAttachmentDB(bill_id=bill.id, file_name="b.pdf", storage_ref="b.pdf"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        bill_id = bill.id
        db.delete(db.get(BillDB, bill_id))
        db.commit()
        assert db.query(FinanceAttachmentDB).filter(FinanceAttachmentDB.bill_id == bill_id).count() == 0


def test_migration_0068_moves_the_columns_into_rows_and_back(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    _alembic(url, "downgrade", "0067_date_checks")
    with sqlite3.connect(path) as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(finance_bills)")}
        assert {"attachment_url", "attachment_name"} <= cols
        conn.execute("INSERT INTO finance_bills (id, bill_number, status, currency, capture_source, is_reviewed, is_duplicate_override, "
                     "requires_approval, vendor_to_confirm, attachment_name, attachment_url) "
                     "VALUES (1, 'B-1', 'draft', 'USD', 'upload', 1, 0, 0, 0, 'invoice.pdf', 'bills/invoice.pdf')")
        conn.execute("INSERT INTO finance_bills (id, bill_number, status, currency, capture_source, is_reviewed, is_duplicate_override, "
                     "requires_approval, vendor_to_confirm, attachment_name, attachment_url) "
                     "VALUES (2, 'B-2', 'draft', 'USD', 'upload', 1, 0, 0, 0, 'pending.png', '')")
        conn.execute("INSERT INTO finance_bills (id, bill_number, status, currency, capture_source, is_reviewed, is_duplicate_override, "
                     "requires_approval, vendor_to_confirm) VALUES (3, 'B-3', 'draft', 'USD', 'manual', 1, 0, 0, 0)")
        conn.commit()
    _alembic(url, "upgrade", "head")
    with sqlite3.connect(path) as conn:
        assert not {"attachment_url", "attachment_name"} & {r[1] for r in conn.execute("PRAGMA table_info(finance_bills)")}
        rows = conn.execute("SELECT bill_id, file_name, storage_ref, mime_type FROM finance_attachments WHERE bill_id IS NOT NULL ORDER BY bill_id").fetchall()
        assert rows == [(1, "invoice.pdf", "bills/invoice.pdf", "application/pdf"), (2, "pending.png", "", "image/png")]
    _alembic(url, "downgrade", "0067_date_checks")
    with sqlite3.connect(path) as conn:
        got = conn.execute("SELECT id, attachment_name, attachment_url FROM finance_bills ORDER BY id").fetchall()
        assert got == [(1, "invoice.pdf", "bills/invoice.pdf"), (2, "pending.png", ""), (3, None, None)]
        assert conn.execute("SELECT COUNT(*) FROM finance_attachments WHERE bill_id IS NOT NULL").fetchone()[0] == 0 if \
            "bill_id" in {r[1] for r in conn.execute("PRAGMA table_info(finance_attachments)")} else True
    _alembic(url, "upgrade", "head")
