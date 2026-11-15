"""
A finalized payroll run opens its statutory obligations (income tax, social insurance) as EGP estimates, so they
show in Finance > Spend > Statutory; runs finalized earlier get theirs when the list is read. The user confirms the
portal amount and pays from an account of their choice (not the payroll funding account).
"""
from db import get_db_context
from finance.models import PayrollRunDB, StatutoryObligationDB
from finance.services.payroll_statutory_sync import backfill_finalized_runs, ensure_run_obligations
from invoice_test_helpers import account_balance
from test_finance_payroll_posting import _account

URL = "/api/finance/statutory-obligations"


def _run(label, status="finalized", tax=900.0, si=1400.0):
    with get_db_context() as db:
        run = PayrollRunDB(
            period_label=label, period_start=f"{label}-01", period_end=f"{label}-28", status=status,
            total_employee_tax_egp=tax, total_social_insurance_egp=si, currency="USD",
        )
        db.add(run)
        db.commit()
        return run.id


def _for_run(run_id):
    with get_db_context() as db:
        rows = db.query(StatutoryObligationDB).filter(
            StatutoryObligationDB.source_type == "payroll_run", StatutoryObligationDB.source_id == run_id
        ).all()
        return [
            {"id": o.id, "obligation_type": o.obligation_type, "amount_estimated": o.amount_estimated,
             "status": o.status, "currency": o.currency, "due_date": o.due_date}
            for o in rows
        ]


def test_list_backfills_finalized_runs_once(app_client, admin_cookies):
    run_id = _run("2031-01")
    draft_id = _run("2031-02", status="draft")

    assert app_client.get(f"{URL}?period=2031-01", cookies=admin_cookies).status_code == 200
    rows = {o["obligation_type"]: o for o in _for_run(run_id)}
    assert set(rows) == {"income_tax", "social_insurance_employee"}
    assert rows["income_tax"]["amount_estimated"] == 900.0 and rows["social_insurance_employee"]["amount_estimated"] == 1400.0
    assert all(o["status"] == "estimated" and o["currency"] == "EGP" and o["due_date"] == "2031-02-15" for o in rows.values())
    assert _for_run(draft_id) == []  # a draft run owes nothing yet

    app_client.get(URL, cookies=admin_cookies)
    assert len(_for_run(run_id)) == 2  # idempotent


def test_run_with_a_manually_recorded_obligation_gets_no_duplicate(app_client, admin_cookies):
    run_id = _run("2031-03", tax=0.0, si=700.0)
    resp = app_client.post(
        URL, json={"obligation_type": "social_insurance_employee", "period": "2031-03", "amount_accrued": 700.0,
                   "notes": f"payroll_run_id:{run_id} | source:payroll_snapshot | actual_true_up"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    with get_db_context() as db:
        run = db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        assert ensure_run_obligations(db, run) == []
        backfill_finalized_runs(db)
    assert _for_run(run_id) == []  # nothing linked by source, and no second SI row was opened


def test_confirm_then_pay_from_chosen_egp_account(app_client, admin_cookies):
    run_id = _run("2031-04", tax=0.0, si=1000.0)
    app_client.get(URL, cookies=admin_cookies)
    obl = _for_run(run_id)[0]["id"]
    egp = _account("Stat EGP Account", currency="EGP", opening=5000.0)

    # An estimate cannot be paid before it is confirmed
    pay = {"amount": 1100.0, "payment_date": "2031-05-10", "bank_account_id": egp, "final_payment": True}
    assert app_client.post(f"{URL}/{obl}/settle", json=pay, cookies=admin_cookies).status_code == 400

    confirm = app_client.post(f"{URL}/{obl}/confirm", json={"amount_accrued": 1100.0, "variance_note": "portal"}, cookies=admin_cookies)
    assert confirm.status_code == 200 and confirm.json()["status"] == "accrued" and confirm.json()["variance_amount"] == 100.0

    ok = app_client.post(f"{URL}/{obl}/settle", json=pay, cookies=admin_cookies)
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "remitted"
    assert account_balance(app_client, admin_cookies, egp) == 3900.0


def test_statutory_payment_from_a_usd_account_is_refused(app_client, admin_cookies):
    run_id = _run("2031-06", tax=0.0, si=500.0)
    app_client.get(URL, cookies=admin_cookies)
    obl = _for_run(run_id)[0]["id"]
    usd = _account("Stat USD Account", currency="USD", opening=5000.0)
    app_client.post(f"{URL}/{obl}/confirm", json={"amount_accrued": 500.0}, cookies=admin_cookies)
    resp = app_client.post(
        f"{URL}/{obl}/settle", json={"amount": 500.0, "payment_date": "2031-07-10", "bank_account_id": usd}, cookies=admin_cookies
    )
    assert resp.status_code == 400 and resp.json()["detail"]["code"] == "currency_mismatch"
