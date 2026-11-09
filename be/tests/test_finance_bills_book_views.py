"""
be/tests/test_finance_bills_book_views.py
Bills page redesign, Phase A (docs/finance-module/bills-page-redesign-plan.md):
the bills list and queue counts take a book view, the list can be limited to subscription or one-off bills, there are
two aggregate queues (attention, to_pay) and a summary for the four cards.

Book rule for this page (D1): a paid bill sits in the book of the account that paid it; an unpaid bill sits in the book
of the account that made the vendor's most recent payment; with no payment history it sits in the default (Local) book.
Synthetic data only.
"""
from datetime import datetime

from bill_test_helpers import create_approved, create_draft, make_maker, make_vendor, pay
from test_finance_books import _account

B = "/api/finance/bills"


def _bill(client, cookies, vendor_id, number, amount=100.0, currency="USD", due="2099-12-31", **extra):
    return create_approved(client, cookies, vendor_id, number, amount, currency=currency, due_date=due, **extra)


def _ids(resp):
    assert resp.status_code == 200, resp.text
    return {b["id"] for b in resp.json()}


def _link_subscription(vendor_id, bill_id, name="Monthly Tool"):
    from db import get_db_context
    from finance.models import SubscriptionChargeDB, SubscriptionDB

    with get_db_context() as db:
        sub = SubscriptionDB(vendor_id=vendor_id, name=name, amount=100.0, currency="USD", next_renewal_date="2099-01-01")
        db.add(sub)
        db.flush()
        db.add(SubscriptionChargeDB(subscription_id=sub.id, billing_date="2026-01-01", amount=100.0, currency="USD", linked_bill_id=bill_id, status="settled"))
        db.commit()


def test_paid_bill_follows_its_paying_account(app_client, admin_cookies):
    vendor = make_vendor(app_client, admin_cookies, "Book Vendor Paid")
    over = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=5000.0)
    local = _account(app_client, admin_cookies, "Local EGP", "EGP", book="local", opening=5000.0)
    a = _bill(app_client, admin_cookies, vendor, "BK-PAID-A", 100.0)
    b = _bill(app_client, admin_cookies, vendor, "BK-PAID-B", 50.0, currency="EGP")  # a bill is paid from an account in its own currency
    assert pay(app_client, admin_cookies, a["id"], over["id"], 100.0).status_code == 201
    assert pay(app_client, admin_cookies, b["id"], local["id"], 50.0).status_code == 201

    assert a["id"] in _ids(app_client.get(f"{B}?book=overseas&limit=100", cookies=admin_cookies))
    assert b["id"] not in _ids(app_client.get(f"{B}?book=overseas&limit=100", cookies=admin_cookies))
    assert b["id"] in _ids(app_client.get(f"{B}?book=local&limit=100", cookies=admin_cookies))
    both = _ids(app_client.get(f"{B}?book=consolidated&limit=100", cookies=admin_cookies))
    assert {a["id"], b["id"]} <= both

    row = next(x for x in app_client.get(f"{B}?book=overseas&limit=100", cookies=admin_cookies).json() if x["id"] == a["id"])
    assert row["book"] == "overseas" and row["book_source"] == "paid" and row["paid_from_account_name"] == over["account_name"]


def test_unpaid_bill_takes_the_book_of_the_vendors_last_payment(app_client, admin_cookies):
    vendor = make_vendor(app_client, admin_cookies, "Book Vendor Inferred")
    over = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=5000.0)
    paid = _bill(app_client, admin_cookies, vendor, "BK-INF-1", 100.0)
    assert pay(app_client, admin_cookies, paid["id"], over["id"], 100.0).status_code == 201
    unpaid = _bill(app_client, admin_cookies, vendor, "BK-INF-2", 80.0)

    assert unpaid["id"] in _ids(app_client.get(f"{B}?book=overseas&limit=100", cookies=admin_cookies))
    assert unpaid["id"] not in _ids(app_client.get(f"{B}?book=local&limit=100", cookies=admin_cookies))
    row = next(x for x in app_client.get(f"{B}?book=overseas&limit=100", cookies=admin_cookies).json() if x["id"] == unpaid["id"])
    assert row["book"] == "overseas" and row["book_source"] == "inferred" and row["paid_from_account_name"] == over["account_name"]


