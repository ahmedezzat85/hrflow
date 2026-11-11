"""
be/tests/test_insurance_claim_payment.py
Slice 1 of the insurance claim payment link (D-053, proposed): service level, no API. An approved claim dated 2026-01-01 or later is
paid from a company account, which posts one ledger row (source insurance_claim); the claim row and the ledger row commit together;
a reversal adds an opposite row (source insurance_claim_reversal) and the claim can be paid again.
"""
import os
import sqlite3
import subprocess
import sys

import pytest

from bill_test_helpers import make_account
from db import get_db_context
from finance.models import BankStatementImportDB, FinanceBankAccountDB, LedgerTransactionDB, PaymentTypeDB, TransactionCategoryDB
from finance import cash_basis
from finance.services import claim_payment_service
from models_db import InsuranceClaimDB, UserDB
from services import insurance_claim_payment as svc
from services.insurance_claim_payment import InsuranceClaimPaymentError

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMP_ID = 2


def _type_id(code="OUTBOUND_TRANS"):
    with get_db_context() as db:
        return db.query(PaymentTypeDB).filter(PaymentTypeDB.code == code).first().id


def _claim(amount=1500.0, date="2026-03-10", status="Approved", employee_id=EMP_ID):
    with get_db_context() as db:
        c = InsuranceClaimDB(employee_id=employee_id, employee_name="Employee 2", category="Dental", provider="Clinic",
                             amount=amount, date=date, status=status)
        db.add(c)
        db.commit()
        return c.id


def _admin_id():
    with get_db_context() as db:
        return db.query(UserDB).filter(UserDB.email == "admin@hrflow.test").first().id


def _account(client, cookies, name, number, balance=10000.0, currency="EGP"):
    return make_account(client, cookies, name, number=number, balance=balance, currency=currency)


def _balance(account_id):
    with get_db_context() as db:
        return db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == account_id).first().current_balance


def _rows(source=None):
    with get_db_context() as db:
        q = db.query(LedgerTransactionDB)
        if source:
            q = q.filter(LedgerTransactionDB.source == source)
        return [(r.id, r.account_id, r.direction, r.amount, r.currency, r.source, r.reference, r.reason, r.category_id, r.payee_type, r.payee_id)
                for r in q.order_by(LedgerTransactionDB.id).all()]


def _pay(claim_id, account_id, **kw):
    with get_db_context() as db:
        return svc.pay_claim(db, claim_id, account_id=account_id, payment_date=kw.pop("payment_date", "2026-05-01"),
                             payment_type_id=kw.pop("payment_type_id", None) or _type_id(), user_id=_admin_id(),
                             user_email="admin@hrflow.test", **kw)


def _claim_row(claim_id):
    with get_db_context() as db:
        c = db.query(InsuranceClaimDB).filter(InsuranceClaimDB.id == claim_id).first()
        return c.payment_status, c.ledger_transaction_id, c.payment_reversal_transaction_id, c.paid_at, c.paid_by_user_id


def _refused(code, status, fn):
    with pytest.raises(InsuranceClaimPaymentError) as err:
        fn()
    assert err.value.code == code and err.value.status_code == status, (err.value.code, err.value.status_code, err.value.message)


