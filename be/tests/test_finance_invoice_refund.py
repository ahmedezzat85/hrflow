"""
be/tests/test_finance_invoice_refund.py
INV-REFUND-1: a customer receipt is reversed as of the day the money went back, labelled refund or correction.
Slice 1 drives the service directly (the API parameters come in Slice 2): the reversing ledger row carries the chosen
date, the closed-month lock applies, every refusal writes nothing, and the old default behaviour is unchanged.
"""
import importlib.util
import os
from datetime import datetime, timedelta

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException

from db import get_db_context
from finance import cash_basis, year_openings
from finance.models import (
    BankStatementImportDB, FinanceBankAccountDB, LedgerTransactionDB, PaymentDB, SalesInvoiceDB,
)
from finance.repositories.invoices_repository import InvoicesRepository
from finance.services.invoices_service import InvoicesService
from invoice_test_helpers import BASE, create_invoice, make_account, make_customer, receipt
from repositories.sql.audit import SqlAuditRepository

RECEIPT_DATE = "2025-01-22"
REFUND_DATE = "2025-05-13"


def _today():
    return datetime.utcnow().strftime("%Y-%m-%d")


def _receipt(client, cookies, acc, amount=11168.0, date=RECEIPT_DATE, number=None, cust=None, **extra):
    inv = create_invoice(client, cookies, cust or make_customer(client, cookies), number=number, amount=amount,
                         issue_date="2025-01-10", due_date="2025-02-10", send=True)
    resp = receipt(client, cookies, inv["id"], acc, amount, reference=f"R-{inv['id']}", date=date, **extra)
    assert resp.status_code == 201, resp.text
    return inv, resp.json()["id"]


def _reverse(invoice_id, payment_id, reason="Customer refund", **kw):
    """The service as the router builds it (with the audit repository); returns the response, raises HTTPException."""
    with get_db_context() as db:
        return InvoicesService(InvoicesRepository(db), audit=SqlAuditRepository()).reverse_payment(
            invoice_id, payment_id, reason=reason, actor="tester@hrflow.test", **kw)


def _ledger(account_id):
    with get_db_context() as db:
        rows = (db.query(LedgerTransactionDB).filter(LedgerTransactionDB.account_id == account_id)
                .order_by(LedgerTransactionDB.date, LedgerTransactionDB.id).all())
        return [dict(id=r.id, date=r.date, amount=r.amount, direction=r.direction, source=r.source,
                     running=r.running_balance, description=r.description, reference=r.reference,
                     category=r.category_id, linked_invoice_id=r.linked_invoice_id) for r in rows]


def _payment(payment_id):
    with get_db_context() as db:
        p = db.query(PaymentDB).filter(PaymentDB.id == payment_id).one()
        return dict(is_reversed=p.is_reversed, reversal_date=p.reversal_date, reversal_kind=p.reversal_kind,
                    reversal_reason=p.reversal_reason, reversed_at=p.reversed_at, reversed_by=p.reversed_by)


def _status(invoice_id):
    with get_db_context() as db:
        return db.query(SalesInvoiceDB).filter(SalesInvoiceDB.id == invoice_id).one().status


def _balance_as_of(account_id, as_of):
    with get_db_context() as db:
        return year_openings.balance_as_of(db, db.query(FinanceBankAccountDB).get(account_id), as_of)


def _current(account_id):
    with get_db_context() as db:
        return db.query(FinanceBankAccountDB).get(account_id).current_balance


def _close_month(account_id, month):
    with get_db_context() as db:
        db.add(BankStatementImportDB(account_id=account_id, period_month=month, status="closed", file_type="csv", uploaded_file_ref="x"))


# --- the real case ------------------------------------------------------------------------------------------------