def test_vendor_without_payment_history_sits_in_the_default_book(app_client, admin_cookies):
    vendor = make_vendor(app_client, admin_cookies, "Book Vendor Default")
    bill = _bill(app_client, admin_cookies, vendor, "BK-DEF-1", 60.0)
    assert bill["id"] in _ids(app_client.get(f"{B}?book=local&limit=100", cookies=admin_cookies))
    assert bill["id"] not in _ids(app_client.get(f"{B}?book=overseas&limit=100", cookies=admin_cookies))
    got = app_client.get(f"{B}/{bill['id']}", cookies=admin_cookies).json()
    assert got["book"] == "local" and got["book_source"] == "default" and got["paid_from_account_name"] is None


def test_book_filter_pages_after_filtering(app_client, admin_cookies):
    vendor = make_vendor(app_client, admin_cookies, "Book Vendor Paging")
    over = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=5000.0)
    first = _bill(app_client, admin_cookies, vendor, "BK-PG-1", 10.0)
    assert pay(app_client, admin_cookies, first["id"], over["id"], 10.0).status_code == 201
    made = [_bill(app_client, admin_cookies, vendor, f"BK-PG-{i}", 10.0) for i in range(2, 5)]
    page1 = app_client.get(f"{B}?book=overseas&limit=2&offset=0", cookies=admin_cookies).json()
    page2 = app_client.get(f"{B}?book=overseas&limit=2&offset=2", cookies=admin_cookies).json()
    assert len(page1) == 2 and len(page2) == 2
    assert {x["id"] for x in page1}.isdisjoint({x["id"] for x in page2})
    assert {x["id"] for x in page1 + page2} == {first["id"]} | {m["id"] for m in made}


def test_invalid_book_and_kind_are_rejected(app_client, admin_cookies):
    assert app_client.get(f"{B}?book=mars", cookies=admin_cookies).status_code == 400
    assert app_client.get(f"{B}?kind=weekly", cookies=admin_cookies).status_code == 400
    assert app_client.get(f"{B}/queue-counts?book=mars", cookies=admin_cookies).status_code == 400
    assert app_client.get(f"{B}/summary?book=mars", cookies=admin_cookies).status_code == 400


def test_kind_filter_and_subscription_fields(app_client, admin_cookies):
    vendor = make_vendor(app_client, admin_cookies, "Kind Vendor")
    sub_bill = _bill(app_client, admin_cookies, vendor, "KD-SUB-1", 100.0)
    one_off = _bill(app_client, admin_cookies, vendor, "KD-ONE-1", 70.0)
    _link_subscription(vendor, sub_bill["id"], "Kind Tool")

    subs = app_client.get(f"{B}?kind=subscription&limit=100", cookies=admin_cookies).json()
    ones = app_client.get(f"{B}?kind=one_off&limit=100", cookies=admin_cookies).json()
    assert sub_bill["id"] in {x["id"] for x in subs} and one_off["id"] not in {x["id"] for x in subs}
    assert one_off["id"] in {x["id"] for x in ones} and sub_bill["id"] not in {x["id"] for x in ones}
    row = next(x for x in subs if x["id"] == sub_bill["id"])
    assert row["is_subscription"] is True and row["subscription_name"] == "Kind Tool"
    assert next(x for x in ones if x["id"] == one_off["id"])["is_subscription"] is False


def test_attention_and_to_pay_queues(app_client, admin_cookies):
    vendor = make_vendor(app_client, admin_cookies, "Queue Vendor")
    late = _bill(app_client, admin_cookies, vendor, "QU-LATE", 10.0, due="2020-01-01")
    future = _bill(app_client, admin_cookies, vendor, "QU-FUT", 20.0, due="2099-01-01")
    draft = create_draft(app_client, make_maker(), vendor, "QU-DRAFT", 30.0)  # a maker without approval rights saves a Draft
    assert draft["status"] == "draft"

    attention = _ids(app_client.get(f"{B}?queue=attention&limit=100", cookies=admin_cookies))
    to_pay = _ids(app_client.get(f"{B}?queue=to_pay&limit=100", cookies=admin_cookies))
    overdue = _ids(app_client.get(f"{B}?queue=overdue&limit=100", cookies=admin_cookies))
    assert {late["id"], draft["id"]} <= attention and future["id"] not in attention
    assert {late["id"], future["id"]} <= to_pay and draft["id"] not in to_pay
    assert late["id"] in overdue and future["id"] not in overdue and draft["id"] not in overdue