def test_happy_path_posts_one_outflow_and_marks_the_claim_paid(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP A", "CLM-0001")
    cid = _claim(1500.0)
    out = _pay(cid, acc, reference="CHQ-77")
    assert out["payment_status"] == "paid" and out["ledger_transaction_id"] and out["paid_at"]
    rows = _rows("insurance_claim")
    assert len(rows) == 1
    _id, account_id, direction, amount, currency, source, reference, _reason, category_id, payee_type, payee_id = rows[0]
    assert (account_id, direction, amount, currency, reference) == (acc, "out", 1500.0, "EGP", "CHQ-77")
    assert (payee_type, payee_id) == ("employee", EMP_ID)
    with get_db_context() as db:
        assert db.query(TransactionCategoryDB).filter(TransactionCategoryDB.id == category_id).first().name == "Medical Insurance"
    status, ledger_id, reversal_id, paid_at, paid_by = _claim_row(cid)
    assert (status, ledger_id, reversal_id, paid_by) == ("paid", rows[0][0], None, _admin_id()) and paid_at is not None


def test_default_reference_names_the_claim(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP B", "CLM-0002")
    cid = _claim()
    _pay(cid, acc)
    assert _rows("insurance_claim")[0][6] == f"CLAIM-{cid}"


def test_balance_math_payment_then_reversal(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP C", "CLM-0003", balance=10000.0)
    cid = _claim(2500.0)
    _pay(cid, acc)
    assert _balance(acc) == pytest.approx(7500.0)
    with get_db_context() as db:
        svc.reverse_claim_payment(db, cid, reason="Paid by mistake", reversal_date="2026-05-02", user_email="admin@hrflow.test")
    assert _balance(acc) == pytest.approx(10000.0)


def test_double_pay_is_refused_and_posts_one_row(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP D", "CLM-0004")
    cid = _claim()
    _pay(cid, acc)
    _refused("claim_already_paid", 409, lambda: _pay(cid, acc))
    assert len(_rows("insurance_claim")) == 1 and _balance(acc) == pytest.approx(10000.0 - 1500.0)


@pytest.mark.parametrize("status", ["Pending", "Rejected"])
def test_only_an_approved_claim_can_be_paid(app_client, admin_cookies, status):
    acc = _account(app_client, admin_cookies, f"Claims EGP E {status}", f"CLM-E-{status}")
    cid = _claim(status=status)
    _refused("claim_not_approved", 409, lambda: _pay(cid, acc))
    assert _rows("insurance_claim") == [] and _claim_row(cid)[0] == "unpaid"


def test_claims_before_2026_are_not_payable_and_the_start_day_is_inclusive(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP F", "CLM-0006")
    old = _claim(date="2025-12-31")
    _refused("claim_not_eligible", 409, lambda: _pay(old, acc))
    assert _claim_row(old)[0] == "unpaid" and _rows("insurance_claim") == []
    assert svc.CLAIM_PAYMENT_START_DATE == "2026-01-01"
    first = _claim(date="2026-01-01")
    assert _pay(first, acc)["payment_status"] == "paid"


def test_account_in_another_currency_is_refused(app_client, admin_cookies):
    usd = _account(app_client, admin_cookies, "Claims USD G", "CLM-0007", currency="USD")
    cid = _claim()
    _refused("currency_mismatch", 400, lambda: _pay(cid, usd))
    assert _rows("insurance_claim") == [] and _claim_row(cid)[0] == "unpaid"


def test_closed_reconciliation_period_is_refused_and_rolled_back(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP H", "CLM-0008")
    with get_db_context() as db:
        db.add(BankStatementImportDB(account_id=acc, period_month="2026-05", status="closed"))
        db.commit()
    cid = _claim()
    _refused("period_closed", 400, lambda: _pay(cid, acc, payment_date="2026-05-15"))
    assert _rows("insurance_claim") == [] and _claim_row(cid)[0] == "unpaid" and _balance(acc) == pytest.approx(10000.0)
    assert _pay(cid, acc, payment_date="2026-06-15")["payment_status"] == "paid"      # an open month still works


def test_payment_type_must_fit_the_account_type(app_client, admin_cookies):
    bank = _account(app_client, admin_cookies, "Claims EGP I", "CLM-0009")
    cid = _claim()
    for code in ("CASH", "CHK", "INBOUND_TRANS"):                    # cash on a bank account, cheque (not supported for claims), money in
        with get_db_context() as db:
            if db.query(PaymentTypeDB).filter(PaymentTypeDB.code == code).first() is None:
                continue
        _refused("payment_type_not_allowed", 400, lambda c=code: _pay(cid, bank, payment_type_id=_type_id(c)))
    assert _rows("insurance_claim") == [] and _claim_row(cid)[0] == "unpaid"
    assert _pay(cid, bank, payment_type_id=_type_id("DEBIT_CARD"))["payment_status"] == "paid"


def test_missing_category_fails_with_a_clear_error(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP J", "CLM-0010")
    cid = _claim()
    with get_db_context() as db:
        cat = db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name == "Medical Insurance").first()
        cat.name = "Medical Insurance (renamed)"
        db.commit()
    _refused("category_missing", 409, lambda: _pay(cid, acc))
    assert _rows("insurance_claim") == [] and _claim_row(cid)[0] == "unpaid"


def test_unknown_claim_and_unknown_account(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP K", "CLM-0011")
    _refused("claim_not_found", 404, lambda: _pay(999999, acc))
    cid = _claim()
    _refused("account_not_found", 404, lambda: _pay(cid, 999999))


def test_failure_after_the_ledger_row_rolls_the_row_back(app_client, admin_cookies, monkeypatch):
    acc = _account(app_client, admin_cookies, "Claims EGP L", "CLM-0012")
    cid = _claim()
    seen = {}
    real = claim_payment_service.ClaimPaymentPosting.post_payment

    def posted_then_boom(self, **kw):
        seen["ledger_id"] = real(self, **kw)
        raise RuntimeError("boom after the ledger row was added")

    monkeypatch.setattr(claim_payment_service.ClaimPaymentPosting, "post_payment", posted_then_boom)
    with get_db_context() as db:
        with pytest.raises(RuntimeError):
            svc.pay_claim(db, cid, account_id=acc, payment_date="2026-05-01", payment_type_id=_type_id(), user_id=_admin_id())
    assert seen["ledger_id"]
    assert _rows("insurance_claim") == [] and _claim_row(cid)[0] == "unpaid"
    assert _balance(acc) == pytest.approx(10000.0)


def test_failure_while_saving_the_claim_rolls_the_ledger_row_back(app_client, admin_cookies, monkeypatch):
    acc = _account(app_client, admin_cookies, "Claims EGP M", "CLM-0013")
    cid = _claim()
    with get_db_context() as db:
        real_commit, calls = db.commit, []

        def commit_fails_once():
            if not calls:
                calls.append(1)
                raise RuntimeError("commit failed")
            real_commit()

        monkeypatch.setattr(db, "commit", commit_fails_once)
        with pytest.raises(RuntimeError):
            svc.pay_claim(db, cid, account_id=acc, payment_date="2026-05-01", payment_type_id=_type_id(), user_id=_admin_id())
    assert _rows("insurance_claim") == [] and _claim_row(cid)[0] == "unpaid" and _balance(acc) == pytest.approx(10000.0)


def test_ledger_row_cannot_back_two_claims(app_client, admin_cookies):
    from sqlalchemy.exc import IntegrityError
    acc = _account(app_client, admin_cookies, "Claims EGP N", "CLM-0014")
    first, second = _claim(), _claim()
    ledger_id = _pay(first, acc)["ledger_transaction_id"]
    with get_db_context() as db:
        db.query(InsuranceClaimDB).filter(InsuranceClaimDB.id == second).first().ledger_transaction_id = ledger_id
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()


def test_reversal_adds_an_opposite_row_and_keeps_the_original(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP O", "CLM-0015")
    cid = _claim(800.0)
    original_id = _pay(cid, acc)["ledger_transaction_id"]
    with get_db_context() as db:
        out = svc.reverse_claim_payment(db, cid, reason="  Wrong account  ", reversal_date="2026-05-03", user_email="admin@hrflow.test")
    assert out["payment_status"] == "reversed" and out["ledger_transaction_id"] == original_id
    reversal = _rows("insurance_claim_reversal")
    assert len(reversal) == 1 and out["payment_reversal_transaction_id"] == reversal[0][0]
    _id, account_id, direction, amount, currency, _src, reference, reason, _cat, _pt, _pid = reversal[0]
    assert (account_id, direction, amount, currency, reference, reason) == (acc, "in", 800.0, "EGP", f"REV-TX-{original_id}", "Wrong account")
    assert len(_rows("insurance_claim")) == 1                                  # the original is never deleted
    assert _claim_row(cid)[0] == "reversed"


def test_reversal_needs_a_reason_a_paid_claim_and_an_open_period(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP P", "CLM-0016")
    cid = _claim()
    with get_db_context() as db:
        _refused("claim_not_paid", 409, lambda: svc.reverse_claim_payment(db, cid, reason="x"))
    _pay(cid, acc)
    for blank in ("", "   "):
        with get_db_context() as db:
            _refused("reason_required", 400, lambda b=blank: svc.reverse_claim_payment(db, cid, reason=b))
    with get_db_context() as db:
        db.add(BankStatementImportDB(account_id=acc, period_month="2026-07", status="closed"))
        db.commit()
    with get_db_context() as db:
        _refused("period_closed", 400, lambda: svc.reverse_claim_payment(db, cid, reason="late", reversal_date="2026-07-20"))
    assert _claim_row(cid)[0] == "paid" and _rows("insurance_claim_reversal") == []
    with get_db_context() as db:
        svc.reverse_claim_payment(db, cid, reason="ok", reversal_date="2026-08-01")
        _refused("claim_not_paid", 409, lambda: svc.reverse_claim_payment(db, cid, reason="again"))


def test_repay_after_reversal_posts_a_new_pair_and_keeps_the_history(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP Q", "CLM-0017")
    cid = _claim(1000.0)
    first = _pay(cid, acc)["ledger_transaction_id"]
    with get_db_context() as db:
        svc.reverse_claim_payment(db, cid, reason="redo", reversal_date="2026-05-02")
    second = _pay(cid, acc, payment_date="2026-05-04")
    assert second["payment_status"] == "paid" and second["ledger_transaction_id"] not in (None, first)
    assert second["payment_reversal_transaction_id"] is None
    assert len(_rows("insurance_claim")) == 2 and len(_rows("insurance_claim_reversal")) == 1
    assert _balance(acc) == pytest.approx(10000.0 - 1000.0)


def test_cash_basis_counts_the_payment_as_spend_and_the_reversal_as_negative_spend(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP R", "CLM-0018")
    cid = _claim(400.0)
    _pay(cid, acc)
    with get_db_context() as db:
        svc.reverse_claim_payment(db, cid, reason="undo", reversal_date="2026-05-02")
    with get_db_context() as db:
        pay = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.source == "insurance_claim").first()
        rev = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.source == "insurance_claim_reversal").first()
        assert cash_basis.classify(pay, "cost") == (cash_basis.SPEND, 400.0)
        assert cash_basis.classify(rev, "cost") == (cash_basis.SPEND, -400.0)


def test_claim_rows_are_not_editable_or_deletable_as_manual_transactions(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Claims EGP S", "CLM-0019")
    cid = _claim()
    ledger_id = _pay(cid, acc)["ledger_transaction_id"]
    assert app_client.patch(f"/api/finance/transactions/{ledger_id}", json={"amount": 1.0}, cookies=admin_cookies).status_code == 400
    assert app_client.delete(f"/api/finance/transactions/{ledger_id}", cookies=admin_cookies).status_code == 400
    assert len(_rows("insurance_claim")) == 1


def test_migration_0075_upgrades_and_downgrades_with_a_single_head(tmp_path):
    db_file = tmp_path / "claim_payment_mig.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db_file}", "SECRET_KEY": "x" * 40, "ENVIRONMENT": "development"}

    def alembic(*args):
        return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=env, capture_output=True, text=True)

    heads = alembic("heads")
    assert heads.returncode == 0, heads.stderr
    assert len([ln for ln in heads.stdout.splitlines() if "(head)" in ln]) == 1   # later migrations may sit on top of 0075
    history = alembic("history")
    assert history.returncode == 0, history.stderr
    assert "0075_claim_payment" in history.stdout

    up = alembic("upgrade", "head")
    assert up.returncode == 0, up.stderr[-2000:]
    conn = sqlite3.connect(db_file)
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(insurance_claims)")}
        assert {"payment_status", "paid_at", "paid_by_user_id", "ledger_transaction_id", "payment_reversal_transaction_id"} <= cols
        conn.execute("INSERT INTO employees (id, name, email) VALUES (1, 'E', 'e@hrflow.test')")
        conn.execute("INSERT INTO insurance_claims (employee_id, category, date) VALUES (1, 'Dental', '2026-02-01')")
        conn.commit()
        assert conn.execute("SELECT payment_status FROM insurance_claims").fetchone()[0] == "unpaid"
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE insurance_claims SET payment_status = 'bogus'")
    finally:
        conn.close()

    down = alembic("downgrade", "0074_history_import")
    assert down.returncode == 0, down.stderr[-2000:]
    conn = sqlite3.connect(db_file)
    try:
        assert "payment_status" not in {r[1] for r in conn.execute("PRAGMA table_info(insurance_claims)")}
        assert conn.execute("SELECT count(*) FROM insurance_claims").fetchone()[0] == 1
    finally:
        conn.close()
    again = alembic("upgrade", "head")
    assert again.returncode == 0, again.stderr[-2000:]
