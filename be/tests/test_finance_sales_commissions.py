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
