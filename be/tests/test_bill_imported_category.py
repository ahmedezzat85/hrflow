"""
be/tests/test_bill_imported_category.py
Database redesign Stage 2b: a bill's category is `category_id`; free text that matches no category is kept in
`imported_category` only, and the API still returns `category`. Migration 0052 upgrades and downgrades cleanly.
"""
import os
import sqlite3
import subprocess
import sys

from db import get_db_context
from finance.models import BillDB, TransactionCategoryDB

from bill_test_helpers import make_maker, make_vendor

BASE = "/api/finance/bills"
BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _row(bill_id):
    with get_db_context() as db:
        bill = db.query(BillDB).filter(BillDB.id == bill_id).first()
        return bill.category_id, bill.imported_category, bill.category


def _category_id(name):
    with get_db_context() as db:
        return db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name == name).first().id


def _draft(client, vendor_id, **extra):
    resp = client.post(BASE, json={"vendor_id": vendor_id, **extra}, cookies=make_maker())
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_model_has_no_category_column():
    cols = {c.name for c in BillDB.__table__.columns}
    assert "category" not in cols and "imported_category" in cols


def test_matching_text_sets_the_category_row_and_no_imported_text(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Cat Vendor A")
    bill = _draft(app_client, vid, category="operating expense")
    category_id, imported, shown = _row(bill["id"])
    assert category_id == _category_id("Operating Expense") and imported is None and shown == "Operating Expense"
    assert bill["category"] == "Operating Expense"


def test_unmatched_text_is_kept_as_imported_category(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Cat Vendor B")
    bill = _draft(app_client, vid, category="Made Up Category")
    assert _row(bill["id"]) == (None, "Made Up Category", "Made Up Category")
    assert bill["category"] == "Made Up Category"


def test_update_moves_between_text_and_category(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Cat Vendor C")
    bill = _draft(app_client, vid, category="Made Up Category")
    cat_id = _category_id("Operating Expense")
    resp = app_client.put(f"{BASE}/{bill['id']}", json={"category_id": cat_id}, cookies=make_maker())
    assert resp.status_code == 200, resp.text
    assert _row(bill["id"]) == (cat_id, None, "Operating Expense")
    resp = app_client.put(f"{BASE}/{bill['id']}", json={"category": "Another Odd One"}, cookies=make_maker())
    assert resp.status_code == 200, resp.text
    assert _row(bill["id"]) == (None, "Another Odd One", "Another Odd One")


def test_search_finds_a_bill_by_category_name_or_imported_text(app_client, admin_cookies):
    vid = make_vendor(app_client, admin_cookies, "Cat Vendor D")
    matched = _draft(app_client, vid, category="Operating Expense")
    odd = _draft(app_client, vid, category="Zzyzx Special")
    ids = lambda q: {b["id"] for b in app_client.get(f"{BASE}?search={q}", cookies=admin_cookies).json()}  # noqa: E731
    assert odd["id"] in ids("Zzyzx") and matched["id"] not in ids("Zzyzx")
    assert matched["id"] in ids("Operating")


# --- migration 0052 ---------------------------------------------------------------------------------------------

def _alembic(url, *args):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-1500:]


def _cols(path, table):
    with sqlite3.connect(path) as conn:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_migration_0052_matches_text_keeps_the_rest_and_downgrade_refills(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0051_finance_duplicate_columns")
    with sqlite3.connect(path) as conn:
        # Migration 0013 builds missing tables from the current models, so a fresh chain never had the text column.
        if "category" not in _cols(path, "finance_bills"):
            conn.execute("ALTER TABLE finance_bills ADD COLUMN category VARCHAR(100)")
        conn.execute("INSERT OR IGNORE INTO finance_transaction_categories (name, kind, is_active, sort_order, is_petty) "
                     "VALUES ('Operating Expense', 'cost', 1, 0, 0)")
        cat = conn.execute("SELECT id FROM finance_transaction_categories WHERE name = 'Operating Expense'").fetchone()[0]
        rows = [
            (1, "matches by name", "operating expense", None),
            (2, "unmatched text", "Weird Label", None),
            (3, "category wins", "Weird Label", cat),
            (4, "no text", "", None),
        ]
        for bill_id, number, text, cat_id in rows:
            conn.execute("INSERT INTO finance_bills (id, bill_number, category, category_id, status, currency, "
                         "is_reviewed, is_duplicate_override, requires_approval, capture_source, vendor_to_confirm) "
                         "VALUES (?, ?, ?, ?, 'draft', 'USD', 1, 0, 0, 'manual', 0)", (bill_id, number, text, cat_id))
        conn.commit()

    _alembic(url, "upgrade", "head")
    assert "category" not in _cols(path, "finance_bills") and "imported_category" in _cols(path, "finance_bills")
    with sqlite3.connect(path) as conn:
        got = conn.execute("SELECT id, category_id, imported_category FROM finance_bills ORDER BY id").fetchall()
    assert got == [(1, cat, None), (2, None, "Weird Label"), (3, cat, None), (4, None, None)]

    _alembic(url, "downgrade", "0051_finance_duplicate_columns")
    with sqlite3.connect(path) as conn:
        got = conn.execute("SELECT id, category FROM finance_bills ORDER BY id").fetchall()
    assert got == [(1, "Operating Expense"), (2, "Weird Label"), (3, "Operating Expense"), (4, "Operating Expense")]