def test_refund_is_posted_on_its_own_date_and_the_invoice_can_then_be_voided(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=100000.0)
    inv, pid = _receipt(app_client, admin_cookies, acc)

    resp = _reverse(inv["id"], pid, reversal_date=REFUND_DATE, reversal_kind="refund")
    assert resp.is_reversed is True

    rows = _ledger(acc)
    assert [(r["date"], r["source"], r["direction"], r["amount"]) for r in rows] == [
        (RECEIPT_DATE, "invoice_payment", "in", 11168.0),
        (REFUND_DATE, "payment_reversal", "out", 11168.0),
    ]
    assert rows[1]["description"] == f"Refund of payment #{pid}: Customer refund"
    assert rows[1]["reference"] == f"REV-R-{inv['id']}"
    pay = _payment(pid)
    assert (pay["is_reversed"], pay["reversal_date"], pay["reversal_kind"], pay["reversal_reason"]) == (True, REFUND_DATE, "refund", "Customer refund")
    assert pay["reversed_at"] is not None and pay["reversed_by"] == "tester@hrflow.test"   # the action timestamp is kept apart from the accounting date
    assert _status(inv["id"]) == "sent"

    # month-end balances: the receipt counts until the refund month, then the pair nets to zero
    assert _balance_as_of(acc, "2025-04-30") == 111168.0
    assert _balance_as_of(acc, "2025-05-31") == 100000.0
    assert _current(acc) == 100000.0 == sum(r["amount"] if r["direction"] == "in" else -r["amount"] for r in rows) + 100000.0
    assert [r["running"] for r in rows] == [111168.0, 100000.0]

    # the invoice can now be voided with the existing action
    with get_db_context() as db:
        voided = InvoicesService(InvoicesRepository(db)).void_invoice(inv["id"], reason="Refunded to customer", actor="tester@hrflow.test")
    assert voided.status == "void"


def test_back_dated_row_lands_in_date_order_between_other_rows(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=1000.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=500.0, date="2025-01-22")
    other, _ = _receipt(app_client, admin_cookies, acc, amount=300.0, date="2025-06-10")   # a later row already exists
    _reverse(inv["id"], pid, reversal_date="2025-03-01", reversal_kind="refund")

    rows = _ledger(acc)
    assert [r["date"] for r in rows] == ["2025-01-22", "2025-03-01", "2025-06-10"]
    assert [r["running"] for r in rows] == [1500.0, 1000.0, 1300.0]
    assert _current(acc) == 1300.0


# --- defaults unchanged ----------------------------------------------------------------------------------------------

def test_without_the_new_inputs_the_reversal_is_dated_today_as_a_correction(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=700.0, date="2025-02-02")
    _reverse(inv["id"], pid, reason="Entered twice")

    rev = _ledger(acc)[-1]
    assert (rev["date"], rev["source"], rev["direction"], rev["amount"]) == (_today(), "payment_reversal", "out", 700.0)
    assert rev["description"] == f"Reversal of payment #{pid}: Entered twice"   # the wording used before INV-REFUND-1
    pay = _payment(pid)
    assert (pay["reversal_date"], pay["reversal_kind"]) == (_today(), "correction")
    assert _current(acc) == 0.0


def test_reversal_without_a_reason_has_no_suffix(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=50.0, date="2025-02-02")
    _reverse(inv["id"], pid, reason=None, reversal_kind="refund")
    assert _ledger(acc)[-1]["description"] == f"Refund of payment #{pid}"


# --- refusals write nothing ------------------------------------------------------------------------------------------