def test_queue_counts_include_new_queues_and_honour_book(app_client, admin_cookies):
    vendor = make_vendor(app_client, admin_cookies, "Count Vendor")
    over = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=5000.0)
    seeded = _bill(app_client, admin_cookies, vendor, "CT-1", 10.0, due="2020-01-01")
    assert pay(app_client, admin_cookies, seeded["id"], over["id"], 4.0).status_code == 201  # part paid, overseas
    base_local = app_client.get(f"{B}/queue-counts?book=local", cookies=admin_cookies).json()
    base_over = app_client.get(f"{B}/queue-counts?book=overseas", cookies=admin_cookies).json()
    all_counts = app_client.get(f"{B}/queue-counts", cookies=admin_cookies).json()

    assert base_over["partially_paid"] >= 1 and base_over["to_pay"] >= 1 and base_over["attention"] >= 1
    for key in ("to_pay", "attention", "overdue", "all"):
        assert base_local[key] + base_over[key] == all_counts[key], key


def test_summary_groups_money_by_currency_and_follows_book(app_client, admin_cookies):
    vendor = make_vendor(app_client, admin_cookies, "Summary Vendor")
    over = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=5000.0)
    before = app_client.get(f"{B}/summary?book=overseas", cookies=admin_cookies).json()

    usd = _bill(app_client, admin_cookies, vendor, "SM-USD", 200.0, currency="USD", due="2020-01-01")
    assert pay(app_client, admin_cookies, usd["id"], over["id"], 50.0, date=datetime.utcnow().strftime("%Y-%m-%d")).status_code == 201
    egp = _bill(app_client, admin_cookies, vendor, "SM-EGP", 1000.0, currency="EGP", due="2099-01-01")  # unpaid, inferred overseas

    after = app_client.get(f"{B}/summary?book=overseas", cookies=admin_cookies).json()

    def amount(bucket, currency):
        return next((m["amount"] for m in bucket["totals"] if m["currency"] == currency), 0.0)

    # remaining 150 USD is to pay and overdue; the EGP bill is to pay but never added to the USD total
    assert round(amount(after["to_pay"], "USD") - amount(before["to_pay"], "USD"), 2) == 150.0
    assert round(amount(after["to_pay"], "EGP") - amount(before["to_pay"], "EGP"), 2) == 1000.0
    assert round(amount(after["overdue"], "USD") - amount(before["overdue"], "USD"), 2) == 150.0
    assert amount(after["overdue"], "EGP") == amount(before["overdue"], "EGP")
    assert round(amount(after["paid_this_month"], "USD") - amount(before["paid_this_month"], "USD"), 2) == 50.0
    assert after["to_pay"]["count"] == before["to_pay"]["count"] + 2
    assert usd["id"] and egp["id"]

    consolidated = app_client.get(f"{B}/summary", cookies=admin_cookies).json()
    assert consolidated["book"] == "consolidated"
    local = app_client.get(f"{B}/summary?book=local", cookies=admin_cookies).json()
    assert amount(local["to_pay"], "EGP") + amount(after["to_pay"], "EGP") == amount(consolidated["to_pay"], "EGP")


def test_summary_excludes_reversed_payments(app_client, admin_cookies):
    vendor = make_vendor(app_client, admin_cookies, "Reversal Vendor")
    over = _account(app_client, admin_cookies, "Overseas USD", "USD", book="overseas", opening=5000.0)
    before = app_client.get(f"{B}/summary?book=overseas", cookies=admin_cookies).json()["paid_this_month"]
    bill = _bill(app_client, admin_cookies, vendor, "RV-1", 90.0)
    resp = pay(app_client, admin_cookies, bill["id"], over["id"], 90.0, date=datetime.utcnow().strftime("%Y-%m-%d"))
    assert resp.status_code == 201, resp.text
    payment_id = resp.json()["id"]
    reversed_ = app_client.post(f"{B}/{bill['id']}/payments/{payment_id}/reverse", json={"reason": "test"}, cookies=admin_cookies)
    assert reversed_.status_code == 200, reversed_.text

    after = app_client.get(f"{B}/summary?book=overseas", cookies=admin_cookies).json()["paid_this_month"]
    assert after == before


def test_summary_and_new_filters_need_bill_read(app_client):
    assert app_client.get(f"{B}/summary").status_code in (401, 403)
    assert app_client.get(f"{B}?book=local").status_code in (401, 403)
