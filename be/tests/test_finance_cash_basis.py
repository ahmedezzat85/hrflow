"""
be/tests/test_finance_cash_basis.py
Slice F6 of Finance Review Round 2 (D-026): the cash-basis P&L counts reversals against the side they
reverse, ignores movements between own accounts, counts payroll and statutory payments as spend, shows one
column per currency for "All currencies", and labels the accrual view as partial.
"""
from bill_test_helpers import create_approved, make_vendor, pay
from invoice_test_helpers import BASE as INV, create_invoice, make_account, make_customer, receipt
from test_finance_payroll_split_fx import _cleanup_test_payroll_data, _setup_employee_with_plan
from test_finance_payroll_posting import _account, _finalized_run

SUMMARY = "/api/finance/reports/summary"


def _summary(client, cookies, currency="USD", basis="cash"):
    resp = client.get(f"{SUMMARY}?basis={basis}&period=ALL&currency={currency}", cookies=cookies)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _figures(client, cookies, currency="USD"):
    s = _summary(client, cookies, currency)
    return s["revenue_mtd"], s["cost_mtd"]


def test_reversing_a_bill_payment_reduces_spend_and_leaves_revenue_unchanged(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=50000.0)
    vendor = make_vendor(app_client, admin_cookies, "Reversal Vendor")
    bill = create_approved(app_client, admin_cookies, vendor, "REV-1", amount=1000.0)
    rev0, spend0 = _figures(app_client, admin_cookies)

    paid = pay(app_client, admin_cookies, bill["id"], acc, 1000.0, reference="REV-PAY-1")
    assert paid.status_code == 201, paid.text
    rev1, spend1 = _figures(app_client, admin_cookies)
    assert rev1 == rev0 and spend1 == spend0 + 1000.0

    rv = app_client.post(f"/api/finance/bills/{bill['id']}/payments/{paid.json()['id']}/reverse",
                         json={"reason": "wrong account"}, cookies=admin_cookies)
    assert rv.status_code == 200, rv.text
    rev2, spend2 = _figures(app_client, admin_cookies)
    assert rev2 == rev0                      # the reversal is not revenue
    assert spend2 == spend1 - 1000.0         # it reduces spend instead

    # the P&L statement agrees
    pnl = app_client.get("/api/finance/reports/profit-and-loss?basis=cash&currency=USD&date_from=2000-01-01&date_to=2999-12-31", cookies=admin_cookies).json()
    assert pnl["total_revenue"] == rev0 and pnl["total_expenses"] == spend0