@pytest.mark.parametrize("kwargs,status,code", [
    ({"reversal_date": "2025-5-13"}, 400, "reversal_date_invalid"),
    ({"reversal_date": "13/05/2025"}, 400, "reversal_date_invalid"),
    ({"reversal_date": "2025-02-30"}, 400, "reversal_date_invalid"),
    ({"reversal_date": ""}, 400, "reversal_date_invalid"),
    ({"reversal_date": (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")}, 400, "reversal_date_future"),
    ({"reversal_date": "2025-01-21"}, 400, "reversal_date_before_receipt"),
    ({"reversal_date": REFUND_DATE, "reversal_kind": "chargeback"}, 400, "reversal_kind_invalid"),
    ({"reversal_kind": "Refund"}, 400, "reversal_kind_invalid"),
])
def test_invalid_input_is_refused_and_nothing_is_written(app_client, admin_cookies, kwargs, status, code):
    acc = make_account(app_client, admin_cookies, balance=100.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=400.0)
    before = _ledger(acc)

    with pytest.raises(HTTPException) as exc:
        _reverse(inv["id"], pid, **kwargs)
    assert exc.value.status_code == status and exc.value.detail["code"] == code

    assert _ledger(acc) == before and _current(acc) == 500.0
    pay = _payment(pid)
    assert (pay["is_reversed"], pay["reversal_date"], pay["reversal_kind"], pay["reversed_at"]) == (False, None, None, None)
    assert _status(inv["id"]) == "paid"


def test_receipt_date_itself_is_allowed_and_today_is_allowed(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=10.0, date="2025-04-04", number="EDGE-1")
    _reverse(inv["id"], pid, reversal_date="2025-04-04", reversal_kind="correction")   # same day as the receipt
    assert _ledger(acc)[-1]["date"] == "2025-04-04"
    inv2, pid2 = _receipt(app_client, admin_cookies, acc, amount=10.0, date="2025-04-05", number="EDGE-2")
    _reverse(inv2["id"], pid2, reversal_date=_today(), reversal_kind="refund")
    assert _ledger(acc)[-1]["date"] == _today()


def test_closed_reconciliation_month_refuses_the_reversal(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=900.0)
    _close_month(acc, "2025-05")
    before = _ledger(acc)

    with pytest.raises(HTTPException) as exc:
        _reverse(inv["id"], pid, reversal_date=REFUND_DATE, reversal_kind="refund")
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "period_closed"
    assert "2025-05" in exc.value.detail["message"]
    assert _ledger(acc) == before and _payment(pid)["is_reversed"] is False and _status(inv["id"]) == "paid"

    # another month of the same account is still open
    _reverse(inv["id"], pid, reversal_date="2025-06-02", reversal_kind="refund")
    assert _payment(pid)["is_reversed"] is True


def test_closed_month_also_refuses_a_default_today_reversal(app_client, admin_cookies):
    """Q-028 c (PROPOSED DEFAULT): before INV-REFUND-1 the default-today reversal bypassed the lock."""
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=60.0)
    _close_month(acc, _today()[:7])
    with pytest.raises(HTTPException) as exc:
        _reverse(inv["id"], pid)
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "period_closed"
    assert _payment(pid)["is_reversed"] is False


def test_closed_month_of_another_account_does_not_block(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    other = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=60.0)
    _close_month(other, "2025-05")
    _reverse(inv["id"], pid, reversal_date=REFUND_DATE, reversal_kind="refund")
    assert _payment(pid)["is_reversed"] is True


def test_already_reversed_payment_is_still_refused(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=80.0)
    _reverse(inv["id"], pid, reversal_date=REFUND_DATE, reversal_kind="refund")
    rows = _ledger(acc)
    with pytest.raises(HTTPException) as exc:
        _reverse(inv["id"], pid, reversal_date="2025-06-01", reversal_kind="refund")
    assert exc.value.status_code == 400 and "already been reversed" in exc.value.detail
    assert _ledger(acc) == rows and _payment(pid)["reversal_date"] == REFUND_DATE


def test_unknown_payment_is_404_and_receipt_must_belong_to_the_invoice(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=80.0)
    other = create_invoice(app_client, admin_cookies, make_customer(app_client, admin_cookies), send=True)
    for iid, p in ((inv["id"], 999999), (other["id"], pid)):
        with pytest.raises(HTTPException) as exc:
            _reverse(iid, p, reversal_date=REFUND_DATE, reversal_kind="refund")
        assert exc.value.status_code == 404


# --- commissions, withholding, partial receipts ---------------------------------------------------------------------------

def _commission_customer(client, cookies, name):
    sp = client.post("/api/finance/salespeople", json={"name": f"{name} Rep"}, cookies=cookies).json()
    cust = client.post("/api/finance/customers", json={"name": name, "salesperson_id": sp["id"], "commission_rate": 5}, cookies=cookies).json()
    return sp, cust


def test_refund_voids_the_accrued_commission(app_client, admin_cookies):
    sp, cust = _commission_customer(app_client, admin_cookies, "Refund Comm Co")
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=1000.0, cust=cust["id"], date="2025-02-10")
    accrued = app_client.get("/api/finance/commissions", params={"status": "accrued", "salesperson_id": sp["id"]}, cookies=admin_cookies).json()
    assert len(accrued) == 1

    _reverse(inv["id"], pid, reversal_date="2025-03-03", reversal_kind="refund")
    assert app_client.get("/api/finance/commissions", params={"status": "accrued", "salesperson_id": sp["id"]}, cookies=admin_cookies).json() == []
    voided = app_client.get("/api/finance/commissions", params={"status": "void", "salesperson_id": sp["id"]}, cookies=admin_cookies).json()
    assert len(voided) == 1 and "reversed" in voided[0]["void_reason"]


def test_settled_commission_blocks_a_dated_refund_and_nothing_is_written(app_client, admin_cookies):
    emp_id = app_client.get("/api/employees", cookies=admin_cookies).json()[0]["id"]
    sp = app_client.post("/api/finance/salespeople", json={"name": "Settled Rep", "employee_id": emp_id}, cookies=admin_cookies).json()
    cust = app_client.post("/api/finance/customers", json={"name": "Settled Co", "salesperson_id": sp["id"], "commission_rate": 5}, cookies=admin_cookies).json()
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=1000.0, cust=cust["id"], date="2025-02-10")
    st = app_client.post("/api/finance/commissions/settlements", cookies=admin_cookies, json={
        "salesperson_id": sp["id"], "period_start": "2025-02-01", "period_end": "2025-02-28", "settled_date": "2025-03-05"})
    assert st.status_code == 201, st.text
    before = _ledger(acc)

    with pytest.raises(HTTPException) as exc:
        _reverse(inv["id"], pid, reversal_date="2025-03-10", reversal_kind="refund")
    assert exc.value.status_code == 400 and "settled" in exc.value.detail
    assert _ledger(acc) == before and _payment(pid)["is_reversed"] is False


