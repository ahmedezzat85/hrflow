"""
be/tests/test_vat_statutory_sync.py
D-060: the VAT of an issued sales invoice appears in the Statutory tracker as a sales-tax obligation due at the
end of the quarter, and follows sends and voids without double counting.
"""
from finance.services.vat_statutory_sync import quarter_end_date
from invoice_test_helpers import BASE, create_invoice, make_customer

STAT = "/api/finance/statutory-obligations"


def _rows(client, cookies, period, currency=None):
    rows = client.get(f"{STAT}?obligation_type=sales_tax&period={period}", cookies=cookies).json()
    return [r for r in rows if currency is None or r["currency"] == currency]


def _inv(client, cookies, cust, month, amount, currency="EGP", send=True, **extra):
    return create_invoice(client, cookies, cust, amount=amount, currency=currency,
                          issue_date=f"{month}-10", due_date=f"{month}-28", send=send, **extra)


def test_quarter_end_date():
    assert quarter_end_date("2026-01-15") == "2026-03-31"
    assert quarter_end_date("2026-05-01") == "2026-06-30"
    assert quarter_end_date("2026-08-31") == "2026-09-30"
    assert quarter_end_date("2026-11-18") == "2026-12-31"


def test_draft_invoice_opens_no_obligation_but_send_does(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    inv = _inv(app_client, admin_cookies, cust, "2026-05", 100000.0, send=False)
    assert _rows(app_client, admin_cookies, "2026-05") == []

    sent = app_client.post(f"{BASE}/{inv['id']}/send", cookies=admin_cookies)
    assert sent.status_code == 200 and sent.json()["vat_obligation_notice"] is None
    rows = _rows(app_client, admin_cookies, "2026-05")
    assert len(rows) == 1
    ob = rows[0]
    assert ob["status"] == "estimated" and ob["currency"] == "EGP"
    assert ob["amount_accrued"] == 14000.0 and ob["amount_estimated"] == 14000.0
    assert ob["due_date"] == "2026-06-30"  # end of Q2
    assert ob["source_type"] == "invoice_tax_line"


def test_invoices_accumulate_and_resending_never_double_counts(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    _inv(app_client, admin_cookies, cust, "2026-08", 100000.0)
    _inv(app_client, admin_cookies, cust, "2026-08", 50000.0)
    rows = _rows(app_client, admin_cookies, "2026-08")
    assert len(rows) == 1 and rows[0]["amount_accrued"] == 21000.0
    assert rows[0]["due_date"] == "2026-09-30"

    # the manual button recomputes the same row, it does not add to it
    again = app_client.post(f"{STAT}/vat-estimate", json={"period": "2026-08"}, cookies=admin_cookies)
    assert again.status_code == 200 and again.json()["id"] == rows[0]["id"]
    assert again.json()["amount_accrued"] == 21000.0 and again.json()["due_date"] == "2026-09-30"
    assert len(_rows(app_client, admin_cookies, "2026-08")) == 1


def test_zero_vat_and_other_currency_without_vat_open_nothing(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    _inv(app_client, admin_cookies, cust, "2026-04", 1000.0, currency="USD")
    _inv(app_client, admin_cookies, cust, "2026-04", 1000.0, currency="EGP", vat_rate=0)
    assert _rows(app_client, admin_cookies, "2026-04") == []


def test_non_egp_invoice_with_vat_gets_its_own_currency_obligation(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    _inv(app_client, admin_cookies, cust, "2026-02", 1000.0, currency="USD", vat_rate=5)
    _inv(app_client, admin_cookies, cust, "2026-02", 10000.0, currency="EGP")
    usd = _rows(app_client, admin_cookies, "2026-02", "USD")
    egp = _rows(app_client, admin_cookies, "2026-02", "EGP")
    assert len(usd) == 1 and usd[0]["amount_accrued"] == 50.0 and usd[0]["due_date"] == "2026-03-31"
    assert len(egp) == 1 and egp[0]["amount_accrued"] == 1400.0


def test_void_takes_vat_back_out_and_removes_an_empty_estimate(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    a = _inv(app_client, admin_cookies, cust, "2026-10", 100000.0)
    b = _inv(app_client, admin_cookies, cust, "2026-10", 50000.0)
    assert _rows(app_client, admin_cookies, "2026-10")[0]["amount_accrued"] == 21000.0

    assert app_client.delete(f"{BASE}/{b['id']}", cookies=admin_cookies).status_code == 200
    assert _rows(app_client, admin_cookies, "2026-10")[0]["amount_accrued"] == 14000.0

    assert app_client.delete(f"{BASE}/{a['id']}", cookies=admin_cookies).status_code == 200
    assert _rows(app_client, admin_cookies, "2026-10") == []


def test_voiding_a_draft_leaves_obligations_alone(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    _inv(app_client, admin_cookies, cust, "2026-10", 100000.0)
    draft = _inv(app_client, admin_cookies, cust, "2026-10", 50000.0, send=False)
    assert app_client.delete(f"{BASE}/{draft['id']}", cookies=admin_cookies).status_code == 200
    assert _rows(app_client, admin_cookies, "2026-10")[0]["amount_accrued"] == 14000.0


def test_confirmed_obligation_is_left_alone_and_the_change_is_surfaced(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    a = _inv(app_client, admin_cookies, cust, "2026-07", 100000.0)
    ob = _rows(app_client, admin_cookies, "2026-07")[0]
    conf = app_client.post(f"{STAT}/{ob['id']}/confirm", json={"amount_accrued": 13900.0, "variance_note": "portal"}, cookies=admin_cookies)
    assert conf.status_code == 200 and conf.json()["status"] == "accrued"

    # a later invoice in the same month: confirmed row unchanged, caller told
    sent = app_client.post(f"{BASE}/{_inv(app_client, admin_cookies, cust, '2026-07', 10000.0, send=False)['id']}/send", cookies=admin_cookies)
    assert sent.status_code == 200
    assert "already accrued" in sent.json()["vat_obligation_notice"]
    assert _rows(app_client, admin_cookies, "2026-07")[0]["amount_accrued"] == 13900.0

    # voiding an invoice of that month is surfaced the same way and changes nothing
    voided = app_client.delete(f"{BASE}/{a['id']}", cookies=admin_cookies)
    assert voided.status_code == 200 and voided.json()["vat_obligation_notice"]
    assert _rows(app_client, admin_cookies, "2026-07")[0]["amount_accrued"] == 13900.0


def test_user_edited_due_date_survives_a_resync(app_client, admin_cookies):
    cust = make_customer(app_client, admin_cookies)
    _inv(app_client, admin_cookies, cust, "2026-09", 100000.0)
    ob = _rows(app_client, admin_cookies, "2026-09")[0]
    upd = app_client.patch(f"{STAT}/{ob['id']}", json={"due_date": "2026-10-15"}, cookies=admin_cookies)
    assert upd.status_code == 200, upd.text
    _inv(app_client, admin_cookies, cust, "2026-09", 50000.0)
    again = _rows(app_client, admin_cookies, "2026-09")[0]
    assert again["amount_accrued"] == 21000.0 and again["due_date"] == "2026-10-15"
