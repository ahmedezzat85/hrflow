"""
be/tests/test_money_columns_bills_invoices.py
Stage 5b-2: sales, purchase, payment and cheque money columns are exact NUMERIC (finance/money.py); migration 0064 converts them
and stops with a list when a value would be rounded.
"""
import os
import sqlite3
import subprocess
import sys

import pytest

from finance import models as fm

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXPECTED = {
    fm.SalesInvoiceDB: {"subtotal": (18, 4), "tax_amount": (18, 4), "total": (18, 4), "vat_rate": (18, 8), "withholding_tax_rate": (18, 8)},
    fm.SalesInvoiceLineDB: {"quantity": (18, 4), "unit_price": (18, 4), "line_total": (18, 4)},
    fm.BillDB: {"subtotal": (18, 4), "tax_amount": (18, 4), "total": (18, 4)},
    fm.BillLineDB: {"quantity": (18, 4), "unit_price": (18, 4), "line_total": (18, 4)},
    fm.PaymentDB: {"amount": (18, 4), "withheld_amount": (18, 4)},
    fm.FinanceChequeDB: {"amount": (18, 4)},
    fm.ProductDB: {"default_price": (18, 4)},
    fm.CustomerDB: {"withholding_tax_rate": (18, 8)},
    fm.VendorDB: {"withholding_tax_rate": (18, 8)},
}


def test_columns_use_the_money_types_and_hand_floats_to_the_application():
    for model, columns in EXPECTED.items():
        for name, spec in columns.items():
            col = model.__table__.c[name]
            assert (col.type.precision, col.type.scale, col.type.asdecimal) == (*spec, False), f"{model.__tablename__}.{name}"


def test_extraction_confidence_is_not_money():
    assert type(fm.BillDB.__table__.c.extraction_confidence.type).__name__ == "Float"


def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _decl(path, table, column):
    with sqlite3.connect(path) as conn:
        return next(r[2] for r in conn.execute(f"PRAGMA table_info({table})") if r[1] == column).upper()


def test_migration_0064_changes_the_declared_types_and_back(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    assert _decl(path, "finance_bills", "total") == "NUMERIC(18, 4)"
    assert _decl(path, "finance_sales_invoices", "vat_rate") == "NUMERIC(18, 8)"
    assert _decl(path, "finance_payments", "withheld_amount") == "NUMERIC(18, 4)"
    assert _decl(path, "finance_bills", "extraction_confidence") == "FLOAT"
    _alembic(url, "downgrade", "0063_money_ledger_accounts")
    assert _decl(path, "finance_bills", "total") == "FLOAT"
    assert _decl(path, "finance_cheques", "amount") == "FLOAT"
    _alembic(url, "upgrade", "head")


def test_migration_0064_stops_and_lists_values_that_would_be_rounded(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "0063_money_ledger_accounts")
    if _decl(path, "finance_bills", "total") != "FLOAT":
        pytest.skip("this chain already builds finance_bills.total as NUMERIC")
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO finance_vendors (id, name, onboarding_status, is_active) VALUES (1, 'V', 'active', 1)")
        for status, total in (("draft", 100.123456), ("draft", 50.5)):
            conn.execute("INSERT INTO finance_bills (vendor_id, status, currency, total, is_reviewed, is_duplicate_override, requires_approval, "
                         "capture_source, vendor_to_confirm) VALUES (1, ?, 'USD', ?, 1, 0, 0, 'manual', 0)", (status, total))
        conn.commit()
    done = _alembic(url, "upgrade", "head", expect_ok=False)
    assert done.returncode != 0 and "finance_bills.total: 1 value(s) have more than 4 decimals" in done.stderr
    assert _decl(path, "finance_bills", "total") == "FLOAT"