def test_withheld_part_of_a_receipt_posts_no_ledger_row_when_reversed(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    cust = app_client.post("/api/finance/customers", json={"name": "WHT Refund Co", "withholding_tax_rate": 10}, cookies=admin_cookies).json()
    inv = create_invoice(app_client, admin_cookies, cust["id"], amount=1000.0,
                         issue_date="2025-01-10", due_date="2025-02-10", send=True)
    resp = receipt(app_client, admin_cookies, inv["id"], acc, 900.0, reference="W-1", date=RECEIPT_DATE, withheld_amount=100.0)
    assert resp.status_code == 201, resp.text
    assert _status(inv["id"]) == "paid"

    _reverse(inv["id"], resp.json()["id"], reversal_date=REFUND_DATE, reversal_kind="refund")
    rows = _ledger(acc)
    assert [(r["source"], r["amount"]) for r in rows] == [("invoice_payment", 900.0), ("payment_reversal", 900.0)]   # cash only, nothing for the 100 withheld
    assert _status(inv["id"]) == "sent" and _current(acc) == 0.0


def test_reversing_one_of_two_receipts_leaves_the_other_and_the_invoice_partially_paid(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv = create_invoice(app_client, admin_cookies, make_customer(app_client, admin_cookies), amount=1000.0,
                         issue_date="2025-01-10", due_date="2025-02-10", send=True)
    first = receipt(app_client, admin_cookies, inv["id"], acc, 400.0, reference="P-1", date="2025-01-22").json()["id"]
    second = receipt(app_client, admin_cookies, inv["id"], acc, 600.0, reference="P-2", date="2025-02-05").json()["id"]
    assert _status(inv["id"]) == "paid"

    _reverse(inv["id"], first, reversal_date="2025-04-01", reversal_kind="refund")
    assert _status(inv["id"]) == "partially_paid"
    assert _payment(second)["is_reversed"] is False and _payment(second)["reversal_date"] is None
    assert _balance_as_of(acc, "2025-03-31") == 1000.0 and _balance_as_of(acc, "2025-04-30") == 600.0


# --- reports and neighbours ---------------------------------------------------------------------------------------------------

def _revenue_by_month(account_id):
    out = {}
    with get_db_context() as db:
        for tx in db.query(LedgerTransactionDB).filter(LedgerTransactionDB.account_id == account_id).all():
            cls = cash_basis.classify(tx, "revenue", has_category=True)
            if cls and cls[0] == cash_basis.REVENUE:
                out[tx.date[:7]] = out.get(tx.date[:7], 0.0) + cls[1]
    return out


def test_cash_basis_revenue_shows_the_receipt_in_january_and_the_refund_in_may(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=11168.0)
    _reverse(inv["id"], pid, reversal_date=REFUND_DATE, reversal_kind="refund")
    assert _revenue_by_month(acc) == {"2025-01": 11168.0, "2025-05": -11168.0}   # February to April untouched


def test_intercompany_customer_reversal_row_is_classified_like_the_receipt(app_client, admin_cookies):
    cust = app_client.post("/api/finance/customers", json={"name": "Overseas Refund Inc", "is_intercompany": True}, cookies=admin_cookies).json()
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=250.0, cust=cust["id"])
    _reverse(inv["id"], pid, reversal_date=REFUND_DATE, reversal_kind="refund")
    with get_db_context() as db:
        txs = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.account_id == acc).order_by(LedgerTransactionDB.id).all()
        assert [cash_basis._is_intercompany_receipt(t) for t in txs] == [True, True]
        assert [t.source for t in txs] == ["invoice_payment", "payment_reversal"]


