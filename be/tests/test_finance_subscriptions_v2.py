"""
be/tests/test_finance_subscriptions_v2.py
X5 (D-031): expected charges generated idempotently, settle (link a payment or an Already paid bill), skip,
renewal advance, proof tracking that never blocks, and in-app attention items. No email, no scheduler.
"""
import importlib.util
import os
from datetime import date, datetime

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from test_finance_books import _account, _tx

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = "/api/finance/subscriptions"
_n = {"v": 0}


def _months_ago(n: int) -> date:
    t = datetime.utcnow().date()
    idx = t.year * 12 + (t.month - 1) - n
    return date(idx // 12, idx % 12 + 1, 1)


def _vendor(client, cookies):
    _n["v"] += 1
    r = client.post("/api/finance/vendors", json={"name": f"V2 Vendor {_n['v']}", "category": "SaaS"}, cookies=cookies)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _sub(client, cookies, account_id=None, proof_expected=True, months_back=2, amount=100.0, **extra):
    payload = {
        "vendor_id": _vendor(client, cookies), "name": f"Tool {_n['v']}", "amount": amount, "currency": "USD", "billing_cycle": "monthly",
        "next_renewal_date": _months_ago(months_back).strftime("%Y-%m-%d"), "payment_account_id": account_id,
        "proof_expected": proof_expected, "proof_source": "email_inbox", "billing_email": "billing@vendor.test",
    }
    payload.update(extra)
    r = client.post(S, json=payload, cookies=cookies)
    assert r.status_code == 201, r.text
    return r.json()


def _charges(client, cookies, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    r = client.get(f"{S}/charges" + (f"?{q}" if q else ""), cookies=cookies)
    assert r.status_code == 200, r.text
    return r.json()


def test_generation_is_idempotent_and_runs_on_list(app_client, admin_cookies):
    sub = _sub(app_client, admin_cookies)
    assert sub["billing_email"] == "billing@vendor.test" and sub["proof_source"] == "email_inbox" and sub["proof_expected"] is True

    # opening the list already generated the three due cycles
    listed = app_client.get(S, cookies=admin_cookies).json()
    mine = next(s for s in listed if s["id"] == sub["id"])
    assert mine["expected_charges_count"] == 3 and mine["charges_count"] == 0

    first = app_client.post(f"{S}/generate-charges", cookies=admin_cookies).json()
    second = app_client.post(f"{S}/generate-charges", cookies=admin_cookies).json()
    assert first["created"] == 0 and second["created"] == 0  # nothing left to create

    ch = _charges(app_client, admin_cookies, subscription_id=sub["id"])
    dates = sorted(c["billing_date"] for c in ch)
    assert dates == [_months_ago(2).strftime("%Y-%m-%d"), _months_ago(1).strftime("%Y-%m-%d"), _months_ago(0).strftime("%Y-%m-%d")]
    assert all(c["status"] == "expected" and c["amount"] == 100.0 and c["proof_status"] == "pending" for c in ch)

    # a future renewal creates nothing; a zero-amount or inactive subscription creates nothing
    future = _sub(app_client, admin_cookies, months_back=-1)
    inactive = _sub(app_client, admin_cookies, is_active=False)
    app_client.post(f"{S}/generate-charges", cookies=admin_cookies)
    assert _charges(app_client, admin_cookies, subscription_id=future["id"]) == []
    assert _charges(app_client, admin_cookies, subscription_id=inactive["id"]) == []


def test_permissions(app_client, admin_cookies, employee_cookies):
    sub = _sub(app_client, admin_cookies)
    app_client.get(S, cookies=admin_cookies)
    cid = _charges(app_client, admin_cookies, subscription_id=sub["id"])[0]["id"]
    assert app_client.get(f"{S}/charges", cookies=employee_cookies).status_code == 403
    assert app_client.post(f"{S}/generate-charges", cookies=employee_cookies).status_code == 403
    assert app_client.post(f"{S}/charges/{cid}/skip", json={"reason": "x"}, cookies=employee_cookies).status_code == 403
    assert app_client.post(f"{S}/charges/{cid}/settle", json={"mode": "link_ledger", "ledger_transaction_id": 1}, cookies=employee_cookies).status_code == 403
    assert app_client.patch(f"{S}/charges/{cid}/proof", json={"proof_status": "pending"}, cookies=employee_cookies).status_code == 403


def test_settle_by_linking_a_payment_advances_the_renewal(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Sub Local", "USD", opening=5000.0)
    sub = _sub(app_client, admin_cookies, account_id=acc["id"])
    app_client.get(S, cookies=admin_cookies)
    oldest = sorted(_charges(app_client, admin_cookies, subscription_id=sub["id"]), key=lambda c: c["billing_date"])[0]

    pay = _tx(app_client, admin_cookies, acc["id"], "out", 95.0, "USD", "Tool payment")
    # the proof is still pending: it must not block settling
    resp = app_client.post(f"{S}/charges/{oldest['id']}/settle", json={"mode": "link_ledger", "ledger_transaction_id": pay["id"], "variance_reason": "Discount"}, cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "settled" and body["amount"] == 95.0 and body["variance_amount"] == -5.0 and body["variance_reason"] == "Discount"
    assert body["linked_transaction_id"] == pay["id"] and body["proof_status"] == "pending"

    # exactly one charge per payment, only outflows in the same currency
    other = sorted(_charges(app_client, admin_cookies, subscription_id=sub["id"], status="expected"), key=lambda c: c["billing_date"])[0]
    assert app_client.post(f"{S}/charges/{other['id']}/settle", json={"mode": "link_ledger", "ledger_transaction_id": pay["id"]}, cookies=admin_cookies).status_code == 400
    money_in = _tx(app_client, admin_cookies, acc["id"], "in", 50.0, "USD", "Refund")
    assert app_client.post(f"{S}/charges/{other['id']}/settle", json={"mode": "link_ledger", "ledger_transaction_id": money_in["id"]}, cookies=admin_cookies).status_code == 400
    assert app_client.post(f"{S}/charges/{other['id']}/settle", json={"mode": "link_ledger", "ledger_transaction_id": 999999}, cookies=admin_cookies).status_code == 404
    assert app_client.post(f"{S}/charges/{other['id']}/settle", json={"mode": "bogus"}, cookies=admin_cookies).status_code == 400
    # a settled charge cannot be settled or skipped again
    assert app_client.post(f"{S}/charges/{oldest['id']}/skip", json={"reason": "again"}, cookies=admin_cookies).status_code == 400

    # renewal moved one cycle past the settled charge, and re-generating does not duplicate anything
    cur = app_client.get(f"{S}/{sub['id']}", cookies=admin_cookies).json()
    assert cur["next_renewal_date"] == _months_ago(1).strftime("%Y-%m-%d")
    assert app_client.post(f"{S}/generate-charges", cookies=admin_cookies).json()["created"] == 0
    assert len(_charges(app_client, admin_cookies, subscription_id=sub["id"])) == 3


def test_settle_by_creating_an_already_paid_bill(app_client, admin_cookies):
    acc = _account(app_client, admin_cookies, "Sub Bill Acc", "USD", opening=1000.0)
    sub = _sub(app_client, admin_cookies, account_id=acc["id"], months_back=1)
    app_client.get(S, cookies=admin_cookies)
    ch = sorted(_charges(app_client, admin_cookies, subscription_id=sub["id"]), key=lambda c: c["billing_date"])[0]

    resp = app_client.post(f"{S}/charges/{ch['id']}/settle", json={"mode": "already_paid_bill", "amount": 110.0}, cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "settled" and body["amount"] == 110.0 and body["variance_amount"] == 10.0
    assert body["linked_bill_id"] and body["linked_transaction_id"]
    bill = app_client.get(f"/api/finance/bills/{body['linked_bill_id']}", cookies=admin_cookies).json()
    assert bill["status"] == "paid" and bill["bill_number"].startswith("SUB-") and bill["total"] == 110.0
    assert app_client.get(f"/api/finance/accounts/{acc['id']}", cookies=admin_cookies).json()["current_balance"] == 890.0

    # D-020 / balance rules come from the bills service: an account that cannot cover the payment refuses
    poor = _account(app_client, admin_cookies, "Sub Poor Acc", "USD", opening=1.0)
    sub2 = _sub(app_client, admin_cookies, account_id=poor["id"], months_back=1)
    app_client.get(S, cookies=admin_cookies)
    ch2 = _charges(app_client, admin_cookies, subscription_id=sub2["id"])[0]
    refused = app_client.post(f"{S}/charges/{ch2['id']}/settle", json={"mode": "already_paid_bill"}, cookies=admin_cookies)
    assert refused.status_code == 400 and refused.json()["detail"]["code"] == "insufficient_balance"
    assert _charges(app_client, admin_cookies, subscription_id=sub2["id"], status="expected")  # still open, no bill left behind
    # no paying account at all
    sub3 = _sub(app_client, admin_cookies, months_back=1)
    app_client.get(S, cookies=admin_cookies)
    ch3 = _charges(app_client, admin_cookies, subscription_id=sub3["id"])[0]
    assert app_client.post(f"{S}/charges/{ch3['id']}/settle", json={"mode": "already_paid_bill"}, cookies=admin_cookies).status_code == 400


def test_skip_needs_a_reason_and_advances_the_renewal(app_client, admin_cookies):
    sub = _sub(app_client, admin_cookies, months_back=1)
    app_client.get(S, cookies=admin_cookies)
    ch = sorted(_charges(app_client, admin_cookies, subscription_id=sub["id"]), key=lambda c: c["billing_date"])[0]
    assert app_client.post(f"{S}/charges/{ch['id']}/skip", json={"reason": ""}, cookies=admin_cookies).status_code == 422
    done = app_client.post(f"{S}/charges/{ch['id']}/skip", json={"reason": "Seat removed this month"}, cookies=admin_cookies)
    assert done.status_code == 200 and done.json()["status"] == "skipped" and done.json()["skipped_reason"] == "Seat removed this month"
    assert app_client.get(f"{S}/{sub['id']}", cookies=admin_cookies).json()["next_renewal_date"] == _months_ago(0).strftime("%Y-%m-%d")
    assert app_client.post(f"{S}/charges/{ch['id']}/settle", json={"mode": "link_ledger", "ledger_transaction_id": 1}, cookies=admin_cookies).status_code == 400


def test_proof_tracking_never_blocks(app_client, admin_cookies):
    sub = _sub(app_client, admin_cookies, months_back=1)
    quiet = _sub(app_client, admin_cookies, proof_expected=False, months_back=1)
    app_client.get(S, cookies=admin_cookies)

    missing = _charges(app_client, admin_cookies, proofs_missing="true")
    ids = {c["subscription_id"] for c in missing}
    assert sub["id"] in ids and quiet["id"] not in ids  # only subscriptions that expect a proof are flagged

    mine = sorted([c for c in missing if c["subscription_id"] == sub["id"]], key=lambda c: c["billing_date"])
    a, b = mine[0], mine[1]
    assert app_client.patch(f"{S}/charges/{a['id']}/proof", json={"proof_status": "unavailable"}, cookies=admin_cookies).status_code == 400  # reason needed
    assert app_client.patch(f"{S}/charges/{a['id']}/proof", json={"proof_status": "attached"}, cookies=admin_cookies).status_code == 400  # no file yet
    assert app_client.patch(f"{S}/charges/{a['id']}/proof", json={"proof_status": "nonsense"}, cookies=admin_cookies).status_code == 400
    ok = app_client.patch(f"{S}/charges/{a['id']}/proof", json={"proof_status": "unavailable", "proof_note": "Vendor portal is down"}, cookies=admin_cookies)
    assert ok.status_code == 200 and ok.json()["proof_status"] == "unavailable" and ok.json()["proof_note"] == "Vendor portal is down"

    up = app_client.post(f"{S}/charges/{b['id']}/proof-file", files={"file": ("receipt.pdf", b"%PDF-1.4 r", "application/pdf")}, cookies=admin_cookies)
    assert up.status_code == 200 and up.json()["proof_status"] == "attached" and len(up.json()["attachments"]) == 1
    dl = app_client.get(f"/api/finance/attachments/{up.json()['attachments'][0]['id']}/download", cookies=admin_cookies)
    assert dl.status_code == 200 and dl.content == b"%PDF-1.4 r"

    still = {c["id"] for c in _charges(app_client, admin_cookies, proofs_missing="true") if c["subscription_id"] == sub["id"]}
    assert a["id"] not in still and b["id"] not in still


def test_attention_items_are_in_app(app_client, admin_cookies):
    sub = _sub(app_client, admin_cookies, months_back=2)
    app_client.get(S, cookies=admin_cookies)
    items = app_client.get("/api/finance/reports/attention-queue?limit=200", cookies=admin_cookies).json()["items"]
    mine = [i for i in items if i.get("target_id") == sub["id"]]
    types = {i["type"] for i in mine}
    assert "subscription_unsettled" in types and "subscription_proof_missing" in types
    unsettled = [i for i in mine if i["type"] == "subscription_unsettled"]
    assert len(unsettled) >= 2 and all(i["target_route"] == "a-finance-subscriptions" for i in unsettled)


def test_book_filter_follows_the_paying_account(app_client, admin_cookies):
    over = _account(app_client, admin_cookies, "Sub Overseas", "USD", book="overseas", opening=500.0)
    sub = _sub(app_client, admin_cookies, account_id=over["id"], months_back=1)
    app_client.get(S, cookies=admin_cookies)
    ids = lambda **p: {c["subscription_id"] for c in _charges(app_client, admin_cookies, **p)}
    assert sub["id"] in ids(book="overseas") and sub["id"] not in ids(book="local") and sub["id"] in ids(book="consolidated")
    assert _charges(app_client, admin_cookies, subscription_id=sub["id"])[0]["book_code"] == "overseas"
    assert app_client.get(f"{S}/charges?book=bogus", cookies=admin_cookies).status_code == 400


def test_manual_charge_settles_the_expected_one_for_that_date(app_client, admin_cookies):
    sub = _sub(app_client, admin_cookies, months_back=1)
    app_client.get(S, cookies=admin_cookies)
    first = sorted(_charges(app_client, admin_cookies, subscription_id=sub["id"]), key=lambda c: c["billing_date"])[0]
    logged = app_client.post(f"{S}/{sub['id']}/charges", data={"amount": "120", "billing_date": first["billing_date"], "currency": "USD"}, cookies=admin_cookies)
    assert logged.status_code == 201, logged.text
    assert logged.json()["id"] == first["id"] and logged.json()["status"] == "settled" and logged.json()["variance_amount"] == 20.0
    dates = [c["billing_date"] for c in _charges(app_client, admin_cookies, subscription_id=sub["id"])]
    assert len(dates) == len(set(dates))  # no duplicate for that date


def _migration():
    path = os.path.join(BE_DIR, "migrations", "versions", "0040_subscriptions_v2.py")
    spec = importlib.util.spec_from_file_location("mig_0040", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_marks_history_settled_and_never_flags_it(tmp_path):
    mod = _migration()
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'm.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE finance_subscriptions (id INTEGER PRIMARY KEY, name VARCHAR(255))"))
        conn.execute(sa.text(
            "CREATE TABLE finance_subscription_charges (id INTEGER PRIMARY KEY, subscription_id INTEGER, billing_date VARCHAR(20), amount FLOAT, created_at DATETIME)"
        ))
        conn.execute(sa.text("CREATE TABLE finance_attachments (id INTEGER PRIMARY KEY, subscription_charge_id INTEGER)"))
        conn.execute(sa.text("INSERT INTO finance_subscriptions VALUES (1, 'Old tool')"))
        conn.execute(sa.text("INSERT INTO finance_subscription_charges VALUES (1, 1, '2026-08-01', 10, '2026-08-02 00:00:00'), (2, 1, '2026-09-01', 10, '2026-09-02 00:00:00')"))
        conn.execute(sa.text("INSERT INTO finance_attachments VALUES (1, 2)"))

    for _ in range(2):  # idempotent
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                mod.upgrade()
    with engine.begin() as conn:
        rows = {r[0]: r[1:] for r in conn.execute(sa.text("SELECT id, status, proof_status FROM finance_subscription_charges")).fetchall()}
        assert rows[1] == ("settled", "unavailable") and rows[2] == ("settled", "attached")
        assert conn.execute(sa.text("SELECT proof_expected FROM finance_subscriptions")).scalar() in (0, False)
        # the unique guard applies to expected charges only
        conn.execute(sa.text("INSERT INTO finance_subscription_charges (subscription_id, billing_date, amount, status) VALUES (1, '2026-10-01', 10, 'expected')"))
    with engine.begin() as conn:
        try:
            conn.execute(sa.text("INSERT INTO finance_subscription_charges (subscription_id, billing_date, amount, status) VALUES (1, '2026-10-01', 10, 'expected')"))
            raised = False
        except sa.exc.IntegrityError:
            raised = True
        assert raised

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
    cols = {c["name"] for c in sa.inspect(engine).get_columns("finance_subscription_charges")}
    assert "status" not in cols and "proof_status" not in cols
