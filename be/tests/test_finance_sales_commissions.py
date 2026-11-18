"""
be/tests/test_finance_sales_commissions.py
Sales commissions: a customer is linked to a salesperson with a rate; a fully paid invoice accrues commission on its
net subtotal (VAT excluded); reversing a receipt voids it; the quarterly report lists it per salesperson.
"""
from invoice_test_helpers import BASE, create_invoice, make_account, receipt

SP = "/api/finance/salespeople"
REPORT = "/api/finance/commissions/report"


def _salesperson(client, cookies, name="Sam Sales", **extra):
    resp = client.post(SP, json={"name": name, **extra}, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _customer(client, cookies, name, salesperson_id=None, rate=None):
    body = {"name": name}
    if salesperson_id is not None:
        body["salesperson_id"] = salesperson_id
    if rate is not None:
        body["commission_rate"] = rate
    resp = client.post("/api/finance/customers", json=body, cookies=cookies)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _report(client, cookies, year=2026, quarter=3, **params):
    resp = client.get(REPORT, params={"year": year, "quarter": quarter, **params}, cookies=cookies)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_salesperson_crud_and_customer_link(app_client, admin_cookies):
    sp = _salesperson(app_client, admin_cookies, "Link Tester", email="lt@example.com")
    assert sp["is_active"] is True and sp["customer_count"] == 0
    assert app_client.post(SP, json={"name": "link tester"}, cookies=admin_cookies).status_code == 400

    cust = _customer(app_client, admin_cookies, "Linked Co", sp["id"], 5)
    assert cust["salesperson_id"] == sp["id"] and cust["salesperson_name"] == "Link Tester"
    assert cust["commission_rate"] == 5.0
    listed = {s["id"]: s for s in app_client.get(SP, cookies=admin_cookies).json()}
    assert listed[sp["id"]]["customer_count"] == 1

    # rate without a salesperson, unknown salesperson, out-of-range rate
    assert app_client.post("/api/finance/customers", json={"name": "No SP", "commission_rate": 5}, cookies=admin_cookies).status_code == 400
    assert app_client.put(f"/api/finance/customers/{cust['id']}", json={"salesperson_id": 99999}, cookies=admin_cookies).status_code == 404
    assert app_client.put(f"/api/finance/customers/{cust['id']}", json={"commission_rate": 101}, cookies=admin_cookies).status_code == 422

    # an inactive salesperson cannot be newly chosen, but is kept on customers that already have it
    other = _salesperson(app_client, admin_cookies, "Retired Rep")
    assert app_client.patch(f"{SP}/{other['id']}", json={"is_active": False}, cookies=admin_cookies).status_code == 200
    assert app_client.put(f"/api/finance/customers/{cust['id']}", json={"salesperson_id": other["id"]}, cookies=admin_cookies).status_code == 400
    assert app_client.patch(f"{SP}/{sp['id']}", json={"is_active": False}, cookies=admin_cookies).status_code == 200
    assert app_client.put(f"/api/finance/customers/{cust['id']}", json={"commission_rate": 6}, cookies=admin_cookies).status_code == 200


def test_paid_invoice_accrues_commission_on_net_subtotal_and_reversal_voids_it(app_client, admin_cookies):
    sp = _salesperson(app_client, admin_cookies, "Net Base Rep")
    cust = _customer(app_client, admin_cookies, "Commission Co EGP", sp["id"], 5)
    acc = make_account(app_client, admin_cookies, currency="EGP", balance=0.0)
    inv = create_invoice(app_client, admin_cookies, cust["id"], amount=10000.0, currency="EGP", send=True)
    assert inv["total"] == 11400.0  # 14% VAT

    # a partial receipt earns nothing yet
    assert receipt(app_client, admin_cookies, inv["id"], acc, 5000.0, currency="EGP", reference="C-1", date="2026-08-10").status_code == 201
    assert _report(app_client, admin_cookies, salesperson_id=sp["id"])["salespeople"] == []

    # the closing receipt accrues 5% of the net 10,000 (not of the 11,400 total)
    closing = receipt(app_client, admin_cookies, inv["id"], acc, 6400.0, currency="EGP", reference="C-2", date="2026-08-20")
    assert closing.status_code == 201, closing.text
    rep = _report(app_client, admin_cookies, salesperson_id=sp["id"])
    assert len(rep["salespeople"]) == 1
    line = rep["salespeople"][0]["lines"][0]
    assert (line["base_amount"], line["rate"], line["amount"], line["currency"]) == (10000.0, 5.0, 500.0, "EGP")
    assert line["invoice_number"] == inv["invoice_number"] and line["earned_date"] == "2026-08-20"
    assert rep["grand_totals"] == [{"currency": "EGP", "count": 1, "base_amount": 10000.0, "amount": 500.0}]
    assert rep["period_start"] == "2026-07-01" and rep["period_end"] == "2026-09-30"

    # another quarter does not include it
    assert _report(app_client, admin_cookies, quarter=4, salesperson_id=sp["id"])["salespeople"] == []

    # a later rate change leaves the snapshot alone
    assert app_client.put(f"/api/finance/customers/{cust['id']}", json={"commission_rate": 9}, cookies=admin_cookies).status_code == 200
    assert _report(app_client, admin_cookies, salesperson_id=sp["id"])["grand_totals"][0]["amount"] == 500.0

    # reversing the closing receipt un-pays the invoice and voids the commission, kept for audit
    pays = app_client.get(f"{BASE}/{inv['id']}/payments", cookies=admin_cookies).json()
    closing_id = next(p["id"] for p in pays if p["reference"] == "C-2")
    rev = app_client.post(f"{BASE}/{inv['id']}/payments/{closing_id}/reverse?reason=Bounced", cookies=admin_cookies)
    assert rev.status_code == 200, rev.text
    assert _report(app_client, admin_cookies, salesperson_id=sp["id"])["salespeople"] == []
    voided = app_client.get("/api/finance/commissions", params={"status": "void", "salesperson_id": sp["id"]}, cookies=admin_cookies).json()
    assert len(voided) == 1 and voided[0]["status"] == "void" and "reversed" in voided[0]["void_reason"]

    # paying again accrues a fresh commission at the customer's current rate
    assert receipt(app_client, admin_cookies, inv["id"], acc, 6400.0, currency="EGP", reference="C-3", date="2026-09-02").status_code == 201
    line = _report(app_client, admin_cookies, salesperson_id=sp["id"])["salespeople"][0]["lines"][0]
    assert (line["rate"], line["amount"]) == (9.0, 900.0)


def test_no_commission_without_salesperson_or_rate(app_client, admin_cookies):
    acc = make_account(app_client, admin_cookies, balance=0.0)
    sp = _salesperson(app_client, admin_cookies, "Idle Rep")
    for name, sp_id, rate in (("Unlinked Co", None, None), ("Zero Rate Co", sp["id"], 0)):
        cust = _customer(app_client, admin_cookies, name, sp_id, rate)
        inv = create_invoice(app_client, admin_cookies, cust["id"], amount=1000.0, send=True)
        assert receipt(app_client, admin_cookies, inv["id"], acc, 1000.0, reference=f"N-{name}").status_code == 201
    assert app_client.get("/api/finance/commissions", params={"status": "all", "salesperson_id": sp["id"]}, cookies=admin_cookies).json() == []


def test_report_groups_per_salesperson_and_currency(app_client, admin_cookies):
    a = _salesperson(app_client, admin_cookies, "Alpha Rep")
    b = _salesperson(app_client, admin_cookies, "Beta Rep")
    usd = make_account(app_client, admin_cookies, balance=0.0)
    for i, (sp, rate, amount) in enumerate(((a, 10, 1000.0), (a, 10, 500.0), (b, 2.5, 4000.0))):
        cust = _customer(app_client, admin_cookies, f"Group Co {i}", sp["id"], rate)
        inv = create_invoice(app_client, admin_cookies, cust["id"], amount=amount, send=True)
        assert receipt(app_client, admin_cookies, inv["id"], usd, amount, reference=f"G-{i}", date="2026-01-15").status_code == 201
    rep = _report(app_client, admin_cookies, year=2026, quarter=1)
    by_name = {p["salesperson_name"]: p for p in rep["salespeople"]}
    assert [p["salesperson_name"] for p in rep["salespeople"]] == ["Alpha Rep", "Beta Rep"]
    assert by_name["Alpha Rep"]["totals"] == [{"currency": "USD", "count": 2, "base_amount": 1500.0, "amount": 150.0}]
    assert by_name["Beta Rep"]["totals"] == [{"currency": "USD", "count": 1, "base_amount": 4000.0, "amount": 100.0}]
    assert rep["grand_totals"][0]["amount"] == 250.0
    assert app_client.get(REPORT, params={"year": 2026, "quarter": 5}, cookies=admin_cookies).status_code == 422


def test_commission_permissions(app_client, admin_cookies, employee_cookies):
    assert app_client.get(REPORT, cookies=employee_cookies).status_code == 403
    assert app_client.get(SP, cookies=employee_cookies).status_code == 403
    assert app_client.post(SP, json={"name": "Nope"}, cookies=employee_cookies).status_code == 403


# --- settlement confirmation (employees monthly, others quarterly; records only, no ledger posting) -------------

SETTLE = "/api/finance/commissions/settlements"


def _paid_invoice(client, cookies, acc, cust_id, amount, ref, date):
    inv = create_invoice(client, cookies, cust_id, amount=amount, send=True)
    assert receipt(client, cookies, inv["id"], acc, amount, reference=ref, date=date).status_code == 201
    return inv


def test_frequency_defaults_to_monthly_for_employees_and_quarterly_otherwise(app_client, admin_cookies):
    other = _salesperson(app_client, admin_cookies, "Freelancer Fay")
    assert other["settlement_frequency"] == "quarterly"
    emps = app_client.get("/api/employees", cookies=admin_cookies).json()
    emp_id = emps[0]["id"]
    staff = _salesperson(app_client, admin_cookies, "Staff Stan", employee_id=emp_id)
    assert staff["settlement_frequency"] == "monthly"
    upd = app_client.patch(f"{SP}/{staff['id']}", json={"settlement_frequency": "quarterly"}, cookies=admin_cookies)
    assert upd.status_code == 200 and upd.json()["settlement_frequency"] == "quarterly"
    assert app_client.patch(f"{SP}/{staff['id']}", json={"settlement_frequency": "weekly"}, cookies=admin_cookies).status_code == 422


def test_quarterly_salesperson_is_settled_per_quarter_and_undo_releases_it(app_client, admin_cookies):
    sp = _salesperson(app_client, admin_cookies, "Quarterly Quinn")
    cust = _customer(app_client, admin_cookies, "Quarterly Co", sp["id"], 10)
    acc = make_account(app_client, admin_cookies, balance=0.0)
    _paid_invoice(app_client, admin_cookies, acc, cust["id"], 1000.0, "Q-1", "2026-07-10")
    _paid_invoice(app_client, admin_cookies, acc, cust["id"], 2000.0, "Q-2", "2026-09-20")

    rep = _report(app_client, admin_cookies, salesperson_id=sp["id"])
    person = rep["salespeople"][0]
    assert person["settlement_frequency"] == "quarterly"
    assert [(p["period_start"], p["period_end"], p["unsettled_count"]) for p in person["periods"]] == [("2026-07-01", "2026-09-30", 2)]

    body = {"salesperson_id": sp["id"], "reference": "Wire 77", "settled_date": "2026-10-05"}
    # a single month is not a valid period for a quarterly salesperson; nothing to settle in an empty quarter
    bad = app_client.post(SETTLE, json={**body, "period_start": "2026-07-01", "period_end": "2026-07-31"}, cookies=admin_cookies)
    assert bad.status_code == 400 and "quarter" in bad.json()["detail"]
    empty = app_client.post(SETTLE, json={**body, "period_start": "2026-04-01", "period_end": "2026-06-30"}, cookies=admin_cookies)
    assert empty.status_code == 400 and "Nothing to settle" in empty.json()["detail"]

    ok = app_client.post(SETTLE, json={**body, "period_start": "2026-07-01", "period_end": "2026-09-30"}, cookies=admin_cookies)
    assert ok.status_code == 201, ok.text
    st = ok.json()
    assert st["line_count"] == 2 and st["totals"][0]["amount"] == 300.0 and st["status"] == "settled" and st["reference"] == "Wire 77"
    period = _report(app_client, admin_cookies, salesperson_id=sp["id"])["salespeople"][0]["periods"][0]
    assert period["unsettled_count"] == 0 and period["settlements"][0]["id"] == st["id"]
    # settling again finds nothing
    assert app_client.post(SETTLE, json={**body, "period_start": "2026-07-01", "period_end": "2026-09-30"}, cookies=admin_cookies).status_code == 400

    undo = app_client.post(f"{SETTLE}/{st['id']}/undo", cookies=admin_cookies)
    assert undo.status_code == 200 and undo.json()["status"] == "undone"
    period = _report(app_client, admin_cookies, salesperson_id=sp["id"])["salespeople"][0]["periods"][0]
    assert period["unsettled_count"] == 2 and period["settlements"] == []
    assert app_client.post(f"{SETTLE}/{st['id']}/undo", cookies=admin_cookies).status_code == 409


def test_monthly_salesperson_is_settled_per_month_and_settled_commission_blocks_reversal(app_client, admin_cookies):
    emp_id = app_client.get("/api/employees", cookies=admin_cookies).json()[0]["id"]
    sp = _salesperson(app_client, admin_cookies, "Monthly Mo", employee_id=emp_id)
    cust = _customer(app_client, admin_cookies, "Monthly Co", sp["id"], 5)
    acc = make_account(app_client, admin_cookies, balance=0.0)
    jul = _paid_invoice(app_client, admin_cookies, acc, cust["id"], 1000.0, "M-1", "2026-07-10")
    _paid_invoice(app_client, admin_cookies, acc, cust["id"], 2000.0, "M-2", "2026-08-05")

    person = _report(app_client, admin_cookies, salesperson_id=sp["id"])["salespeople"][0]
    assert [(p["period_start"], p["unsettled_count"]) for p in person["periods"]] == [("2026-07-01", 1), ("2026-08-01", 1)]
    # a quarter is not valid for a monthly salesperson
    body = {"salesperson_id": sp["id"], "settled_date": "2026-08-15"}
    assert app_client.post(SETTLE, json={**body, "period_start": "2026-07-01", "period_end": "2026-09-30"}, cookies=admin_cookies).status_code == 400

    ok = app_client.post(SETTLE, json={**body, "period_start": "2026-07-01", "period_end": "2026-07-31"}, cookies=admin_cookies)
    assert ok.status_code == 201 and ok.json()["totals"][0]["amount"] == 50.0
    person = _report(app_client, admin_cookies, salesperson_id=sp["id"])["salespeople"][0]
    assert [p["unsettled_count"] for p in person["periods"]] == [0, 1]   # August is still open

    # the July receipt cannot be reversed while its commission is settled
    pays = app_client.get(f"{BASE}/{jul['id']}/payments", cookies=admin_cookies).json()
    rev_url = f"{BASE}/{jul['id']}/payments/{pays[0]['id']}/reverse"
    blocked = app_client.post(rev_url, cookies=admin_cookies)
    assert blocked.status_code == 400 and "settled" in blocked.json()["detail"]
    assert app_client.post(f"{SETTLE}/{ok.json()['id']}/undo", cookies=admin_cookies).status_code == 200
    assert app_client.post(rev_url, cookies=admin_cookies).status_code == 200


def test_settlement_permissions(app_client, admin_cookies, employee_cookies):
    body = {"salesperson_id": 1, "period_start": "2026-07-01", "period_end": "2026-09-30", "settled_date": "2026-10-05"}
    assert app_client.post(SETTLE, json=body, cookies=employee_cookies).status_code == 403
    assert app_client.post(f"{SETTLE}/1/undo", cookies=employee_cookies).status_code == 403