def test_reversing_an_invoice_receipt_reduces_revenue_and_is_not_spend(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    cust = make_customer(app_client, admin_cookies)
    inv = create_invoice(app_client, admin_cookies, cust, amount=700.0, send=True)
    rev0, spend0 = _figures(app_client, admin_cookies)
    pay_resp = receipt(app_client, admin_cookies, inv["id"], acc, 700.0, reference="RCPT-1")
    assert _figures(app_client, admin_cookies) == (rev0 + 700.0, spend0)
    app_client.post(f"{INV}/{inv['id']}/payments/{pay_resp.json()['id']}/reverse?reason=bounced", cookies=admin_cookies)
    assert _figures(app_client, admin_cookies) == (rev0, spend0)


def test_teller_withdrawal_changes_neither_revenue_nor_spend(app_client, admin_cookies):
    bank = make_account(app_client, admin_cookies, currency="EGP", balance=100000.0)
    cash = make_account(app_client, admin_cookies, currency="EGP", balance=0.0, account_type="cash")
    before = _figures(app_client, admin_cookies, "EGP")
    resp = app_client.post(f"/api/finance/accounts/{bank}/transactions", json={
        "date": "2026-09-09", "amount": 5000.0, "direction": "out", "currency": "EGP",
        "description": "Counter withdrawal", "destination_cash_account_id": cash,
    }, cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    assert _figures(app_client, admin_cookies, "EGP") == before


def test_cash_withdrawal_cheque_changes_neither_revenue_nor_spend(app_client, admin_cookies):
    bank = make_account(app_client, admin_cookies, currency="EGP", balance=100000.0)
    cash = make_account(app_client, admin_cookies, currency="EGP", balance=0.0, account_type="cash")
    before = _figures(app_client, admin_cookies, "EGP")
    resp = app_client.post("/api/finance/cheques", json={
        "account_id": bank, "cheque_number": "F6-CW-1", "issue_date": "2026-09-08", "amount": 8000.0, "currency": "EGP",
        "payee": "Cash drawer", "purpose_type": "cash_withdrawal", "destination_cash_account_id": cash,
    }, cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    assert _figures(app_client, admin_cookies, "EGP") == before


def test_fx_exchange_transfer_is_excluded(app_client, admin_cookies):
    usd = make_account(app_client, admin_cookies, currency="USD", balance=10000.0)
    egp = make_account(app_client, admin_cookies, currency="EGP", balance=0.0)
    before_usd, before_egp = _figures(app_client, admin_cookies, "USD"), _figures(app_client, admin_cookies, "EGP")
    resp = app_client.post("/api/finance/transfers", json={
        "date": "2026-09-09", "from_account_id": usd, "to_account_id": egp, "from_amount": 100.0, "from_currency": "USD",
        "to_amount": 5000.0, "to_currency": "EGP", "fx_rate": 50.0, "transfer_type": "same_bank_fx",
    }, cookies=admin_cookies)
    assert resp.status_code in (200, 201), resp.text
    assert _figures(app_client, admin_cookies, "USD") == before_usd
    assert _figures(app_client, admin_cookies, "EGP") == before_egp


def test_payroll_net_pay_and_statutory_payment_are_spend(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    bank = _account("F6 Payroll Bank", "USD", "bank", 50000.0)
    cash = _account("F6 Payroll Cash", "USD", "cash", 10000.0)
    _setup_employee_with_plan("F6 Emp", "f6.emp@hrflow.test", ext_amount=3500.0, int_amount=1500.0)
    rev0, spend0 = _figures(app_client, admin_cookies)
    run_id = _finalized_run(app_client, admin_cookies, "2027-05", ext_id=bank, int_id=cash, bank_id=bank)
    assert app_client.post(f"/api/finance/payroll/runs/{run_id}/pay", json={}, cookies=admin_cookies).status_code == 200
    rev1, spend1 = _figures(app_client, admin_cookies)
    assert rev1 == rev0 and spend1 == spend0 + 5000.0   # net pay of both legs

    # a statutory remittance (EGP) is spend too
    egp = make_account(app_client, admin_cookies, currency="EGP", balance=20000.0)
    egp_before = _figures(app_client, admin_cookies, "EGP")
    obl = app_client.post("/api/finance/statutory-obligations", json={
        "obligation_type": "withholding_tax", "period": "2026-09", "amount_accrued": 900.0}, cookies=admin_cookies).json()
    settle = app_client.post(f"/api/finance/statutory-obligations/{obl['id']}/settle", json={
        "amount": 900.0, "payment_date": "2026-10-05", "bank_account_id": egp}, cookies=admin_cookies)
    assert settle.status_code == 200, settle.text
    egp_after = _figures(app_client, admin_cookies, "EGP")
    assert egp_after == (egp_before[0], egp_before[1] + 900.0)


def test_all_currencies_shows_separate_columns_and_no_converted_total(app_client, admin_cookies):
    usd = make_account(app_client, admin_cookies, currency="USD", balance=1000.0)
    egp = make_account(app_client, admin_cookies, currency="EGP", balance=5000.0)
    for acc, cur, amt in ((usd, "USD", 300.0), (egp, "EGP", 4000.0)):
        r = app_client.post(f"/api/finance/accounts/{acc}/transactions", json={
            "date": "2026-09-09", "amount": amt, "direction": "in", "currency": cur, "description": f"sale {cur}"}, cookies=admin_cookies)
        assert r.status_code == 201, r.text

    usd_rev, usd_cost = _figures(app_client, admin_cookies, "USD")
    egp_rev, egp_cost = _figures(app_client, admin_cookies, "EGP")
    all_summary = _summary(app_client, admin_cookies, "ALL")
    cols = {c["currency"]: c for c in all_summary["by_currency"]}
    assert {"USD", "EGP"} <= set(cols)
    assert cols["USD"]["revenue"] == usd_rev and cols["USD"]["cost"] == usd_cost
    assert cols["EGP"]["revenue"] == egp_rev and cols["EGP"]["cost"] == egp_cost
    assert cols["USD"]["revenue"] >= 300.0 and cols["EGP"]["revenue"] >= 4000.0
    # nothing is added across currencies
    assert all_summary["revenue_mtd"] is None and all_summary["cost_mtd"] is None and all_summary["net_mtd"] is None
    assert all_summary["balance"] is None and all_summary["currency"] == "ALL"

    pnl = app_client.get("/api/finance/reports/profit-and-loss?basis=cash&currency=ALL&date_from=2000-01-01&date_to=2999-12-31", cookies=admin_cookies)
    assert pnl.status_code == 200, pnl.text
    pcols = {c["currency"]: c for c in pnl.json()["by_currency"]}
    assert pcols["USD"]["total_revenue"] == usd_rev and pcols["EGP"]["total_revenue"] == egp_rev
    assert pnl.json()["total_revenue"] == 0.0


def test_accrual_view_is_labelled_partial(app_client, admin_cookies):
    note = "Partial: excludes payroll, statutory and bank fees"
    acc = _summary(app_client, admin_cookies, "USD", "accrual")
    assert acc["basis_note"] == note
    assert note in acc["kpis"]["revenue"]["definition"]
    assert _summary(app_client, admin_cookies, "USD", "cash")["basis_note"] is None
    pnl = app_client.get("/api/finance/reports/profit-and-loss?basis=accrual&currency=USD", cookies=admin_cookies).json()
    assert pnl["basis_note"] == note
    cash_pnl = app_client.get("/api/finance/reports/profit-and-loss?basis=cash&currency=USD", cookies=admin_cookies).json()
    assert cash_pnl["basis_note"] is None