def test_back_dated_reversal_in_a_closed_fiscal_year_shows_as_an_opening_variance_next_year(app_client, admin_cookies):
    """BI-1: the reversal changes 2025's closing balance, so an opening already entered for 2026 now differs from it.
    That is the expected warning (variance = opening - previous closing), not an error."""
    acc = make_account(app_client, admin_cookies, balance=1000.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=400.0)            # 2025 closing = 1400
    assert app_client.put(f"/api/finance/accounts/{acc}/year-openings/2026", json={"opening_balance": 1400.0}, cookies=admin_cookies).status_code == 200
    with get_db_context() as db:
        assert year_openings.year_opening_info(db, db.query(FinanceBankAccountDB).get(acc), 2026)["variance"] == 0.0

    _reverse(inv["id"], pid, reversal_date="2025-12-01", reversal_kind="refund")      # 2025 closing = 1000
    with get_db_context() as db:
        info = year_openings.year_opening_info(db, db.query(FinanceBankAccountDB).get(acc), 2026)
    assert (info["previous_closing"], info["opening"], info["variance"]) == (1000.0, 1400.0, 400.0)
    assert _current(acc) == 1400.0   # the entered 2026 opening stands; 2026 rows would carry on from it


# --- the activity entry ---------------------------------------------------------------------------------------------------------

def test_one_activity_entry_is_written_for_the_reversal(app_client, admin_cookies):
    from models_db import AuditLogDB
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=120.0)
    _reverse(inv["id"], pid, reason="Customer asked", reversal_date=REFUND_DATE, reversal_kind="refund")
    with get_db_context() as db:
        entries = [(e.actor_email, e.details) for e in db.query(AuditLogDB).filter(
            AuditLogDB.action == "invoice.payment_reversed", AuditLogDB.target_id == str(inv["id"])).all()]
    assert len(entries) == 1 and entries[0][0] == "tester@hrflow.test"
    rev_id = _ledger(acc)[-1]["id"]
    for part in (f"payment #{pid}", "kind: refund", f"reversal_date: {REFUND_DATE}", f"ledger row #{rev_id}", "reason: Customer asked"):
        assert part in entries[0][1], entries[0][1]


def test_a_refused_reversal_writes_no_activity_entry(app_client, admin_cookies):
    from models_db import AuditLogDB
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=120.0)
    with pytest.raises(HTTPException):
        _reverse(inv["id"], pid, reversal_date="2024-01-01", reversal_kind="refund")
    with get_db_context() as db:
        assert db.query(AuditLogDB).filter(AuditLogDB.action == "invoice.payment_reversed", AuditLogDB.target_id == str(inv["id"])).count() == 0


# --- migration ----------------------------------------------------------------------------------------------------------------

