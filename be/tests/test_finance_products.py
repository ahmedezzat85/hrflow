"""
be/tests/test_finance_products.py
X3 (D-030): product catalog CRUD, code uniqueness, permissions, invoice lines with/without a product,
and the product lock once an invoice is Sent (D-022).
"""
from invoice_test_helpers import BASE as INV, make_customer, make_account

P = "/api/finance/products"


def _product(client, cookies, code, **extra):
    payload = {"name": f"Product {code}", "code": code, "product_type": "saas_subscription", "default_currency": "USD", "default_price": 99.0}
    payload.update(extra)
    return client.post(P, json=payload, cookies=cookies)


def test_product_crud_and_uniqueness(app_client, admin_cookies):
    r = _product(app_client, admin_cookies, "x3-crm")
    assert r.status_code == 201, r.text
    prod = r.json()
    assert prod["code"] == "X3-CRM" and prod["is_active"] is True and prod["default_price"] == 99.0

    assert _product(app_client, admin_cookies, "X3-CRM").status_code == 400  # unique, case-insensitive
    assert _product(app_client, admin_cookies, "X3-BAD", product_type="nonsense").status_code == 400

    acc_usd = make_account(app_client, admin_cookies, currency="USD")
    acc_egp = make_account(app_client, admin_cookies, currency="EGP")
    ok = app_client.patch(f"{P}/{prod['id']}", json={"default_receiving_account_id": acc_usd, "name": "CRM Suite"}, cookies=admin_cookies)
    assert ok.status_code == 200 and ok.json()["default_receiving_account_name"]
    assert ok.json()["name"] == "CRM Suite"
    bad = app_client.patch(f"{P}/{prod['id']}", json={"default_receiving_account_id": acc_egp}, cookies=admin_cookies)
    assert bad.status_code == 400  # currency must match the receiving account (D-020)

    other = _product(app_client, admin_cookies, "X3-OTHER").json()
    clash = app_client.patch(f"{P}/{other['id']}", json={"code": "x3-crm"}, cookies=admin_cookies)
    assert clash.status_code == 400

    off = app_client.patch(f"{P}/{prod['id']}", json={"is_active": False}, cookies=admin_cookies)
    assert off.json()["is_active"] is False
    active_ids = [p["id"] for p in app_client.get(f"{P}?is_active=true", cookies=admin_cookies).json()]
    assert prod["id"] not in active_ids and other["id"] in active_ids
    assert app_client.get(f"{P}/{prod['id']}", cookies=admin_cookies).status_code == 200
    assert app_client.get(f"{P}/999999", cookies=admin_cookies).status_code == 404


def test_product_permissions(app_client, admin_cookies, employee_cookies):
    assert app_client.get(P).status_code == 401
    assert app_client.get(P, cookies=employee_cookies).status_code == 403
    assert _product(app_client, employee_cookies, "X3-DENY").status_code == 403
    pid = _product(app_client, admin_cookies, "X3-PERM").json()["id"]
    assert app_client.patch(f"{P}/{pid}", json={"name": "Hack"}, cookies=employee_cookies).status_code == 403


def test_invoice_lines_with_and_without_product(app_client, admin_cookies):
    pid = _product(app_client, admin_cookies, "X3-INV", name="Invoice Product").json()["id"]
    cust = make_customer(app_client, admin_cookies)
    resp = app_client.post(INV, json={
        "customer_id": cust, "invoice_number": "INV-X3-001", "issue_date": "2026-09-01", "due_date": "2026-09-30", "currency": "USD",
        "lines": [
            {"description": "Seat licences", "quantity": 2, "unit_price": 50.0, "line_total": 100.0, "product_id": pid},
            {"description": "Ad hoc work", "quantity": 1, "unit_price": 40.0, "line_total": 40.0},
        ],
    }, cookies=admin_cookies)
    assert resp.status_code == 201, resp.text
    lines = {ln["description"]: ln for ln in resp.json()["lines"]}
    assert lines["Seat licences"]["product_id"] == pid and lines["Seat licences"]["product_name"] == "Invoice Product"
    assert lines["Ad hoc work"]["product_id"] is None


def test_product_locked_after_sent(app_client, admin_cookies):
    p1 = _product(app_client, admin_cookies, "X3-L1").json()["id"]
    p2 = _product(app_client, admin_cookies, "X3-L2").json()["id"]
    cust = make_customer(app_client, admin_cookies)
    line = {"description": "Plan", "quantity": 1, "unit_price": 100.0, "line_total": 100.0, "product_id": p1}
    inv = app_client.post(INV, json={"customer_id": cust, "invoice_number": "INV-X3-LOCK", "issue_date": "2026-09-01",
                                     "due_date": "2026-09-30", "currency": "USD", "lines": [line]}, cookies=admin_cookies).json()

    # Draft: the product can change
    draft = app_client.put(f"{INV}/{inv['id']}", json={"lines": [{**line, "product_id": p2}]}, cookies=admin_cookies)
    assert draft.status_code == 200, draft.text
    assert draft.json()["lines"][0]["product_id"] == p2

    assert app_client.post(f"{INV}/{inv['id']}/send", cookies=admin_cookies).status_code == 200

    # Sent: unchanged lines are fine, a different product is refused
    same = app_client.put(f"{INV}/{inv['id']}", json={"lines": [{**line, "product_id": p2}]}, cookies=admin_cookies)
    assert same.status_code == 200
    changed = app_client.put(f"{INV}/{inv['id']}", json={"lines": [{**line, "product_id": p1}]}, cookies=admin_cookies)
    assert changed.status_code == 409 and changed.json()["detail"]["code"] == "invoice_locked"