def _load_migration():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations", "versions", "0080_payment_reversal_date_kind.py")
    spec = importlib.util.spec_from_file_location("mig_0080", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _legacy_engine(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text(
            "CREATE TABLE finance_payments (id INTEGER PRIMARY KEY, direction VARCHAR(20) NOT NULL, amount FLOAT, "
            "is_reversed BOOLEAN NOT NULL DEFAULT 0, reversed_at DATETIME, reversal_reason TEXT)"))
        conn.execute(sa.text("INSERT INTO finance_payments (id, direction, amount, is_reversed, reversed_at, reversal_reason) VALUES "
                             "(1, 'incoming', 10, 1, '2025-05-13 09:30:00.123456', 'old'), "
                             "(2, 'incoming', 20, 0, NULL, NULL), "
                             "(3, 'incoming', 30, 1, NULL, NULL)"))
    return engine


def _run(engine, fn):
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            fn()


def test_migration_backfills_reversed_payments_and_downgrades(tmp_path):
    mig = _load_migration()
    engine = _legacy_engine(tmp_path)
    _run(engine, mig.upgrade)
    with engine.connect() as conn:
        rows = conn.execute(sa.text("SELECT id, reversal_date, reversal_kind FROM finance_payments ORDER BY id")).fetchall()
        assert [tuple(r) for r in rows] == [(1, "2025-05-13", "correction"), (2, None, None), (3, None, "correction")]
        with pytest.raises(Exception):
            with conn.begin():
                conn.execute(sa.text("UPDATE finance_payments SET reversal_kind = 'chargeback' WHERE id = 1"))
        with pytest.raises(Exception):
            with conn.begin():
                conn.execute(sa.text("UPDATE finance_payments SET reversal_date = '13/05/2025' WHERE id = 1"))
    _run(engine, mig.upgrade)   # running it again changes nothing and does not fail
    _run(engine, mig.downgrade)
    cols = {c["name"] for c in sa.inspect(engine).get_columns("finance_payments")}
    assert "reversal_date" not in cols and "reversal_kind" not in cols and {"id", "amount", "reversal_reason"} <= cols
    assert sa.inspect(engine).get_check_constraints("finance_payments") == []


# --- API (slice 2) ------------------------------------------------------------------------------------------------------------

def _post_reverse(client, cookies, invoice_id, payment_id, **params):
    return client.post(f"{BASE}/{invoice_id}/payments/{payment_id}/reverse", params=params, cookies=cookies)


def test_api_dated_refund_returns_the_new_fields(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=100000.0)
    inv, pid = _receipt(app_client, admin_cookies, acc)
    resp = _post_reverse(app_client, admin_cookies, inv["id"], pid, reason="Refunded", reversal_date=REFUND_DATE, kind="refund")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["is_reversed"], body["reversal_date"], body["reversal_kind"], body["reversal_reason"]) == (True, REFUND_DATE, "refund", "Refunded")
    assert [r["date"] for r in _ledger(acc)] == [RECEIPT_DATE, REFUND_DATE]
    listed = app_client.get(f"{BASE}/{inv['id']}/payments", cookies=admin_cookies).json()
    assert (listed[0]["reversal_date"], listed[0]["reversal_kind"]) == (REFUND_DATE, "refund")


def test_api_old_call_is_unchanged(app_client, admin_cookies):
    """Golden: the call with only `reason` behaves as before INV-REFUND-1 (dated today, same wording, same fields)."""
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=300.0, date="2025-02-02")
    resp = app_client.post(f"{BASE}/{inv['id']}/payments/{pid}/reverse?reason=bounced", cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_reversed"] is True and body["reversal_reason"] == "bounced" and body["reversed_at"]
    assert body["amount"] == 300.0 and body["payment_date"] == "2025-02-02" and body["direction"] == "incoming"
    assert (body["reversal_date"], body["reversal_kind"]) == (_today(), "correction")
    rev = _ledger(acc)[-1]
    assert (rev["date"], rev["description"], rev["source"]) == (_today(), f"Reversal of payment #{pid}: bounced", "payment_reversal")
    assert app_client.get(f"{BASE}/{inv['id']}", cookies=admin_cookies).json()["status"] == "sent"


@pytest.mark.parametrize("params,status,code", [
    ({"reversal_date": "13-05-2025"}, 400, "reversal_date_invalid"),
    ({"reversal_date": (datetime.utcnow() + timedelta(days=2)).strftime("%Y-%m-%d")}, 400, "reversal_date_future"),
    ({"reversal_date": "2025-01-01"}, 400, "reversal_date_before_receipt"),
    ({"kind": "gift"}, 400, "reversal_kind_invalid"),
])
def test_api_refusals_carry_their_code_and_write_nothing(app_client, admin_cookies, params, status, code):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=75.0)
    resp = _post_reverse(app_client, admin_cookies, inv["id"], pid, **params)
    assert resp.status_code == status and resp.json()["detail"]["code"] == code
    assert len(_ledger(acc)) == 1 and _payment(pid)["is_reversed"] is False


def test_api_closed_month_is_409(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=75.0)
    _close_month(acc, "2025-05")
    resp = _post_reverse(app_client, admin_cookies, inv["id"], pid, reversal_date=REFUND_DATE, kind="refund")
    assert resp.status_code == 409 and resp.json()["detail"]["code"] == "period_closed"
    assert len(_ledger(acc)) == 1


def test_api_permission_and_unknown_ids(app_client, admin_cookies, employee_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=75.0)
    assert _post_reverse(app_client, employee_cookies, inv["id"], pid, reversal_date=REFUND_DATE, kind="refund").status_code == 403
    assert _payment(pid)["is_reversed"] is False
    assert _post_reverse(app_client, admin_cookies, 999999, pid, kind="refund").status_code == 404
    assert _post_reverse(app_client, admin_cookies, inv["id"], 999999, kind="refund").status_code == 404


def test_bill_payment_responses_carry_null_reversal_fields(app_client, admin_cookies):
    from finance.schemas import PaymentResponse
    assert PaymentResponse.model_fields["reversal_date"].default is None and PaymentResponse.model_fields["reversal_kind"].default is None


def test_mcp_lists_a_back_dated_reversal_on_its_own_date(app_client, admin_cookies):
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "mcp_server"))
    import finance_tools
    from test_finance_mcp_read import _mcp_client, _secret
    acc = make_account(app_client, admin_cookies, balance=0.0, name="Refund MCP Account")
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=11168.0)
    assert _post_reverse(app_client, admin_cookies, inv["id"], pid, reversal_date=REFUND_DATE, kind="refund").status_code == 200

    client = _mcp_client(app_client, _secret())
    jan = finance_tools.finance_list_transactions(client, "Refund MCP Account", "2025-01-01", "2025-01-31")
    may = finance_tools.finance_list_transactions(client, "Refund MCP Account", "2025-05-01", "2025-05-31")
    assert [t["source"] for t in jan["transactions"]] == ["invoice_payment"] and jan["total_in"] == 11168.0
    assert [(t["date"], t["source"]) for t in may["transactions"]] == [(REFUND_DATE, "payment_reversal")] and may["total_out"] == 11168.0


def test_invoice_drawer_lists_receipts_with_their_reversal(app_client, admin_cookies):
    """The drawer the UI reads: a live receipt is plain, a refunded one carries its date, kind and reason."""
    acc = make_account(app_client, admin_cookies, balance=0.0)
    inv, pid = _receipt(app_client, admin_cookies, acc, amount=200.0)
    live = app_client.get(f"/api/finance/activity/invoice/{inv['id']}", cookies=admin_cookies).json()
    rec = next(r for r in live["related_records"] if r["entity_type"] == "payment")
    assert (rec["is_reversed"], rec["reversal_date"], rec["badge"].startswith("Paid into")) == (False, None, True)

    assert _post_reverse(app_client, admin_cookies, inv["id"], pid, reason="Money returned", reversal_date=REFUND_DATE, kind="refund").status_code == 200
    out = app_client.get(f"/api/finance/activity/invoice/{inv['id']}", cookies=admin_cookies).json()
    rec = next(r for r in out["related_records"] if r["entity_type"] == "payment")
    assert rec["is_reversed"] is True and rec["badge"] == f"Refunded on {REFUND_DATE}"
    assert (rec["reversal_date"], rec["reversal_kind"], rec["reversal_reason"]) == (REFUND_DATE, "refund", "Money returned")
    assert "[REVERSED]" in rec["title"]
